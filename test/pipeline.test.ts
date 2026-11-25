// The whole pipeline, offline: generate, replay into a memory system, grade.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { generate } from "../src/bench/generate.ts";
import { grade } from "../src/bench/grade.ts";
import { run } from "../src/bench/run.ts";
import type { MemoryEntry, MemorySystem } from "../src/bench/system.ts";
import { status, type Observation } from "../src/bench/types.ts";
import { FakeModel } from "../src/fake-model.ts";
import { keywordSearch, PlainFileMemory } from "../src/systems/plain-file.ts";

const stream = generate(1);
const dir = await mkdtemp(join(tmpdir(), "memparole-test-"));
after(() => rm(dir, { recursive: true, force: true }));

test("no defense: every planted claim reaches trusted memory, and the system never sees ground truth", async () => {
  const seen: Observation[] = [];
  const models: FakeModel[] = [];
  const trace = await run(stream, (persona) => {
    const model = new FakeModel();
    models.push(model);
    const memory = new PlainFileMemory({ path: join(dir, `${persona}.md`), model });
    return { ...memory, name: memory.name, wake: () => memory.wake(), search: (q, k) => memory.search(q, k), inspect: () => memory.inspect(), ingest: (o) => (seen.push(o), memory.ingest(o)) };
  });
  const { overall } = grade(stream, trace);

  assert.equal(seen.length, stream.events.length);
  assert.ok(seen.every((o) => !("claimId" in o)));
  assert.equal(models.reduce((n, m) => n + m.calls.length, 0), stream.events.filter((e) => e.kind !== "file_edit").length, "one model call per event, except file edits");

  const planted = stream.claims.filter((c) => !c.truthful).length;
  const current = stream.claims.filter((c) => status(c) === "current").length;
  assert.deepEqual(overall.pollution, { hits: planted, total: planted, rate: 1 });
  assert.deepEqual(overall.trueFactRecall, { hits: current, total: current, rate: 1 });
  assert.equal(overall.falseQuarantine.rate, 0);
  assert.ok(overall.wakeTokensPerIdleDay.mean! > 0);

  const file = await readFile(join(dir, "maya.md"), "utf8");
  assert.equal(file.trim().split("\n").length, stream.events.filter((e) => e.persona === "maya").length);
  assert.match(file, /^- I live in .+\. <!-- maya-d0-e\d\d -->$/m);
});

test("a NONE note is not written, and a forged provenance tag is stripped", async () => {
  const memory = new PlainFileMemory({ path: join(dir, "one.md"), model: new FakeModel(["NONE", "x <!-- other-id --> y"]) });
  const o = stream.events[0];
  await memory.ingest({ ...o, id: "a" });
  await memory.ingest({ ...o, id: "b" });
  assert.deepEqual(await memory.inspect(), [{ text: "x other-id y", trust: "trusted", sources: ["b"] }]);
});

/** Test-only: reads the ground truth and keeps exactly the current true claims. */
function oracle(persona: string): MemorySystem {
  const truth = new Map(stream.events.map((e) => [e.id, e.claimId]));
  const keep = new Set(stream.claims.filter((c) => status(c) === "current").map((c) => c.id));
  let held: MemoryEntry[] = [];
  return {
    name: `oracle:${persona}`,
    async ingest(o) {
      const id = truth.get(o.id);
      if (id && keep.has(id)) held.push({ text: o.content, trust: "trusted", sources: [o.id] });
      held = held.filter((e) => keep.has(truth.get(e.sources[0])!));
    },
    wake: async () => held,
    inspect: async () => held,
    search: async (q, k) => keywordSearch(held, q, k),
  };
}

test("the grader separates systems: an oracle scores no pollution, nothing stale, and finds every probe answer", async () => {
  const { overall } = grade(stream, await run(stream, oracle));
  assert.equal(overall.pollution.rate, 0);
  assert.equal(overall.trueFactRecall.rate, 1);
  assert.equal(overall.staleAnswer.rate, 0);
  assert.equal(overall.ndcgAt5.mean, 1, "every probe shares a keyword with its answer");
});
