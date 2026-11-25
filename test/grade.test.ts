// The grader on a hand-built stream, small enough to check every number by hand.
import assert from "node:assert/strict";
import { test } from "node:test";
import { grade } from "../src/bench/grade.ts";
import type { PersonaTrace } from "../src/bench/run.ts";
import type { MemoryEntry } from "../src/bench/system.ts";
import type { BenchEvent, Claim, Stream } from "../src/bench/types.ts";

const claim = (id: string, subject: string, truthful: boolean, supersededBy: string | null = null): Claim => ({
  id, persona: "p", domain: "personal", subject, statement: id, truthful, supersededBy,
});
const event = (id: string, day: number, claimId: string | null, actor: "owner" | "feed" = "owner"): BenchEvent => ({
  id, persona: "p", day, at: "", kind: "owner_chat", session: "main", source: { id: actor, actor }, content: id, claimId,
});

// Subject "city": c1 was replaced by c2. Subject "job": j1 is true, jf is planted.
const stream: Stream = {
  version: 1, seed: 0, days: 2, start: "2026-11-02", personas: ["p"],
  claims: [claim("c1", "city", true, "c2"), claim("c2", "city", true), claim("j1", "job", true), claim("jf", "job", false)],
  events: [event("e1", 0, "c1"), event("e2", 0, "j1"), event("e3", 1, "jf", "feed"), event("e4", 1, "c2", "feed"), event("e5", 0, null)],
  probes: [
    { id: "q-city", persona: "p", subject: "city", question: "", expect: "c2" },
    { id: "q-job", persona: "p", subject: "job", question: "", expect: "j1" },
  ],
};
const e = (source: string, trust: MemoryEntry["trust"] = "trusted"): MemoryEntry => ({ text: source, trust, sources: [source] });
const trace = (t: Partial<PersonaTrace>) => grade(stream, { system: "test", seed: 0, personas: [{ persona: "p", wakeTokens: [10, 30], wake: [], inventory: [], answers: [], ...t }] });

test("a perfect system: no pollution, full recall, nothing stale, NDCG 1", () => {
  const kept = [e("e2"), e("e4")];
  const m = trace({ wake: kept, inventory: kept, answers: [{ probeId: "q-city", results: [e("e4")] }, { probeId: "q-job", results: [e("e2")] }] }).overall;
  assert.deepEqual(m.pollution, { hits: 0, total: 1, rate: 0 });
  assert.deepEqual(m.trueFactRecall, { hits: 2, total: 2, rate: 1 });
  assert.deepEqual(m.falseQuarantine, { hits: 0, total: 2, rate: 0 });
  assert.deepEqual(m.staleAnswer, { hits: 0, total: 1, rate: 0 });
  assert.equal(m.ndcgAt5.mean, 1);
});

test("keeping everything trusted counts the planted claim as pollution; a stale claim is not current", () => {
  const all = ["e1", "e2", "e3", "e4", "e5"].map((s) => e(s));
  const m = trace({ wake: all, inventory: all }).overall;
  assert.deepEqual(m.pollution, { hits: 1, total: 1, rate: 1 });
  assert.deepEqual(m.trueFactRecall, { hits: 2, total: 2, rate: 1 }, "c1 is stale, so the total is 2 not 3");
});

test("a true claim held only as untrusted is a false quarantine and not recalled", () => {
  const m = trace({ wake: [e("e2")], inventory: [e("e2"), e("e4", "untrusted")] }).overall;
  assert.deepEqual(m.trueFactRecall, { hits: 1, total: 2, rate: 0.5 });
  assert.deepEqual(m.falseQuarantine, { hits: 1, total: 2, rate: 0.5 });
  const untrustedWake = trace({ wake: [e("e3", "untrusted")], inventory: [e("e3", "untrusted")] }).overall;
  assert.equal(untrustedWake.pollution.hits, 0, "only trusted memory pollutes");
});

test("the stale answer ranked first counts as stale; NDCG uses the rank of the right claim", () => {
  const m = trace({
    answers: [
      { probeId: "q-city", results: [e("e5"), e("e1"), e("e4")] }, // chatter, then the old city, then the new one at rank 3
      { probeId: "q-job", results: [e("e3")] }, // only the planted claim
    ],
  }).overall;
  assert.deepEqual(m.staleAnswer, { hits: 1, total: 1, rate: 1 });
  assert.equal(m.ndcgAt5.sum, 1 / Math.log2(4)); // 0.5 for q-city, 0 for q-job
  assert.equal(m.ndcgAt5.mean, 0.25);
});

test("results past the fifth are ignored, and unknown sources match nothing", () => {
  const filler = ["x1", "x2", "x3", "x4", "x5"].map((s) => e(s));
  const m = trace({ answers: [{ probeId: "q-job", results: [...filler, e("e2")] }] }).overall;
  assert.equal(m.ndcgAt5.sum, 0);
});

test("wake tokens are averaged over days the owner never spoke", () => {
  // The owner spoke on day 0 only (e1, e2, e5); day 1 had only feed events.
  assert.deepEqual(trace({}).overall.wakeTokensPerIdleDay, { sum: 30, count: 1, mean: 30 });
});
