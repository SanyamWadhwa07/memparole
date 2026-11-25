// Whether two claims state the same fact. Memparole's corroboration rule asks a ClaimMatcher;
// exact text is the default, and a trained claim-agreement model can replace it.

export type PairLabel = "same" | "contradicts" | "unrelated";

export interface ClaimMatcher {
  readonly name: string;
  match(a: string, b: string): Promise<PairLabel>;
}

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").replace(/[.!\s]+$/, "").trim();

/** Same only when the text is identical up to case, spacing and a final full stop. Never finds a contradiction. */
export const exactMatcher: ClaimMatcher = {
  name: "exact",
  async match(a, b) {
    return normalize(a) === normalize(b) ? "same" : "unrelated";
  },
};
