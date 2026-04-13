#!/usr/bin/env bun
/**
 * Queue scorer — compares agent verdicts against ground truth.
 *
 * Usage:
 *   bun eval/queue-score.ts [--dir /tmp/eval-queue] [--out eval/results.json]
 *
 * Reads:
 *   <dir>/results/*.json   — agent verdicts
 *   <dir>/ground-truth.json — expected outcomes (never seen by agents)
 *
 * Outputs:
 *   eval/results.json       — full results with metrics
 *   eval/results-summary.md — human-readable summary (stdout)
 */

import { parseArgs } from "util";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const { values } = parseArgs({
  options: {
    dir: { type: "string", default: "/tmp/eval-queue" },
    out: { type: "string", default: "eval/results.json" },
    commit: { type: "string", default: "" },
    run: { type: "string", default: "eval" },
  },
});

const dir = values.dir!;

// Load ground truth
const truthPath = join(dir, "ground-truth.json");
if (!existsSync(truthPath)) {
  console.error(`No ground-truth.json found at ${truthPath}`);
  process.exit(1);
}
const groundTruth: any[] = JSON.parse(readFileSync(truthPath, "utf-8"));
const truthByUrl = new Map<string, any>();
for (const t of groundTruth) {
  truthByUrl.set(t.url, t);
}

// Load agent verdicts
const resultsDir = join(dir, "results");
const resultFiles = existsSync(resultsDir)
  ? readdirSync(resultsDir).filter(f => f.endsWith(".json")).sort()
  : [];

interface Verdict {
  id: number;
  url: string;
  criterion: string;
  verdict: string; // pass / fail / inapplicable
  toolsUsed: string[];
  remarks: string;
  sprite: string;
}

const verdicts: Verdict[] = [];
for (const f of resultFiles) {
  const v = JSON.parse(readFileSync(join(resultsDir, f), "utf-8"));
  verdicts.push(v);
}

// Pending and claimed counts
const pendingCount = existsSync(join(dir, "pending"))
  ? readdirSync(join(dir, "pending")).filter(f => f.endsWith(".json")).length
  : 0;
const claimedCount = existsSync(join(dir, "claimed"))
  ? readdirSync(join(dir, "claimed")).filter(f => f.endsWith(".json")).length
  : 0;

// Match verdicts to ground truth and classify
interface CaseResult {
  ruleId: string;
  criterion: string;
  url: string;
  expected: string;
  actual: string;
  correct: boolean;
  toolsUsed: string[];
  remarks: string;
}

const cases: CaseResult[] = [];
let tp = 0, tn = 0, fp = 0, fn = 0;

for (const v of verdicts) {
  const truth = truthByUrl.get(v.url);
  if (!truth) {
    console.error(`Warning: no ground truth for ${v.url}`);
    continue;
  }

  const expected = truth.expected;
  const actual = v.verdict;
  const correct = expected === actual;

  if (actual === "fail" && expected === "fail") tp++;
  else if (actual !== "fail" && expected !== "fail") tn++;
  else if (actual === "fail" && expected !== "fail") fp++;
  else fn++;

  cases.push({
    ruleId: truth.ruleId,
    criterion: v.criterion,
    url: v.url,
    expected,
    actual,
    correct,
    toolsUsed: v.toolsUsed,
    remarks: v.remarks,
  });
}

const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
const recall = tp + fn > 0 ? tp / (tp + fn) : 0;

// By criterion
const byCriterion: Record<string, any> = {};
for (const c of cases) {
  if (!byCriterion[c.criterion]) {
    byCriterion[c.criterion] = { tp: 0, tn: 0, fp: 0, fn: 0 };
  }
  const s = byCriterion[c.criterion];
  if (c.actual === "fail" && c.expected === "fail") s.tp++;
  else if (c.actual !== "fail" && c.expected !== "fail") s.tn++;
  else if (c.actual === "fail" && c.expected !== "fail") s.fp++;
  else s.fn++;
}
for (const [, s] of Object.entries(byCriterion)) {
  const st = s as any;
  st.precision = st.tp + st.fp > 0 ? Math.round((st.tp / (st.tp + st.fp)) * 100) / 100 : 1.0;
  st.recall = st.tp + st.fn > 0 ? Math.round((st.tp / (st.tp + st.fn)) * 100) / 100 : 1.0;
}

// By tool — NOTE: these stats reflect overall case verdicts attributed to
// each tool that was used, not the tool's individual contribution. A case
// using ["axe", "sr"] that the agent gets wrong counts as a miss for both
// tools, even if one tool was correct and the other caused the error.
const byTool: Record<string, any> = { axe: { tp: 0, tn: 0, fp: 0, fn: 0 }, sr: { tp: 0, tn: 0, fp: 0, fn: 0 }, screenshot: { tp: 0, tn: 0, fp: 0, fn: 0 } };
for (const c of cases) {
  for (const tool of c.toolsUsed) {
    if (!byTool[tool]) continue;
    if (c.actual === "fail" && c.expected === "fail") byTool[tool].tp++;
    else if (c.actual !== "fail" && c.expected !== "fail") byTool[tool].tn++;
    else if (c.actual === "fail" && c.expected !== "fail") byTool[tool].fp++;
    else byTool[tool].fn++;
  }
}

// Build output
const output = {
  date: new Date().toISOString().split("T")[0],
  run: values.run,
  commit: values.commit || "unknown",
  blind: true,
  summary: {
    total: cases.length,
    truePositive: tp,
    trueNegative: tn,
    falsePositive: fp,
    falseNegative: fn,
    notEvaluated: groundTruth.length - cases.length,
    precision: Math.round(precision * 100) / 100,
    recall: Math.round(recall * 100) / 100,
  },
  byCriterion,
  byTool,
  coverageGaps: [],
  cases,
};

await Bun.write(values.out!, JSON.stringify(output, null, 2));

// Print summary to stdout
const total = cases.length;
const correct = tp + tn;
console.log(`\n=== Eval Results: ${values.run} (blind) ===\n`);
console.log(`Total cases:    ${total} evaluated, ${pendingCount} pending, ${claimedCount} claimed`);
console.log(`Ground truth:   ${groundTruth.length} cases`);
console.log(`Accuracy:       ${correct}/${total} (${(correct / total * 100).toFixed(1)}%)`);
console.log(`Precision:      ${precision.toFixed(2)}`);
console.log(`Recall:         ${recall.toFixed(2)}`);
console.log(`TP=${tp}  TN=${tn}  FP=${fp}  FN=${fn}\n`);

// Per-criterion summary
console.log(`Per-criterion:`);
for (const [crit, s] of Object.entries(byCriterion).sort()) {
  const st = s as any;
  const critTotal = st.tp + st.tn + st.fp + st.fn;
  const critCorrect = st.tp + st.tn;
  console.log(`  ${crit}: ${critCorrect}/${critTotal} (P=${st.precision} R=${st.recall})`);
}

// Errors
const errors = cases.filter(c => !c.correct);
if (errors.length > 0) {
  console.log(`\nErrors (${errors.length}):`);
  for (const e of errors.slice(0, 20)) {
    console.log(`  ${e.ruleId} ${e.criterion}: expected=${e.expected} actual=${e.actual}`);
    console.log(`    ${e.remarks.substring(0, 120)}`);
  }
  if (errors.length > 20) console.log(`  ... and ${errors.length - 20} more`);
}

console.log(`\nResults saved to ${values.out}`);
