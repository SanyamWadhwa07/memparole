// The owner's command line: the only place a trust decision can be made. Nothing here is exposed
// to an agent; the MCP server has no review or inspect tool.
//
//   npm run owner -- inspect --db memory.db                       every entry, its state and why
//   npm run owner -- inspect --db memory.db --file MEMORY.md [--disk ./MEMORY.md]
//   npm run owner -- review  --db memory.db --id 7 --hash <sha256> --parole|--retire --reason "..."
//   npm run owner -- log     --db memory.db [--id 7]               the decision log
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { inspectFile } from "./core/files.ts";
import { ownerReview } from "./core/review.ts";
import { Store } from "./core/store.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    db: { type: "string" },
    id: { type: "string" },
    hash: { type: "string" },
    file: { type: "string" },
    disk: { type: "string" },
    reason: { type: "string" },
    parole: { type: "boolean", default: false },
    retire: { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!values.db) fail("usage: npm run owner -- inspect|review|log --db <file> [options]");
const store = new Store(values.db);
const short = (hash: string) => hash.slice(0, 12);

try {
  if (positionals[0] === "inspect" && values.file) {
    const onDisk = values.disk ? readFileSync(values.disk, "utf8") : null;
    console.log(JSON.stringify(inspectFile(store, values.file, onDisk, "operator"), null, 2));
  } else if (positionals[0] === "inspect") {
    for (const e of store.entries()) {
      const latest = store.decisions(e.id).at(-1)!;
      console.log(`#${e.id}  ${e.state.padEnd(11)} origin ${e.origin.padEnd(9)} ${short(e.hash)}  ${e.supersessionKey ?? ""}`);
      console.log(`     ${e.content.split("\n")[0].slice(0, 100)}`);
      console.log(`     ${latest.action} by ${latest.actor}: ${latest.reason}`);
    }
  } else if (positionals[0] === "review") {
    if (!values.id || !values.hash || !values.reason || values.parole === values.retire) {
      fail("usage: npm run owner -- review --db <file> --id <n> --hash <sha256> --parole|--retire --reason <text>");
    }
    const action = values.parole ? "parole" : "retire";
    ownerReview(store, { entryId: Number(values.id), hash: values.hash, action, reason: values.reason, at: new Date().toISOString() }, "operator");
    console.log(`#${values.id} ${action === "parole" ? "trusted" : "retired"}, bound to ${short(values.hash)}`);
  } else if (positionals[0] === "log") {
    for (const d of store.decisions(values.id ? Number(values.id) : undefined)) {
      console.log(`${d.at}  #${d.entryId}  ${d.action.padEnd(10)} ${d.actor.padEnd(20)} ${short(d.reviewedHash)}  ${d.reason}`);
    }
  } else {
    fail("usage: npm run owner -- inspect|review|log --db <file> [options]");
  }
} catch (e) {
  fail((e as Error).message);
} finally {
  store.close();
}
