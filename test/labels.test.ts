import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generate } from "../src/bench/generate.ts";
import { claimPairs, relevanceLabels } from "../src/bench/labels.ts";
import { status } from "../src/bench/types.ts";
import { FakeModel } from "../src/fake-model.ts";
import type { Ranker } from "../src/ranking.ts";
import { PlainFileMemory } from "../src/systems/plain-file.ts";

const stream = generate(1);
const claimOf = new Map(stream.events.map((e) => [e.id, stream.claims.find((c) => c.id === e.claimId)]));

test("claim pairs: all three labels, each consistent with the ground truth, sides traceable to events", () => {
  const pairs = claimPairs(stream);
  for (const label of ["same", "contradicts", "unrelated"]) assert.ok(pairs.some((p) => p.label === label), label);
  for (const p of pairs) {
    const [a, b] = [claimOf.get(p.a.eventId)!, claimOf.get(p.b.eventId)!];
    if (p.label === "same") assert.equal(a.id, b.id);
    if (p.label === "contradicts") assert.ok(a.id !== b.id && a.subject === b.subject);
    if (p.label === "unrelated") assert.ok(a.subject !== b.subject && a.domain === b.domain);
    for (const s of [p.a, p.b]) {
      const event = stream.events.find((e) => e.id === s.eventId)!;
      assert.equal(s.sourceId, event.source.id);
      assert.equal(s.text, event.content);
    }
  }
  assert.deepEqual(claimPairs(generate(1)), pairs, "deterministic");
});

test("relevance labels: every event judged for every probe, and only the expected claim is relevant", () => {
  const labels = relevanceLabels(stream);
  for (const probe of stream.probes) {
    const rows = labels.filter((l) => l.probeId === probe.id);
    assert.equal(rows.length, stream.events.filter((e) => e.persona === probe.persona).length);
    const relevant = rows.filter((r) => r.relevance === 1);
    assert.ok(relevant.length >= 1);
    assert.ok(relevant.every((r) => claimOf.get(r.eventId)!.id === probe.expect && r.reason === "answer"));
  }
  // Each subject has exactly one current claim, so a same-subject non-answer is stale or false.
  for (const subject of new Set(stream.claims.map((c) => c.subject))) {
    assert.equal(stream.claims.filter((c) => c.subject === subject && status(c) === "current").length, 1, subject);
  }
});

test("a memory system searches with whatever ranker it is given", async () => {
  const dir = await mkdtemp(join(tmpdir(), "memparole-test-"));
  try {
    const lastFirst: Ranker = { name: "last-first", rank: async (_q, entries, k) => entries.toReversed().slice(0, k) };
    const memory = new PlainFileMemory({ path: join(dir, "m.md"), model: new FakeModel(["one", "two"]), ranker: lastFirst });
    await memory.ingest({ ...stream.events[0], id: "a" });
    await memory.ingest({ ...stream.events[0], id: "b" });
    assert.deepEqual((await memory.search("anything", 5)).map((e) => e.text), ["two", "one"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
