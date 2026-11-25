// Training and evaluation labels derived from a stream's ground truth, for the two learned parts
// planned later: a claim-agreement model (which pairs state the same fact) and a recall ranker.
// Derived, not stored, so the stream stays the single source of truth.
import type { PairLabel } from "../matching.ts";
import { status, type Stream } from "./types.ts";

export interface PairSide {
  eventId: string;
  sourceId: string;
  text: string;
}

export interface ClaimPair {
  persona: string;
  domain: string;
  label: PairLabel;
  a: PairSide;
  b: PairSide;
}

/**
 * same: two events carry one claim. contradicts: two claims answer one subject (a planted claim,
 * or a fact and its update). unrelated: two claims from one domain on different subjects, the
 * hard negatives, one per event: the next such event in time order.
 */
export function claimPairs(stream: Stream): ClaimPair[] {
  const claims = new Map(stream.claims.map((c) => [c.id, c]));
  const pairs: ClaimPair[] = [];
  for (const persona of stream.personas) {
    const events = stream.events.filter((e) => e.persona === persona && e.claimId);
    const side = (i: number): PairSide => ({ eventId: events[i].id, sourceId: events[i].source.id, text: events[i].content });
    const claim = (i: number) => claims.get(events[i].claimId!)!;
    const pair = (i: number, j: number, label: PairLabel) => pairs.push({ persona, domain: claim(i).domain, label, a: side(i), b: side(j) });
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        if (claim(i).id === claim(j).id) pair(i, j, "same");
        else if (claim(i).subject === claim(j).subject) pair(i, j, "contradicts");
      }
      const j = events.findIndex((_, j) => j > i && claim(j).domain === claim(i).domain && claim(j).subject !== claim(i).subject);
      if (j >= 0) pair(i, j, "unrelated");
    }
  }
  return pairs;
}

export interface Judgment {
  probeId: string;
  question: string;
  eventId: string;
  text: string;
  relevance: 0 | 1;
  /** Why: the answer itself, a wrong answer on the same subject, another subject, or chatter. */
  reason: "answer" | "stale" | "false" | "other_subject" | "no_claim";
}

/** Every event of a persona judged against each of its probes. Only events carrying the expected claim are relevant. */
export function relevanceLabels(stream: Stream): Judgment[] {
  const claims = new Map(stream.claims.map((c) => [c.id, c]));
  return stream.probes.flatMap((probe) =>
    stream.events
      .filter((e) => e.persona === probe.persona)
      .map((e): Judgment => {
        const c = e.claimId ? claims.get(e.claimId)! : null;
        const reason = !c ? "no_claim" : c.id === probe.expect ? "answer" : c.subject !== probe.subject ? "other_subject" : status(c) === "stale" ? "stale" : "false";
        return { probeId: probe.id, question: probe.question, eventId: e.id, text: e.content, relevance: reason === "answer" ? 1 : 0, reason };
      }),
  );
}
