// Replays a stream into a memory system, one persona at a time, and records what it would tell
// the agent. Grading happens separately, from this trace and the stream's ground truth.
import type { MemoryEntry, SystemFactory } from "./system.ts";
import { observe, type Stream } from "./types.ts";

/** Search results graded per probe (NDCG@5). */
export const K = 5;

export interface PersonaTrace {
  persona: string;
  /** Estimated tokens injected at wake-up at the start of each day. */
  wakeTokens: number[];
  /** Wake-up context after the last event. */
  wake: MemoryEntry[];
  /** Everything held after the last event. */
  inventory: MemoryEntry[];
  answers: { probeId: string; results: MemoryEntry[] }[];
}

export interface Trace {
  system: string;
  seed: number;
  personas: PersonaTrace[];
}

/** A rough token count: 4 characters per token. An estimate, not a tokenizer. */
export function estimateTokens(entries: MemoryEntry[]) {
  return Math.ceil(entries.map((e) => e.text).join("\n").length / 4);
}

export async function run(stream: Stream, factory: SystemFactory): Promise<Trace> {
  let name = "";
  const personas: PersonaTrace[] = [];
  for (const persona of stream.personas) {
    const system = await factory(persona);
    name = system.name;
    const events = stream.events.filter((e) => e.persona === persona);
    const wakeTokens: number[] = [];
    for (let day = 0; day < stream.days; day++) {
      wakeTokens.push(estimateTokens(await system.wake()));
      for (const event of events.filter((e) => e.day === day)) await system.ingest(observe(event));
    }
    const answers = [];
    for (const probe of stream.probes.filter((p) => p.persona === persona)) {
      answers.push({ probeId: probe.id, results: (await system.search(probe.question, K)).slice(0, K) });
    }
    personas.push({ persona, wakeTokens, wake: await system.wake(), inventory: await system.inspect(), answers });
  }
  return { system: name, seed: stream.seed, personas };
}
