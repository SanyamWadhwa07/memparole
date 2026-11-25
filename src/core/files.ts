// Curated memory files (MEMORY.md, USER.md) as Memparole entries: the shape of OpenClaw #153426.
// Every tracked write of a file becomes a new entry under the key "file:<path>" and retires the
// previous one. A write is trusted only when it keeps continuity with a trusted record; otherwise
// it is quarantined with one of four reasons. The owner can restore trust for the exact bytes
// they reviewed (review.ts), and an operator can inspect any file without changing anything.
import type { Session } from "../bench/types.ts";
import type { Caller } from "./review.ts";
import { sha256, type Decision, type Entry, type Store } from "./store.ts";

export type DowngradeReason = "non-owner" | "tainted-turn" | "hash-mismatch" | "already-untrusted";

export interface TrackedWrite {
  path: string;
  content: string;
  /** The bytes the writer saw before writing, or null for a new file. */
  contentBefore: string | null;
  writer: "agent" | "owner" | "system";
  senderIsOwner: boolean;
  /** The turn read something from the network before this write. Recorded as a reason, never as the origin. */
  turnTainted: boolean;
  session: Session;
  at: string;
}

const UNCERTAIN = "publication outcome uncertain";
const key = (path: string) => `file:${path}`;

/** The entries for a path that are not retired, oldest first. The last one is the file's current record. */
function live(store: Store, path: string): Entry[] {
  return store.entries("trusted", "quarantined").filter((e) => e.supersessionKey === key(path));
}

export function current(store: Store, path: string): Entry | undefined {
  return live(store, path).at(-1);
}

function downgrade(w: TrackedWrite, previous: Entry | undefined): DowngradeReason | null {
  if (!w.senderIsOwner) return "non-owner";
  if (w.turnTainted) return "tainted-turn";
  if (previous && sha256(w.contentBefore ?? "") !== previous.hash) return "hash-mismatch";
  if (previous && previous.state === "quarantined") return "already-untrusted";
  return null;
}

/** Records a write. Never upgrades: a quarantined record stays quarantined until the owner decides. */
export function trackedWrite(store: Store, w: TrackedWrite): { entry: Entry; reason: DowngradeReason | null } {
  const previous = current(store, w.path);
  const reason = downgrade(w, previous);
  const entry = store.add(
    { content: w.content, origin: reason ? "untrusted" : w.writer, session: w.session, sourceIds: [], source: { id: `file:${w.path}`, actor: w.writer === "owner" ? "owner" : "unknown" }, observedAt: w.at, supersessionKey: key(w.path) },
    w.at,
    reason ? { trusted: false, reason } : { trusted: true, reason: "clean tracked write: continuity with a trusted record" },
  );
  for (const old of live(store, w.path).filter((e) => e.id !== entry.id)) {
    store.decide(old.id, { at: w.at, actor: "system", action: "retire", reviewedHash: old.hash, reason: `superseded by entry ${entry.id}` });
  }
  return { entry, reason };
}

/**
 * A system publication (scheduled promotion, or its in-place fallback). Committed: recorded like a
 * clean tracked write, so a trusted file keeps its trust and an untrusted one stays untrusted.
 * Rejected: nothing changes. Uncertain: trusted use is blocked until reconcile() runs.
 */
export function publish(store: Store, w: Omit<TrackedWrite, "writer" | "senderIsOwner" | "turnTainted">, outcome: "committed" | "rejected" | "uncertain") {
  if (outcome === "rejected") return null;
  const write: TrackedWrite = { ...w, writer: "system", senderIsOwner: true, turnTainted: false };
  if (outcome === "committed") return trackedWrite(store, write).entry;

  const previous = current(store, w.path);
  if (previous?.state === "trusted") {
    store.decide(previous.id, { at: w.at, actor: "system", action: "void", reviewedHash: previous.hash, reason: `${UNCERTAIN}: trusted use blocked until reconciled` });
  }
  return store.add(
    { content: w.content, origin: "system", session: w.session, sourceIds: [], source: { id: `file:${w.path}`, actor: "unknown" }, observedAt: w.at, supersessionKey: key(w.path) },
    w.at,
    { trusted: false, reason: UNCERTAIN },
  );
}

const firstReason = (store: Store, e: Entry) => store.decisions(e.id)[0]?.reason;

/**
 * After an uncertain publication: the bytes now on disk show which write committed. If they match
 * the publication or the record before it, that write keeps the class the record had before the
 * uncertainty. If they match neither, ownership is not established and the file stays quarantined.
 */
export function reconcile(store: Store, path: string, onDisk: string, at: string): "published" | "not-published" | "unresolved" | "nothing-pending" {
  const entries = live(store, path);
  const pending = entries.at(-1);
  if (!pending || firstReason(store, pending) !== UNCERTAIN) return "nothing-pending";
  const before = entries.at(-2);
  const wasTrusted = before ? store.decisions(before.id).some((d) => d.action === "void" && d.reason.startsWith(UNCERTAIN)) : true;
  const retire = (e: Entry, reason: string) => store.decide(e.id, { at, actor: "system", action: "retire", reviewedHash: e.hash, reason });
  const h = sha256(onDisk);

  if (h === pending.hash) {
    if (before) retire(before, `superseded by entry ${pending.id}`);
    store.decide(pending.id, wasTrusted
      ? { at, actor: "system", action: "admit", reviewedHash: pending.hash, reason: "reconciled: the publication committed, continuing a trusted record" }
      : { at, actor: "system", action: "quarantine", reviewedHash: pending.hash, reason: "reconciled: the publication committed; already-untrusted" });
    return "published";
  }
  if (before && h === before.hash) {
    retire(pending, "reconciled: the publication did not commit");
    if (wasTrusted) store.decide(before.id, { at, actor: "system", action: "admit", reviewedHash: before.hash, reason: "reconciled: the publication did not commit; bytes match the trusted record" });
    return "not-published";
  }
  store.decide(pending.id, { at, actor: "system", action: "quarantine", reviewedHash: h, reason: "reconciled: the bytes on disk match no authorised write; ownership not established" });
  return "unresolved";
}

export type FileStatus = "none" | "clean" | "stale" | "untrusted" | "owner-approved";

export interface FileReport {
  path: string;
  status: FileStatus;
  origin?: string;
  recordedHash?: string;
  diskHash?: string;
  observedAt?: string;
  session?: string;
  /** Why the record is in its state: the latest decision. */
  latest?: Decision;
  ownerDecision?: Decision;
}

/** Read-only. Distinguishes no record, clean, stale, untrusted, and owner-approved. Operator only. */
export function inspectFile(store: Store, path: string, onDisk: string | null, caller: Caller): FileReport {
  if (caller !== "operator") throw new Error(`refused: inspection needs the operator, not ${caller}`);
  const e = current(store, path);
  if (!e) return { path, status: "none" };
  const decisions = store.decisions(e.id);
  const ownerDecision = decisions.filter((d) => d.actor === "owner" && d.action === "parole" && d.reviewedHash === e.hash).at(-1);
  const diskHash = onDisk === null ? undefined : sha256(onDisk);
  const status: FileStatus =
    diskHash !== undefined && diskHash !== e.hash ? "stale"
    : e.state !== "trusted" ? "untrusted"
    : ownerDecision ? "owner-approved"
    : "clean";
  return { path, status, origin: e.origin, recordedHash: e.hash, diskHash, observedAt: e.observedAt, session: e.session, latest: decisions.at(-1), ...(ownerDecision ? { ownerDecision } : {}) };
}

/** Curated files eligible for injection at wake-up: the current record is trusted. */
export function eligibleFiles(store: Store): Entry[] {
  return store.entries("trusted").filter((e) => e.supersessionKey?.startsWith("file:"));
}
