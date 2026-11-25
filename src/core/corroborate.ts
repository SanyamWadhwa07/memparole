// Way out of quarantine number two: two or more independent sources agree and no trusted memory
// contradicts them. A ClaimMatcher says whether two claims agree; fixed code decides the rest.
import type { Source } from "../bench/types.ts";
import type { ClaimMatcher } from "../matching.ts";
import type { Entry, Store } from "./store.ts";

// Suffixes under which anyone can register a name. A short list, not the full Public Suffix List.
const SHARED_SUFFIXES = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.in", "co.jp", "com.br", "github.io", "pages.dev", "vercel.app", "netlify.app"]);

/** "news.bbc.co.uk" gives "bbc.co.uk"; "post.devwire.example" gives "devwire.example". */
export function registrableDomain(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  const lastTwo = labels.slice(-2).join(".");
  return SHARED_SUFFIXES.has(lastTwo) && labels.length > 2 ? labels.slice(-3).join(".") : lastTwo;
}

/**
 * Two sources are independent when both are web pages on different registrable domains, they do
 * not cite one upstream, and neither cites the other's domain.
 */
export function independent(a: Source, b: Source): boolean {
  const [da, db] = [a.url && registrableDomain(a.url), b.url && registrableDomain(b.url)];
  if (!da || !db || da === db) return false;
  const oa = a.upstream ? registrableDomain(a.upstream) : da;
  const ob = b.upstream ? registrableDomain(b.upstream) : db;
  return oa !== ob && oa !== db && ob !== da;
}

/**
 * Checks a quarantined entry against every other quarantined web entry. If the matching ones come
 * from at least two independent sources and no trusted entry contradicts the claim, all of them
 * are paroled. Returns the paroled entry IDs.
 */
export async function corroborate(store: Store, entryId: number, matcher: ClaimMatcher, at: string): Promise<number[]> {
  const entry = store.get(entryId);
  if (!entry || entry.state !== "quarantined" || !entry.source.url) return [];

  const agreeing: Entry[] = [entry];
  for (const other of store.entries("quarantined")) {
    if (other.id !== entry.id && other.source.url && (await matcher.match(entry.content, other.content)) === "same") agreeing.push(other);
  }
  const witnesses: Entry[] = [];
  for (const e of agreeing) if (witnesses.every((w) => independent(w.source, e.source))) witnesses.push(e);
  if (witnesses.length < 2) return [];

  for (const trusted of store.entries("trusted")) {
    if ((await matcher.match(entry.content, trusted.content)) === "contradicts") return [];
  }

  const domains = witnesses.map((w) => registrableDomain(w.source.url!)).join(", ");
  for (const e of agreeing) {
    store.decide(e.id, { at, actor: "rule:corroboration", action: "parole", reviewedHash: e.hash, reason: `${witnesses.length} independent sources agree (${domains}) and no trusted memory contradicts them` });
  }
  return agreeing.map((e) => e.id);
}
