// Way out of quarantine number one: the owner reviews the exact bytes. The review names the hash
// the owner saw; if the entry no longer hashes to it, nothing happens. Only an operator may call
// it: the MCP server and the OpenClaw plugin do not expose it, and any other caller is refused.
import { sha256, type Store } from "./store.ts";

/** Who is asking. Only "operator" (the owner at the Memparole command line) may decide. */
export type Caller = "operator" | "agent-tool" | "plugin" | "non-owner";

export function ownerReview(store: Store, r: { entryId: number; hash: string; action: "parole" | "retire"; reason: string; at: string }, caller: Caller) {
  if (caller !== "operator") throw new Error(`refused: owner review needs the operator, not ${caller}`);
  const entry = store.get(r.entryId);
  if (!entry) throw new Error(`no entry ${r.entryId}`);
  if (entry.state === "retired") throw new Error(`entry ${r.entryId} is retired`);
  if (r.hash !== entry.hash || sha256(entry.content) !== entry.hash) {
    throw new Error(`entry ${r.entryId} does not match the reviewed hash; inspect it and review again`);
  }
  store.decide(entry.id, { at: r.at, actor: "owner", action: r.action, reviewedHash: r.hash, reason: r.reason });
}
