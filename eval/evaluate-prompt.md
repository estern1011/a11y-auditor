## Task: A11y Auditor Evaluation (Orca / Linux)

Evaluate the a11y-auditor's detection accuracy by running it against
W3C ACT Rules test cases — standalone HTML pages with known expected
outcomes (pass/fail/inapplicable) per WCAG criterion. For each test
case, run an audit using the appropriate tools, then compare our
results against ground truth.

### Setting up a sprite

The `sprite` CLI is pre-installed and authenticated. Create a fresh
sprite and bootstrap it:

```bash
sprite create <your-sprite-name> --skip-console

# Bootstrap with the current branch (pass branch name to evaluate
# unpushed changes instead of main):
sprite exec -s <your-sprite-name> -- bash -c "$(curl -fsSL https://raw.githubusercontent.com/estern1011/a11y-auditor/main/eval/sprite-bootstrap.sh)" -- <branch-name>
```

All audit commands run on the sprite via `sprite exec`. Use
`--dir /root/a11y-auditor` for commands that need the repo:

```bash
sprite exec -s <your-sprite-name> --dir /root/a11y-auditor -- <command>
```

All commands from the `/auditor` skill must be prefixed with:
```
sprite exec -s <your-sprite-name> --dir /root/a11y-auditor --
```

Note: The `/auditor` skill references `{sr-driver}`. On the sprite,
`{sr-driver}` = `drivers/orca/driver.ts`.

### Step 1: Load test cases and criteria

Read two files from the repo:

1. `eval/act-test-cases.json` — the ground truth test cases (collected
   separately via the collect prompt)
2. `skills/acr/criteria.json` — the WCAG 2.2 criteria with `testTools`
   arrays defining which tools to use per criterion

### Step 2: Audit each test case

For each test case, use `criteria.json` to determine the right tools:

**Tool selection (from `testTools` for the criterion under test):**

- `"axe"` — run `bun audit.ts --port 7484` for automated axe-core checks
  (port 7484 is the Orca driver's default; VoiceOver uses 7483)
- `"sr"` — use the screen reader driver for keyboard navigation and
  announcement verification (includes keyboard interaction testing)
- `"screenshot"` — use `agent-browser --cdp 9223 screenshot` plus
  DOM/CSS inspection via `agent-browser --cdp 9223 snapshot -i`

**Only run the tools listed in `testTools` for the criterion.** Don't
run a full 7-phase audit on every test case — these are single-element
pages testing one criterion each. Use the `testMethod` instructions for
each tool to know exactly what to check.

**If a criterion has `testTools: []`**, skip it — our tools can't
evaluate it (see the `note` field for why).

### Step 3: Determine our verdict

For each test case, collapse our tool output into a verdict:

- **Any tool flags a violation** → `"fail"`
- **All applicable tools confirm no issues** → `"pass"`
- **No tools in `testTools` can test this** → `"not_evaluated"`
- **Criterion is not relevant to the page content** → `"inapplicable"`

**Resolving axe "incomplete" items:** If axe returns "incomplete" for a
test case, use the other tools in `testTools` to make a definitive call.
If after using all available tools you still can't determine pass/fail,
flag it as a coverage gap — this means `testTools` in `criteria.json`
needs updating.

A pass requires all applicable tools to agree. A fail requires any
single tool to flag an issue.

### Step 4: Compare against ground truth

For each test case, compare our verdict against the expected outcome:

| Our Verdict | Expected | Classification |
|-------------|----------|----------------|
| fail        | fail     | True Positive  |
| pass        | pass     | True Negative  |
| fail        | pass     | False Positive |
| pass        | fail     | False Negative |
| inapplicable | inapplicable | True Negative |
| not_evaluated | any    | Not Evaluated  |

### Step 5: Produce results

Save results to `eval/results.json`:

```json
{
  "date": "2026-04-12",
  "sprite": "<your-sprite-name>",
  "commit": "<git commit hash of a11y-auditor on sprite>",
  "summary": {
    "total": 187,
    "truePositive": 82,
    "trueNegative": 71,
    "falsePositive": 12,
    "falseNegative": 15,
    "notEvaluated": 7,
    "precision": 0.87,
    "recall": 0.85
  },
  "byCriterion": {
    "1.1.1": {
      "tp": 12, "tn": 8, "fp": 0, "fn": 1,
      "precision": 1.0, "recall": 0.92
    }
  },
  "byTool": {
    "axe": { "tp": 60, "tn": 55, "fp": 8, "fn": 5 },
    "sr": { "tp": 20, "tn": 14, "fp": 3, "fn": 8 },
    "screenshot": { "tp": 2, "tn": 2, "fp": 1, "fn": 2 }
  },
  "coverageGaps": [
    {
      "criterion": "1.4.3",
      "testCaseUrl": "https://...",
      "reason": "axe returned incomplete for color-contrast, screenshot inspection inconclusive"
    }
  ],
  "cases": [
    {
      "ruleId": "23a2a8",
      "criterion": "1.1.1",
      "url": "https://...",
      "expected": "fail",
      "actual": "fail",
      "correct": true,
      "toolsUsed": ["axe", "sr"],
      "remarks": "axe flagged image-alt violation. SR confirmed: FIND_NEXT_IMAGE announced 'image' with no description."
    }
  ]
}
```

### Step 6: Write a summary

After generating `results.json`, write `eval/results-summary.md` with:

1. **Headline metrics** — precision, recall, total accuracy
2. **Per-criterion breakdown** — which criteria we're strong/weak on
3. **Per-tool breakdown** — which tool is contributing most to accuracy
4. **Coverage gaps** — criteria where our tooling couldn't make a call
5. **False negatives** — most important failures to investigate (we said
   "pass" but ground truth says "fail")
6. **False positives** — cases where we flagged issues that aren't real
7. **Recommendations** — specific improvements to criteria.json,
   testTools mappings, or driver capabilities

### Notes

- **Multi-page criteria are excluded.** 3.2.3 Consistent Navigation,
  3.2.4 Consistent Identification, 3.2.6 Consistent Help, and 2.4.5
  Multiple Ways require multi-page comparison and have `testTools: []`
  in criteria.json. Skip these.
- **Pointer/motion criteria are excluded.** 2.5.1 Pointer Gestures,
  2.5.2 Pointer Cancellation, 2.5.4 Motion Actuation, and 2.5.7
  Dragging Movements require input modalities we can't test. Skip these.
- **If context runs long**, prioritize criteria with the weakest prior
  results and note which rules were deferred for the next run.
- **Real SR output only.** Every SR observation must come from actual
  driver commands with real transcript output. Never fabricate what the
  screen reader announced — if you can't capture it, say so.
