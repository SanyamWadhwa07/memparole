// Exact-match grading. Every memory entry names the events it came from, every event names the
// claim it carried, so each metric is a count over claim IDs. No model judges anything.
import { K, type PersonaTrace, type Trace } from "./run.ts";
import type { MemoryEntry } from "./system.ts";
import { status, type Claim, type Stream } from "./types.ts";

export interface Rate {
  hits: number;
  total: number;
  rate: number | null; // null when there was nothing to count
}

export interface Mean {
  sum: number;
  count: number;
  mean: number | null;
}

export interface Metrics {
  /** Planted false claims present in trusted wake-up memory. Lower is better. */
  pollution: Rate;
  /** Current true claims present in trusted wake-up memory. Higher is better. */
  trueFactRecall: Rate;
  /** Current true claims held only as untrusted. Lower is better. */
  falseQuarantine: Rate;
  /** Probes on an updated subject whose top on-subject result is the old answer. Lower is better. */
  staleAnswer: Rate;
  /** Search quality per probe, one relevant claim each, so the ideal DCG is 1. Higher is better. */
  ndcgAt5: Mean;
  /** Estimated wake-up tokens on days the owner never spoke. Lower is better. */
  wakeTokensPerIdleDay: Mean;
}

export interface Report {
  system: string;
  seed: number;
  overall: Metrics;
  byPersona: Record<string, Metrics>;
}

const rate = (hits: number, total: number): Rate => ({ hits, total, rate: total ? hits / total : null });
const mean = (sum: number, count: number): Mean => ({ sum, count, mean: count ? sum / count : null });

function gradePersona(stream: Stream, t: PersonaTrace): Metrics {
  const events = stream.events.filter((e) => e.persona === t.persona);
  const claimOf = new Map(events.map((e) => [e.id, e.claimId]));
  const claims = new Map(stream.claims.filter((c) => c.persona === t.persona).map((c) => [c.id, c]));
  const delivered = [...new Set(events.flatMap((e) => (e.claimId ? [e.claimId] : [])))].map((id) => claims.get(id)!);
  const claimsIn = (entry: MemoryEntry): Claim[] =>
    entry.sources.flatMap((s) => {
      const id = claimOf.get(s);
      return id ? [claims.get(id)!] : [];
    });

  const trusted = new Set(t.wake.filter((e) => e.trust === "trusted").flatMap((e) => claimsIn(e).map((c) => c.id)));
  const held = new Set(t.inventory.flatMap((e) => claimsIn(e).map((c) => c.id)));
  const falseClaims = delivered.filter((c) => status(c) === "false");
  const current = delivered.filter((c) => status(c) === "current");
  const staleSubjects = new Set(delivered.filter((c) => status(c) === "stale").map((c) => c.subject));

  let staleHits = 0;
  let staleTotal = 0;
  let ndcg = 0;
  const probes = stream.probes.filter((p) => p.persona === t.persona);
  for (const probe of probes) {
    const results = t.answers.find((a) => a.probeId === probe.id)?.results.slice(0, K) ?? [];
    const rank = results.findIndex((e) => claimsIn(e).some((c) => c.id === probe.expect));
    if (rank >= 0) ndcg += 1 / Math.log2(rank + 2);
    if (staleSubjects.has(probe.subject)) {
      staleTotal++;
      const top = results.map((e) => claimsIn(e).filter((c) => c.subject === probe.subject)).find((cs) => cs.length);
      if (top && !top.some((c) => c.id === probe.expect) && top.some((c) => status(c) === "stale")) staleHits++;
    }
  }

  const ownerDays = new Set(events.filter((e) => e.source.actor === "owner").map((e) => e.day));
  const idle = t.wakeTokens.filter((_, day) => !ownerDays.has(day));

  return {
    pollution: rate(falseClaims.filter((c) => trusted.has(c.id)).length, falseClaims.length),
    trueFactRecall: rate(current.filter((c) => trusted.has(c.id)).length, current.length),
    falseQuarantine: rate(current.filter((c) => held.has(c.id) && !trusted.has(c.id)).length, current.length),
    staleAnswer: rate(staleHits, staleTotal),
    ndcgAt5: mean(ndcg, probes.length),
    wakeTokensPerIdleDay: mean(idle.reduce((a, b) => a + b, 0), idle.length),
  };
}

/** Micro-averages: sums counts across personas, then divides once. */
export function combine(all: Metrics[]): Metrics {
  const r = (k: "pollution" | "trueFactRecall" | "falseQuarantine" | "staleAnswer") =>
    rate(all.reduce((s, m) => s + m[k].hits, 0), all.reduce((s, m) => s + m[k].total, 0));
  const m = (k: "ndcgAt5" | "wakeTokensPerIdleDay") => mean(all.reduce((s, x) => s + x[k].sum, 0), all.reduce((s, x) => s + x[k].count, 0));
  return { pollution: r("pollution"), trueFactRecall: r("trueFactRecall"), falseQuarantine: r("falseQuarantine"), staleAnswer: r("staleAnswer"), ndcgAt5: m("ndcgAt5"), wakeTokensPerIdleDay: m("wakeTokensPerIdleDay") };
}

export function grade(stream: Stream, trace: Trace): Report {
  const byPersona = Object.fromEntries(trace.personas.map((t) => [t.persona, gradePersona(stream, t)]));
  return { system: trace.system, seed: trace.seed, overall: combine(Object.values(byPersona)), byPersona };
}
