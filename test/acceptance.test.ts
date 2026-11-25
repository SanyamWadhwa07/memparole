// The acceptance cases from OpenClaw #153426 (hal-cyber's field report, item 6), run against
// Memparole's file layer. Each case uses a fresh in-memory store: no production memory, no
// credentials, no channels.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { current, eligibleFiles, inspectFile, publish, reconcile, trackedWrite, type TrackedWrite } from "../src/core/files.ts";
import { ownerReview, type Caller } from "../src/core/review.ts";
import { sha256, Store } from "../src/core/store.ts";

const dir = await mkdtemp(join(tmpdir(), "memparole-acceptance-"));
after(() => rm(dir, { recursive: true, force: true }));

const AT = "2026-11-26T02:00:00.000Z";
const PATH = "MEMORY.md";
const V1 = "# Memory\n- Owner lives in Pune.\n";
const V2 = "# Memory\n- Owner lives in Pune.\n- Standup at 10:00.\n";
const V3 = "# Memory\n- Owner lives in Pune.\n- Standup at 10:00.\n- Prefers short answers.\n";

const write = (store: Store, content: string, contentBefore: string | null, over: Partial<TrackedWrite> = {}) =>
  trackedWrite(store, { path: PATH, content, contentBefore, writer: "agent", senderIsOwner: true, turnTainted: false, session: "main", at: AT, ...over });
const promote = (store: Store, content: string, contentBefore: string, outcome: "committed" | "rejected" | "uncertain" = "committed") =>
  publish(store, { path: PATH, content, contentBefore, session: "heartbeat", at: AT }, outcome);
const eligible = (store: Store) => eligibleFiles(store).map((e) => e.content);
const review = (store: Store, hash: string, caller: Caller = "operator") =>
  ownerReview(store, { entryId: current(store, PATH)!.id, hash, action: "parole", reason: "reviewed by the owner", at: AT }, caller);
/** An untrusted MEMORY.md: written in a turn that had read a web page. */
const untrusted = () => {
  const store = new Store(":memory:");
  write(store, V1, null);
  write(store, V2, V1, { turnTainted: true });
  return store;
};

test("A: tracked write, then promotion, then a clean tracked edit: stays trusted, stored hash equals the file's", () => {
  const store = new Store(":memory:");
  write(store, V1, null);
  promote(store, V2, V1);
  const { entry, reason } = write(store, V3, V2);
  assert.equal(reason, null);
  assert.equal(entry.origin, "agent");
  assert.equal(entry.hash, sha256(V3));
  assert.deepEqual(eligible(store), [V3]);
});

test("B: the same sequence from an untrusted record stays untrusted", () => {
  const store = untrusted();
  assert.equal(promote(store, V3, V2)!.state, "quarantined");
  const { reason } = write(store, V3 + "- one more\n", V3);
  assert.equal(reason, "already-untrusted");
  assert.deepEqual(eligible(store), []);
});

test("C: reopening an existing database, stale rows included, upgrades no row", () => {
  const path = join(dir, "upgrade.db");
  const before = new Store(path);
  write(before, V1, null);
  write(before, V2, "edited outside the tracked path"); // a stale, hash-mismatched record
  const snapshot = [before.entries(), before.decisions()];
  before.close();
  const after = new Store(path);
  assert.deepEqual([after.entries(), after.decisions()], snapshot);
  after.close();
});

test("D: an owner decision at the reviewed hash restores eligibility; provenance stays as recorded; the decision is audited", () => {
  const store = untrusted();
  review(store, sha256(V2));
  assert.deepEqual(eligible(store), [V2]);
  const report = inspectFile(store, PATH, V2, "operator");
  assert.equal(report.status, "owner-approved");
  assert.equal(report.origin, "untrusted", "not relabelled as agent-authored");
  assert.deepEqual(
    store.decisions(current(store, PATH)!.id).map((d) => [d.actor, d.action, d.reason]),
    [["system", "quarantine", "tainted-turn"], ["owner", "parole", "reviewed by the owner"]],
  );
});

test("E: an owner decision for bytes that differ from the file is refused, and nothing changes", () => {
  const store = untrusted();
  const decisions = store.decisions().length;
  assert.throws(() => review(store, sha256(V3)), /does not match the reviewed hash/);
  assert.equal(store.decisions().length, decisions);
  assert.deepEqual(eligible(store), []);
});

test("F: an owner decision from an agent tool, a plugin or a non-owner is refused", () => {
  const store = untrusted();
  for (const caller of ["agent-tool", "plugin", "non-owner"] as const) {
    assert.throws(() => review(store, sha256(V2), caller), /refused/);
  }
  assert.deepEqual(eligible(store), []);
});

test("G: after an owner decision, a write from a non-owner or a tainted turn is not eligible, with the reason recorded", () => {
  for (const [over, reason] of [[{ senderIsOwner: false }, "non-owner"], [{ turnTainted: true }, "tainted-turn"]] as const) {
    const store = untrusted();
    review(store, sha256(V2));
    assert.equal(write(store, V3, V2, over).reason, reason);
    assert.deepEqual(eligible(store), []);
    assert.equal(inspectFile(store, PATH, V3, "operator").latest!.reason, reason);
  }
});

test("H: after an owner decision, an unobserved change then a clean edit: the decision no longer applies, reason hash-mismatch", () => {
  const store = untrusted();
  review(store, sha256(V2));
  const changedOnDisk = V2 + "- added in an editor\n";
  assert.equal(inspectFile(store, PATH, changedOnDisk, "operator").status, "stale");
  const { reason } = write(store, V3, changedOnDisk);
  assert.equal(reason, "hash-mismatch");
  assert.deepEqual(eligible(store), []);
  assert.equal(inspectFile(store, PATH, V3, "operator").ownerDecision, undefined);
});

test("I: inspection tells all five states apart, changes nothing, and refuses a non-operator", () => {
  const status = (store: Store, onDisk: string | null) => inspectFile(store, PATH, onDisk, "operator").status;
  assert.equal(status(new Store(":memory:"), null), "none");
  const clean = new Store(":memory:");
  write(clean, V1, null);
  assert.equal(status(clean, V1), "clean");
  assert.equal(status(clean, V2), "stale");
  const quarantined = untrusted();
  assert.equal(status(quarantined, V2), "untrusted");
  review(quarantined, sha256(V2));
  const decisions = quarantined.decisions().length;
  assert.equal(status(quarantined, V2), "owner-approved");
  assert.equal(quarantined.decisions().length, decisions, "read-only");
  for (const caller of ["agent-tool", "plugin", "non-owner"] as const) {
    assert.throws(() => inspectFile(quarantined, PATH, V2, caller), /refused/);
  }
});

test("J: a scheduled promotion and the in-place fallback both repeat A (Memparole has one publication path for both)", () => {
  const store = new Store(":memory:");
  write(store, V1, null);
  promote(store, V2, V1); // scheduled run
  promote(store, V3, V2); // in-place fallback
  assert.equal(write(store, V3 + "- edit\n", V3).reason, null);
  assert.deepEqual(eligible(store), [V3 + "- edit\n"]);
});

test("K: a rejected publication changes nothing; an uncertain one blocks trusted use until reconciliation", () => {
  const rejected = new Store(":memory:");
  write(rejected, V1, null);
  const snapshot = [rejected.entries(), rejected.decisions()];
  assert.equal(promote(rejected, V2, V1, "rejected"), null);
  assert.deepEqual([rejected.entries(), rejected.decisions()], snapshot);

  const cases = [
    { onDisk: V2, outcome: "published", eligible: [V2] }, // the publication committed
    { onDisk: V1, outcome: "not-published", eligible: [V1] }, // it did not
    { onDisk: "bytes nobody authorised", outcome: "unresolved", eligible: [] }, // ownership not established
  ] as const;
  for (const c of cases) {
    const store = new Store(":memory:");
    write(store, V1, null);
    promote(store, V2, V1, "uncertain");
    assert.deepEqual(eligible(store), [], "blocked while uncertain");
    assert.equal(reconcile(store, PATH, c.onDisk, AT), c.outcome);
    assert.deepEqual(eligible(store), c.eligible, c.outcome);
  }

  const fromUntrusted = untrusted();
  promote(fromUntrusted, V3, V2, "uncertain");
  assert.equal(reconcile(fromUntrusted, PATH, V3, AT), "published");
  assert.deepEqual(eligible(fromUntrusted), [], "reconciliation never upgrades an untrusted record");
});
