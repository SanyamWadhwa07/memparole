// npm run bench -- generate [--seed N]           print a stream as JSON
// npm run bench -- labels [--seed N]             print claim pairs and relevance labels for training
// npm run bench -- run [--seed N] [--json]       replay it into the no-defense baseline and grade it
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { generate } from "./bench/generate.ts";
import { grade, type Mean, type Rate } from "./bench/grade.ts";
import { claimPairs, relevanceLabels } from "./bench/labels.ts";
import { run } from "./bench/run.ts";
import { FakeModel } from "./fake-model.ts";
import { PlainFileMemory } from "./systems/plain-file.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { seed: { type: "string", default: "1" }, json: { type: "boolean", default: false } },
});
const seed = Number(values.seed);
if (!Number.isInteger(seed)) throw new Error(`--seed must be an integer, got ${values.seed}`);
const stream = generate(seed);

if (positionals[0] === "generate") {
  console.log(JSON.stringify(stream, null, 2));
} else if (positionals[0] === "labels") {
  console.log(JSON.stringify({ seed, claimPairs: claimPairs(stream), relevance: relevanceLabels(stream) }, null, 2));
} else if (positionals[0] === "run") {
  const dir = mkdtempSync(join(tmpdir(), "memparole-"));
  try {
    const report = grade(stream, await run(stream, (persona) => new PlainFileMemory({ path: join(dir, `${persona}.md`), model: new FakeModel() })));
    if (values.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const pct = (r: Rate) => (r.rate === null ? "n/a" : `${(100 * r.rate).toFixed(1)}% (${r.hits}/${r.total})`);
      const avg = (m: Mean) => (m.mean === null ? "n/a" : `${m.mean.toFixed(2)} (over ${m.count})`);
      const o = report.overall;
      console.log(`system ${report.system}, model fake (offline, scripted), seed ${seed}, ${stream.personas.length} personas, ${stream.days} days`);
      console.log(`  pollution rate          ${pct(o.pollution)}`);
      console.log(`  true-fact recall        ${pct(o.trueFactRecall)}`);
      console.log(`  false-quarantine rate   ${pct(o.falseQuarantine)}`);
      console.log(`  stale-answer rate       ${pct(o.staleAnswer)}`);
      console.log(`  NDCG@5                  ${avg(o.ndcgAt5)}`);
      console.log(`  wake tokens / idle day  ${avg(o.wakeTokensPerIdleDay)} (estimated, 4 chars per token)`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  console.error("usage: npm run bench -- generate|labels|run [--seed N] [--json]");
  process.exitCode = 1;
}
