// The interface every memory system implements to be benchmarked: no defense, Mem0, OpenClaw's
// memory core, OWASP Agent Memory Guard and Memparole all plug in here.
import type { Observation } from "./types.ts";

export interface MemoryEntry {
  text: string;
  /** "trusted" memory may be acted on. "untrusted" memory is quarantined and must be shown as such. */
  trust: "trusted" | "untrusted";
  /** IDs of the observations this entry came from. The grader matches claims through these. */
  sources: string[];
}

export interface MemorySystem {
  readonly name: string;
  /** Called once per event, in time order, with ground truth removed. */
  ingest(observation: Observation): Promise<void>;
  /** What is injected into the agent's context when it wakes up, with no query. */
  wake(): Promise<MemoryEntry[]>;
  /** Explicit memory search, best match first. */
  search(query: string, k: number): Promise<MemoryEntry[]>;
  /** Everything held, trusted or not. Read-only. */
  inspect(): Promise<MemoryEntry[]>;
}

/** Builds a fresh, empty memory system for one persona. */
export type SystemFactory = (persona: string) => MemorySystem | Promise<MemorySystem>;
