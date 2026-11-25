// A scripted model for tests and offline runs: no keys, no network, no cost, deterministic.
// It answers from a queue of replies, or with a function, and records every request.
import type { Model, ModelRequest } from "./model.ts";

/** The default behaviour: a perfectly compliant note-taker that writes down the message's last line. */
export const lastLine = (request: ModelRequest) => request.message.trimEnd().split("\n").at(-1) ?? "";

export class FakeModel implements Model {
  readonly name = "fake";
  readonly calls: ModelRequest[] = [];
  #replies: string[] | null;
  #respond: (request: ModelRequest) => string;

  constructor(script: string[] | ((request: ModelRequest) => string) = lastLine) {
    this.#replies = Array.isArray(script) ? [...script] : null;
    this.#respond = Array.isArray(script) ? () => "" : script;
  }

  async complete(request: ModelRequest) {
    this.calls.push(request);
    if (!this.#replies) return this.#respond(request);
    const reply = this.#replies.shift();
    if (reply === undefined) throw new Error(`FakeModel: no scripted reply left for call ${this.calls.length}`);
    return reply;
  }
}
