import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeModel } from "../src/fake-model.ts";

const req = (message: string) => ({ instructions: "note it", message });

test("by default it writes down the message's last line, and records the call", async () => {
  const model = new FakeModel();
  assert.equal(await model.complete(req("From owner:\nI live in Pune.\n")), "I live in Pune.");
  assert.deepEqual(model.calls, [req("From owner:\nI live in Pune.\n")]);
});

test("a script replies in order and fails loudly when it runs out", async () => {
  const model = new FakeModel(["first", "NONE"]);
  assert.equal(await model.complete(req("a")), "first");
  assert.equal(await model.complete(req("b")), "NONE");
  await assert.rejects(model.complete(req("c")), /no scripted reply left for call 3/);
});

test("a function reply can depend on the request", async () => {
  const model = new FakeModel((r) => (r.message.includes("feed") ? "NONE" : r.message));
  assert.equal(await model.complete(req("from feed: x")), "NONE");
  assert.equal(await model.complete(req("from owner: y")), "from owner: y");
});
