#!/usr/bin/env bun
/**
 * Queue initializer — populates a filesystem queue from ACT test cases.
 *
 * Usage:
 *   bun eval/queue-init.ts [--cases act-test-cases.json] [--dir /tmp/eval-queue]
 *   bun eval/queue-init.ts --rules 80af7b,afw4f7   # subset of rules
 *   bun eval/queue-init.ts --criteria 1.4.3,2.1.2   # subset by criterion
 *
 * Creates:
 *   <dir>/pending/001.json   — case files (URL + criterion, NO expected values)
 *   <dir>/claimed/           — empty, agents mv files here
 *   <dir>/results/           — empty, agents write verdicts here
 *   <dir>/ground-truth.json  — expected outcomes, only used by queue-score.ts
 */

import { parseArgs } from "util";
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";

const { values } = parseArgs({
  options: {
    cases: { type: "string", default: "eval/act-test-cases.json" },
    dir: { type: "string", default: "/tmp/eval-queue" },
    rules: { type: "string", default: "" },
    criteria: { type: "string", default: "" },
    clean: { type: "boolean", default: false },
  },
});

// Load test cases
const casesFile = Bun.file(values.cases!);
const data = await casesFile.json();

// Load criteria for testTools/testMethod
const criteriaFile = Bun.file("skills/acr/criteria.json");
const criteriaData = await criteriaFile.json();
const criteriaMap = new Map<string, any>();
for (const c of criteriaData.criteria) {
  criteriaMap.set(c.id, c);
}

// Filter rules if specified
const ruleFilter = values.rules ? new Set(values.rules.split(",")) : null;
const critFilter = values.criteria ? new Set(values.criteria.split(",")) : null;

// Flatten test cases
interface QueueCase {
  id: number;
  url: string;
  ruleId: string;
  ruleName: string;
  criterion: string;
  criterionName: string;
  testTools: string[];
  testMethod: Record<string, string>;
}

interface GroundTruth {
  id: number;
  url: string;
  ruleId: string;
  criterion: string;
  expected: string; // normalized: pass/fail/inapplicable
  description: string;
}

const queueCases: QueueCase[] = [];
const groundTruth: GroundTruth[] = [];
let id = 0;

for (const rule of data.rules) {
  // Apply filters
  if (ruleFilter && !ruleFilter.has(rule.ruleId)) continue;

  const criterion = rule.wcagCriteria[0];
  if (critFilter && !critFilter.has(criterion)) continue;

  const critInfo = criteriaMap.get(criterion);
  if (!critInfo) {
    console.error(`Warning: no criteria.json entry for ${criterion}, skipping rule ${rule.ruleId}`);
    continue;
  }

  // Skip criteria with no test tools
  if (!critInfo.testTools || critInfo.testTools.length === 0) {
    console.error(`Skipping ${criterion} (${critInfo.name}): testTools is empty`);
    continue;
  }

  for (const tc of rule.testCases) {
    id++;

    // Queue case: what the agent sees (blind — no expected value)
    queueCases.push({
      id,
      url: tc.url,
      ruleId: rule.ruleId,
      ruleName: rule.ruleName,
      criterion,
      criterionName: critInfo.name,
      testTools: critInfo.testTools,
      testMethod: critInfo.testMethod,
    });

    // Ground truth: only used by scorer, never seen by agents
    const expected =
      tc.expected === "passed" ? "pass" : tc.expected === "failed" ? "fail" : tc.expected;
    groundTruth.push({
      id,
      url: tc.url,
      ruleId: rule.ruleId,
      criterion,
      expected,
      description: tc.description,
    });
  }
}

// Create directory structure (with idempotency check)
const dir = values.dir!;
if (existsSync(dir)) {
  const existingPending = existsSync(join(dir, "pending"))
    ? readdirSync(join(dir, "pending")).filter((f) => f.endsWith(".json"))
    : [];
  const existingResults = existsSync(join(dir, "results"))
    ? readdirSync(join(dir, "results")).filter((f) => f.endsWith(".json"))
    : [];

  if ((existingPending.length > 0 || existingResults.length > 0) && !values.clean) {
    console.error(
      `Queue already exists at ${dir} (${existingPending.length} pending, ${existingResults.length} results).\n` +
        `Use --clean to reset, or choose a different --dir.`,
    );
    process.exit(1);
  }

  if (values.clean) {
    for (const sub of ["pending", "claimed", "results"]) {
      const subDir = join(dir, sub);
      if (existsSync(subDir)) {
        for (const f of readdirSync(subDir)) {
          rmSync(join(subDir, f));
        }
      }
    }
    const gt = join(dir, "ground-truth.json");
    if (existsSync(gt)) rmSync(gt);
  }
}
for (const sub of ["pending", "claimed", "results"]) {
  mkdirSync(join(dir, sub), { recursive: true });
}

// Write case files to pending/
for (const c of queueCases) {
  const filename = String(c.id).padStart(4, "0") + ".json";
  writeFileSync(join(dir, "pending", filename), JSON.stringify(c, null, 2));
}

// Write ground truth (separate file, never given to agents)
writeFileSync(join(dir, "ground-truth.json"), JSON.stringify(groundTruth, null, 2));

console.log(`Queue initialized: ${dir}`);
console.log(`  ${queueCases.length} cases in pending/`);
console.log(`  ${groundTruth.length} ground truth entries`);
console.log(`  ${new Set(queueCases.map((c) => c.criterion)).size} criteria`);
console.log(`  ${new Set(queueCases.map((c) => c.ruleId)).size} rules`);

// Summary by criterion
const byCrit = new Map<string, number>();
for (const c of queueCases) {
  byCrit.set(c.criterion, (byCrit.get(c.criterion) || 0) + 1);
}
console.log(`\nCases per criterion:`);
for (const [crit, count] of [...byCrit.entries()].sort()) {
  const name = criteriaMap.get(crit)?.name || "?";
  console.log(`  ${crit} ${name}: ${count}`);
}
