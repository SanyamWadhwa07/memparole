// Memparole as a benchmarked memory system. The owner's words are trusted; everything else waits
// in quarantine until independent sources corroborate it (or the owner reviews it). Only trusted
// memory is injected at wake-up; quarantined memory is reachable through search, marked untrusted.
import type { MemoryEntry, MemorySystem } from "../bench/system.ts";
import type { Observation } from "../bench/types.ts";
import { corroborate } from "../core/corroborate.ts";
import { Store } from "../core/store.ts";
import { exactMatcher, type ClaimMatcher } from "../matching.ts";
import { keywordRanker, type Ranker } from "../ranking.ts";

export class MemparoleMemory implements MemorySystem {
  readonly name: string;
  readonly store: Store;
  #matcher: ClaimMatcher;
  #ranker: Ranker;
  #parole: boolean;
  #now = "";

  /**
   * parole: false gives the "quarantine-only" baseline: the same provenance and quarantine, but no
   * way back out. It models the class of policy OpenClaw ships today, not OpenClaw's code.
   */
  constructor(options: { path?: string; matcher?: ClaimMatcher; ranker?: Ranker; parole?: boolean } = {}) {
    this.store = new Store(options.path ?? ":memory:");
    this.#matcher = options.matcher ?? exactMatcher;
    this.#ranker = options.ranker ?? keywordRanker;
    this.#parole = options.parole ?? true;
    this.name = this.#parole ? "memparole" : "quarantine-only";
  }

  async ingest(o: Observation) {
    this.#now = o.at;
    const entry = this.store.add(
      { content: o.content, origin: o.source.actor === "owner" ? "owner" : "untrusted", session: o.session, sourceIds: [o.id], source: o.source, observedAt: o.at, supersessionKey: null },
      o.at,
    );
    if (this.#parole) await corroborate(this.store, entry.id, this.#matcher, o.at);
  }

  /** Everything not retired, after re-checking that trusted entries still match what was reviewed. */
  #held(): MemoryEntry[] {
    this.store.verify(this.#now);
    return this.store.entries("trusted", "quarantined").map((e) => ({ text: e.content, trust: e.state === "trusted" ? "trusted" : "untrusted", sources: e.sourceIds }));
  }

  async wake() {
    return this.#held().filter((e) => e.trust === "trusted");
  }

  async inspect() {
    return this.#held();
  }

  async search(query: string, k: number) {
    return this.#ranker.rank(query, this.#held(), k);
  }
}
