// The owner command line, run as a real process against a real database file.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { trackedWrite } from "../src/core/files.ts";
import { sha256, Store } from "../src/core/store.ts";

const dir = await mkdtemp(join(tmpdir(), "memparole-owner-"));
after(() => rm(dir, { recursive: true, force: true }));

const owner = (...args: string[]) => {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "src/owner.ts", ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

test("inspect, refuse a wrong hash, review the right one, and show it in the log", async () => {
  const db = join(dir, "memory.db");
  const content = "# Memory\n- Standup at 10:00.\n";
  const store = new Store(db);
  const { entry } = trackedWrite(store, { path: "MEMORY.md", content, contentBefore: null, writer: "agent", senderIsOwner: true, turnTainted: true, session: "main", at: "2026-11-26T02:00:00.000Z" });
  store.close();
  const disk = join(dir, "MEMORY.md");
  await writeFile(disk, content);

  assert.match(owner("inspect", "--db", db).out, /quarantined .*file:MEMORY\.md[\s\S]*quarantine by system: tainted-turn/);
  assert.equal(JSON.parse(owner("inspect", "--db", db, "--file", "MEMORY.md", "--disk", disk).out).status, "untrusted");

  const wrong = owner("review", "--db", db, "--id", String(entry.id), "--hash", sha256("other bytes"), "--parole", "--reason", "looked fine");
  assert.equal(wrong.code, 1);
  assert.match(wrong.err, /does not match the reviewed hash/);

  const right = owner("review", "--db", db, "--id", String(entry.id), "--hash", entry.hash, "--parole", "--reason", "I read it; it is mine");
  assert.equal(right.code, 0, right.err);
  assert.equal(JSON.parse(owner("inspect", "--db", db, "--file", "MEMORY.md", "--disk", disk).out).status, "owner-approved");
  assert.match(owner("log", "--db", db).out, /parole\s+owner\s+\w{12}\s+I read it; it is mine/);
});
