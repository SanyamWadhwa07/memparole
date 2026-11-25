// Memparole's store: entries with fixed provenance, and an append-only log of every decision
// about them. An entry's state may change; where it came from never does, and every change of
// state is a logged decision naming who made it, when, the exact hash it was about and why.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Session, Source } from "../bench/types.ts";

export type Origin = "owner" | "agent" | "untrusted" | "system";
export type State = "quarantined" | "trusted" | "retired";
export type Action = "admit" | "quarantine" | "parole" | "retire" | "void";

export interface Entry {
  id: number;
  content: string;
  /** SHA-256 of the content when it was stored. */
  hash: string;
  origin: Origin;
  session: Session;
  sourceIds: string[];
  source: Source;
  observedAt: string;
  supersessionKey: string | null;
  state: State;
}

export interface Decision {
  id: number;
  entryId: number;
  at: string;
  actor: string; // "system", "owner" or "rule:<name>"
  action: Action;
  reviewedHash: string;
  reason: string;
}

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const STATE_AFTER: Record<Action, State> = { admit: "trusted", parole: "trusted", quarantine: "quarantined", void: "quarantined", retire: "retired" };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY,
  content TEXT NOT NULL,
  hash TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('owner', 'agent', 'untrusted', 'system')),
  session TEXT NOT NULL,
  source_ids TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  supersession_key TEXT,
  state TEXT NOT NULL CHECK (state IN ('quarantined', 'trusted', 'retired'))
);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('admit', 'quarantine', 'parole', 'retire', 'void')),
  reviewed_hash TEXT NOT NULL,
  reason TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS decisions_no_update BEFORE UPDATE ON decisions
  BEGIN SELECT RAISE(ABORT, 'decisions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS decisions_no_delete BEFORE DELETE ON decisions
  BEGIN SELECT RAISE(ABORT, 'decisions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS entries_provenance_fixed BEFORE UPDATE OF origin, session, source_ids, source, observed_at ON entries
  BEGIN SELECT RAISE(ABORT, 'provenance is never relabelled'); END;
`;

type Row = Record<string, string | number | null>;

const toEntry = (r: Row): Entry => ({
  id: Number(r.id),
  content: String(r.content),
  hash: String(r.hash),
  origin: r.origin as Origin,
  session: r.session as Session,
  sourceIds: JSON.parse(String(r.source_ids)),
  source: JSON.parse(String(r.source)),
  observedAt: String(r.observed_at),
  supersessionKey: r.supersession_key === null ? null : String(r.supersession_key),
  state: r.state as State,
});

const toDecision = (r: Row): Decision => ({
  id: Number(r.id),
  entryId: Number(r.entry_id),
  at: String(r.at),
  actor: String(r.actor),
  action: r.action as Action,
  reviewedHash: String(r.reviewed_hash),
  reason: String(r.reason),
});

export class Store {
  #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(SCHEMA);
  }

  #tx<T>(fn: () => T): T {
    this.#db.exec("BEGIN");
    try {
      const result = fn();
      this.#db.exec("COMMIT");
      return result;
    } catch (e) {
      this.#db.exec("ROLLBACK");
      throw e;
    }
  }

  #log(entryId: number, d: Omit<Decision, "id" | "entryId">) {
    this.#db
      .prepare("INSERT INTO decisions (entry_id, at, actor, action, reviewed_hash, reason) VALUES (?, ?, ?, ?, ?, ?)")
      .run(entryId, d.at, d.actor, d.action, d.reviewedHash, d.reason);
  }

  /** Stores an entry. Only the owner's own words are trusted on arrival; everything else starts quarantined. */
  add(input: Omit<Entry, "id" | "hash" | "state">, at: string): Entry {
    const hash = sha256(input.content);
    const trusted = input.origin === "owner";
    return this.#tx(() => {
      const { lastInsertRowid } = this.#db
        .prepare("INSERT INTO entries (content, hash, origin, session, source_ids, source, observed_at, supersession_key, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(input.content, hash, input.origin, input.session, JSON.stringify(input.sourceIds), JSON.stringify(input.source), input.observedAt, input.supersessionKey, trusted ? "trusted" : "quarantined");
      const id = Number(lastInsertRowid);
      this.#log(id, {
        at,
        actor: "system",
        action: trusted ? "admit" : "quarantine",
        reviewedHash: hash,
        reason: trusted ? "the owner said it" : `origin is ${input.origin}: only the owner's words are trusted on arrival`,
      });
      return this.get(id)!;
    });
  }

  /** Changes an entry's state and logs why, in one transaction. */
  decide(entryId: number, d: Omit<Decision, "id" | "entryId">) {
    this.#tx(() => {
      this.#db.prepare("UPDATE entries SET state = ? WHERE id = ?").run(STATE_AFTER[d.action], entryId);
      this.#log(entryId, d);
    });
  }

  get(id: number): Entry | undefined {
    const row = this.#db.prepare("SELECT * FROM entries WHERE id = ?").get(id) as Row | undefined;
    return row && toEntry(row);
  }

  entries(...states: State[]): Entry[] {
    const all = (this.#db.prepare("SELECT * FROM entries ORDER BY id").all() as Row[]).map(toEntry);
    return states.length ? all.filter((e) => states.includes(e.state)) : all;
  }

  decisions(entryId?: number): Decision[] {
    const rows = entryId === undefined
      ? this.#db.prepare("SELECT * FROM decisions ORDER BY id").all()
      : this.#db.prepare("SELECT * FROM decisions WHERE entry_id = ? ORDER BY id").all(entryId);
    return (rows as Row[]).map(toDecision);
  }

  /**
   * Re-checks every trusted entry. Trust holds only while the content still hashes to the stored
   * hash and the decision that trusted it reviewed that same hash. Anything else is voided back to
   * quarantine, with the reason logged. Returns the voided IDs.
   */
  verify(at: string): number[] {
    const voided: number[] = [];
    for (const e of this.entries("trusted")) {
      const trustedBy = this.decisions(e.id).filter((d) => d.action === "admit" || d.action === "parole").at(-1);
      const reason =
        sha256(e.content) !== e.hash ? "content changed after it was trusted"
        : trustedBy?.reviewedHash !== e.hash ? "no trust decision covers the stored hash"
        : null;
      if (reason) {
        this.decide(e.id, { at, actor: "system", action: "void", reviewedHash: sha256(e.content), reason });
        voided.push(e.id);
      }
    }
    return voided;
  }

  close() {
    this.#db.close();
  }
}
