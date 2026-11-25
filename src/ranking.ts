// How a memory system orders search results. Keyword overlap is the default; BM25, embedding
// search and a learned ranker can replace it without touching the memory system.
import type { MemoryEntry } from "./bench/system.ts";

export interface Ranker {
  readonly name: string;
  /** The k best entries for the query, best first. */
  rank(query: string, entries: MemoryEntry[], k: number): Promise<MemoryEntry[]>;
}

const STOPWORDS = new Set("a an and are as at be by can do does for from has have i in is it me my of on or should so that the their there this to was what when where which who whose why will with you your".split(" "));

export function terms(text: string) {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOPWORDS.has(w)));
}

/** Entries sharing at least one query term, most shared terms first; ties keep their order, as grep would. */
export const keywordRanker: Ranker = {
  name: "keyword",
  async rank(query, entries, k) {
    const q = terms(query);
    return entries
      .map((entry) => ({ entry, score: [...terms(entry.text)].filter((w) => q.has(w)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.entry);
  },
};
