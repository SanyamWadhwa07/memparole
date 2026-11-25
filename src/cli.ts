// npm run bench -- generate [--seed N]                       print a stream as JSON
// npm run bench -- labels [--seed N]                         print claim pairs and relevance labels for training
// npm run bench -- run [--system S] [--seed N] [--seeds K] [--json]
//                                                            replay seeds N..N+K-1 into a system and grade them
// npm run bench -- compare [--seed N] [--seeds K]            every system, as a Markdown table
//   S is no-defense (the default), quarantine-only or memparole
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { generate } from "./bench/generate.ts";
import { combine, grade, type Mean, type Metrics, type Rate } from "./bench/grade.ts";
import { claimPairs, relevanceLabels } from "./bench/labels.ts";
import { run } from "./bench/run.ts";
import type { SystemFactory } from "./bench/system.ts";
import { FakeModel } from "./fake-model.ts";
import { MemparoleMemory } from "./systems/memparole.ts";
import { PlainFileMemory } from "./systems/plain-file.ts";

const SYSTEMS: Record<string, { uses: string; make: (dir: string) => SystemFactory }> = {
  "no-defense": { uses: "scripted fake note-taker", make: (dir) => (persona) => new PlainFileMemory({ path: join(dir, `${persona}.md`), model: new FakeModel() }) },
  "quarantine-only": { uses: "no model", make: () => () => new MemparoleMemory({ parole: false }) },
  memparole: { uses: "exact-text matcher, no model", make: () => () => new MemparoleMemory() },
};

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    seed: { type: "string", default: "1" },
    seeds: { type: "string", default: "1" },
    system: { type: "string", default: "no-defense" },
    json: { type: "boolean", default: false },
  },
});
const [seed, count] = [Number(values.seed), Number(values.seeds)];
if (!Number.isInteger(seed) || !Number.isInteger(count) || count < 1) throw new Error("--seed and --seeds must be integers, --seeds at least 1");
if (!SYSTEMS[values.system]) throw new Error(`--system must be one of ${Object.keys(SYSTEMS).join(", ")}`);
const seeds = Array.from({ length: count }, (_, i) => seed + i);

/** Grades one system on every seed and sums the counts. */
async function measure(system: string): Promise<Metrics> {
  const dir = mkdtempSync(join(tmpdir(), "memparole-"));
  try {
    const all: Metrics[] = [];
    for (const s of seeds) {
      const stream = generate(s);
      const sub = join(dir, `seed${s}`);
      mkdirSync(sub);
      all.push(grade(stream, await run(stream, SYSTEMS[system].make(sub))).overall);
    }
    return combine(all);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const pct = (r: Rate) => (r.rate === null ? "n/a" : `${(100 * r.rate).toFixed(1)}% (${r.hits}/${r.total})`);
const avg = (m: Mean, digits = 2) => (m.mean === null ? "n/a" : m.mean.toFixed(digits));
const seedText = count === 1 ? `seed ${seed}` : `seeds ${seed} to ${seed + count - 1}`;

if (positionals[0] === "generate") {
  console.log(JSON.stringify(generate(seed), null, 2));
} else if (positionals[0] === "labels") {
  const stream = generate(seed);
  console.log(JSON.stringify({ seed, claimPairs: claimPairs(stream), relevance: relevanceLabels(stream) }, null, 2));
} else if (positionals[0] === "run") {
  const o = await measure(values.system);
  if (values.json) {
    console.log(JSON.stringify({ system: values.system, seeds, overall: o }, null, 2));
  } else {
    console.log(`system ${values.system} (${SYSTEMS[values.system].uses}), ${seedText}`);
    console.log(`  pollution rate          ${pct(o.pollution)}`);
    console.log(`  true-fact recall        ${pct(o.trueFactRecall)}`);
    console.log(`  false-quarantine rate   ${pct(o.falseQuarantine)}`);
    console.log(`  stale-answer rate       ${pct(o.staleAnswer)}`);
    console.log(`  NDCG@5                  ${avg(o.ndcgAt5)} (over ${o.ndcgAt5.count} probes)`);
    console.log(`  wake tokens / idle day  ${avg(o.wakeTokensPerIdleDay, 0)} (estimated, 4 chars per token)`);
  }
} else if (positionals[0] === "compare") {
  console.log(`| System | Pollution | True-fact recall | False quarantine | Stale answers | NDCG@5 | Wake tokens / idle day |`);
  console.log(`|---|---|---|---|---|---|---|`);
  for (const system of Object.keys(SYSTEMS)) {
    const o = await measure(system);
    console.log(`| ${system} | ${pct(o.pollution)} | ${pct(o.trueFactRecall)} | ${pct(o.falseQuarantine)} | ${pct(o.staleAnswer)} | ${avg(o.ndcgAt5)} | ${avg(o.wakeTokensPerIdleDay, 0)} |`);
  }
  console.log(`\nParoleBench v1, ${seedText}, 2 personas x 7 days per seed.`);
} else {
  console.error("usage: npm run bench -- generate|labels|run|compare [--seed N] [--seeds K] [--system S] [--json]");
  process.exitCode = 1;
}
