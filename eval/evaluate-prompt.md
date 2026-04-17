## Task: A11y Auditor Evaluation (Orca / Linux)

Evaluate the a11y-auditor's detection accuracy by running it against
W3C ACT Rules test cases — standalone HTML pages with known expected
outcomes (pass/fail/inapplicable) per WCAG criterion. For each test
case, run an audit using the appropriate tools, then compare our
results against ground truth.

### Setting up sprites

Before running any audits, prepare one or more sprites. The user
must provide a **run name** — a short unique slug for this eval run
(e.g., `baseline`, `contrast-fix`, `v2`). If they haven't provided
one, ask for it before proceeding.

Determine which branch to evaluate. If no specific branch is
requested, use `main`.

```bash
# 1. Create the sprite (named after the run, or use existing sprites)
sprite create <run-name> --skip-console

# 2. Bootstrap it — pipe the local script since the repo may be private
cat eval/sprite-bootstrap.sh | sprite exec -s <run-name> -- bash -s -- <branch>
```

> **Private repo?** The `curl` approach from GitHub will 404 for
> private repos. Always prefer piping the local file as shown above.

**Do this automatically at the start of the evaluation.** Do not ask
the user to create the sprite — that is your job.

#### Checkpoint optimization

The cold bootstrap takes ~15 minutes (apt-get, bun install, playwright
download). To skip this on subsequent runs, use sprite checkpoints:

```bash
# After first successful bootstrap — save a checkpoint
sprite checkpoint create -s <run-name>

# On future runs — restore instead of bootstrapping
sprite create <new-run-name> --skip-console
sprite restore <checkpoint-id> -s <new-run-name>
# Then just fetch the branch you want to evaluate:
sprite exec -s <new-run-name> -- bash -c 'cd $HOME/a11y-auditor && git fetch origin && git checkout <branch>'
```

Check for existing checkpoints with `sprite checkpoint list -s <name>`
before running a full bootstrap.

#### Working directory and PATH

The bootstrap installs the repo to `$HOME/a11y-auditor` on the sprite
(typically `/home/sprite/a11y-auditor`). It also appends bun and
node global bin directories to `~/.bashrc`.

All commands on the sprite need this PATH prefix:

```bash
sprite exec -s <name> -- bash -c 'export PATH="$HOME/.bun/bin:/.sprite/languages/node/nvm/versions/node/v22.20.0/bin:$PATH" && cd $HOME/a11y-auditor && COMMAND'
```

Note: The `/auditor` skill references `{sr-driver}`. On the sprite,
`{sr-driver}` = `drivers/orca/driver.ts`.

---

### Queue-based evaluation (recommended for multi-sprite runs)

For evaluations using multiple sprites in parallel, use the queue
system. This provides blind evaluation (agents never see expected
outcomes), even load distribution, and fault tolerance.

#### Step 1: Initialize the queue

```bash
# Full suite (~1,010 cases)
bun eval/queue-init.ts

# Subset by rules
bun eval/queue-init.ts --rules 80af7b,afw4f7,cf77f2

# Subset by criteria
bun eval/queue-init.ts --criteria 1.4.3,2.1.2,2.4.1

# Custom test file
bun eval/queue-init.ts --cases eval/sample-test-cases.json
```

This creates:

```
/tmp/eval-queue/
  pending/     ← case files (URL + criterion, NO expected values)
    0001.json
    0002.json
    ...
  claimed/     ← agents move files here to claim them
  results/     ← agents write verdicts here
  ground-truth.json ← ONLY used by scorer, never given to agents
```

Each case file contains only what the agent needs to audit:

```json
{
  "id": 42,
  "url": "https://...",
  "criterion": "1.4.3",
  "criterionName": "Contrast (Minimum)",
  "testTools": ["axe", "screenshot"],
  "testMethod": {
    "axe": "Check color-contrast rule...",
    "screenshot": "For axe incomplete items, visually inspect..."
  },
  "ruleId": "afw4f7",
  "ruleName": "Text has minimum contrast"
}
```

**No expected outcome. No description with "Passed/Failed Example".
The agent evaluates blind.**

#### Step 2: Start the Orca driver on each sprite

```bash
sprite exec -s <sprite> -- bash -c 'export PATH="$HOME/.bun/bin:/.sprite/languages/node/nvm/versions/node/v22.20.0/bin:$PATH" && cd $HOME/a11y-auditor && bun drivers/orca/driver.ts start https://example.com'
```

Wait for `Server ready on http://127.0.0.1:7484` before proceeding.

#### Step 3: Launch worker agents

Launch one sub-agent per sprite. Each agent loops:

1. **Claim** a case from the queue:

   ```bash
   f=$(ls /tmp/eval-queue/pending/ | head -1) \
     && mv /tmp/eval-queue/pending/$f /tmp/eval-queue/claimed/$f \
     && cat /tmp/eval-queue/claimed/$f
   ```

   If `pending/` is empty → done, exit.

2. **Collect** evidence on the sprite:

   ```bash
   sprite exec -s <sprite> -- bash -c '... && bun eval/queue-collect.ts "URL" "axe,sr,screenshot"'
   ```

   This returns JSON with: redacted HTML, accessibility snapshot,
   axe results, SR transcripts (tab sequence, landmarks, headings,
   links). Page titles are automatically redacted to prevent bias.

3. **Judge** the evidence. Using the case's `criterion`, `testMethod`
   instructions, and the collected evidence, determine a verdict:
   - **`fail`** — any tool found a violation of this specific criterion
   - **`pass`** — the page contains the relevant content type AND
     all tools confirm it meets the criterion
   - **`inapplicable`** — the page does not contain the content type
     that the criterion governs (see applicability guide below)

4. **Save** the verdict:

   ```json
   // /tmp/eval-queue/results/0042.json
   {
     "id": 42,
     "url": "https://...",
     "criterion": "1.4.3",
     "verdict": "fail",
     "toolsUsed": ["axe", "screenshot"],
     "remarks": "axe flagged color-contrast: ratio 2.32:1 on #AAA/#FFF",
     "sprite": "<sprite-name>"
   }
   ```

5. **Repeat** from step 1.

#### Worker agent prompt template

When launching sub-agents, use this structure:

```
You are an accessibility auditor evaluating web pages against WCAG criteria.
You are assigned to sprite "<sprite-name>".

## Your loop

Repeat until the queue is empty:
1. Claim: `f=$(ls /tmp/eval-queue/pending/ | head -1) && mv /tmp/eval-queue/pending/$f /tmp/eval-queue/claimed/$f`
2. Read the claimed case file
3. Collect evidence: `sprite exec -s <sprite> -- bash -c '... && bun eval/queue-collect.ts "URL" "TOOLS"'`
4. Judge: determine pass/fail/inapplicable based on criterion + evidence
5. Write verdict to /tmp/eval-queue/results/{id}.json

## Judgment guidelines

### Pass vs inapplicable (CRITICAL — most common error)

"Inapplicable" means the criterion's *preconditions* are not met —
the page simply does not contain the content type the criterion
governs. It does NOT mean "the page complies."

**Use "pass"** when the relevant content type EXISTS and meets the
criterion. Examples:
- 1.4.5 Images of Text: page has an `<img>` of a photograph (not
  text) → **pass** (images exist, none contain text)
- 1.3.3 Sensory Characteristics: page has text mentioning shapes
  but not as instructions for finding UI → **pass** (content exists,
  no sensory-only instructions)
- 2.4.6 Headings: page has a heading that accurately describes its
  section → **pass**
- 2.4.1 Bypass Blocks: page has a `<nav>` landmark → **pass** (the
  landmark IS a bypass mechanism)

**Use "inapplicable"** ONLY when the content type is entirely absent:
- 1.4.5: page has zero `<img>`, `<svg>`, `<canvas>`, `<object>`,
  `<input type=image>`, CSS background-image, or role=img elements
- 1.3.3: page has no instructions at all (just raw content)
- 1.4.2: page has no `<audio>` or `<video>` elements
- 2.1.2: page has no focusable elements (no links, buttons, inputs)
- 2.4.7: page has no elements in sequential focus order
  (all interactive elements have tabindex="-1")
- 2.1.4: page has no keyboard shortcuts, OR all shortcuts use
  non-printable keys (Escape, arrows, F-keys)
- 2.4.6: page has no heading elements at all

**When in doubt, choose "pass" over "inapplicable".** A page that
has the relevant content and handles it correctly is a pass. Only
use inapplicable when you're certain the content type is absent.

### Resolving axe "incomplete"

When axe returns "incomplete" for a rule, it means axe couldn't
compute a definitive answer — NOT that there's a violation. Common
cases:
- **color-contrast incomplete** (gradients, images, transparency):
  Check the CSS color values manually. If foreground/background
  can be determined and ratio ≥ 4.5:1 for normal text → pass.
  Only flag as fail if you can confirm the ratio is below threshold.
- **bypass incomplete**: Check for ANY of these bypass mechanisms —
  any ONE is sufficient: skip link, `<nav>` landmark, `<main>`
  landmark, heading structure. A `<nav>` alone satisfies 2.4.1.

Do NOT treat "incomplete" as "fail". Use the other tools and HTML
evidence to make a definitive call.

### Specific criteria notes

- **2.4.1 Bypass Blocks**: A `<nav>` landmark IS a valid bypass
  mechanism by itself. You don't need skip links AND headings AND
  main landmark — any single mechanism suffices.
- **2.4.6 Headings**: An empty heading (`<h1></h1>`) is inapplicable
  for "headings are descriptive" — an empty element is not
  functioning as a heading. Don't flag it as a fail for this rule.
- **1.4.5 Images of Text**: Logos are explicitly exempt. `<object>`
  elements displaying photographs are not images of text (pass).
  CSS `background-image` used for logos → pass (exempt).
- **1.3.4 Orientation**: Only applies when CSS uses orientation
  media queries with rotation transforms. Unconditional rotation
  (no media query) is a different issue. `translateX` is not a
  rotation — it doesn't lock orientation.
- **2.1.2 No Keyboard Trap**: A `tabindex="-1"` element is not in
  the tab order, so there's nothing to trap — inapplicable.

## Commands
[include sprite exec prefix, PATH setup, etc.]
```

#### Step 4: Monitor progress

```bash
echo "Pending: $(ls /tmp/eval-queue/pending/ | wc -l)"
echo "Claimed: $(ls /tmp/eval-queue/claimed/ | wc -l)"
echo "Done:    $(ls /tmp/eval-queue/results/ | wc -l)"
```

**Failure recovery:** If an agent dies, sweep stale claimed files
back to pending:

```bash
# Move anything in claimed/ back to pending/
mv /tmp/eval-queue/claimed/*.json /tmp/eval-queue/pending/ 2>/dev/null
```

#### Step 5: Score results

Once all cases are processed (pending and claimed both empty):

```bash
bun eval/queue-score.ts --run <run-name> --commit $(git rev-parse --short HEAD)
```

This compares blind verdicts against `ground-truth.json` and produces
`eval/results.json` with full metrics (precision, recall, per-criterion
breakdown, per-tool breakdown, errors).

---

### Direct evaluation (single sprite, small runs)

For quick evaluations on a single sprite without the queue system:

#### Step 1: Load test cases and criteria

Read two files from the repo:

1. **Test cases** — use `eval/smoke-test-cases.json` for a smoke test
   (~10 cases, ~15 min), `eval/sample-test-cases.json` for a quick run
   (~26 cases, ~1 hr), or `eval/act-test-cases.json` for the full suite
   (~1,010 cases, requires chunking). Use the smoke test unless told
   otherwise.
2. `skills/acr/criteria.json` — the WCAG 2.2 criteria with `testTools`
   arrays defining which tools to use per criterion

**Note on expected values:** The test case JSON uses `"passed"` /
`"failed"` / `"inapplicable"`. Normalize these to `"pass"` / `"fail"`
/ `"inapplicable"` when comparing against our verdicts.

#### Step 2: Audit each test case

For each test case, use `criteria.json` to determine the right tools:

**Tool selection (from `testTools` for the criterion under test):**

- `"axe"` — run `bun audit.ts --port 7484` for automated axe-core
  checks (port 7484 is the Orca driver's default; VoiceOver uses 7483)
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

#### Step 3: Determine our verdict

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

#### Step 4: Compare against ground truth

For each test case, compare our verdict against the expected outcome:

| Our Verdict   | Expected     | Classification |
| ------------- | ------------ | -------------- |
| fail          | fail         | True Positive  |
| pass          | pass         | True Negative  |
| fail          | pass         | False Positive |
| pass          | fail         | False Negative |
| inapplicable  | inapplicable | True Negative  |
| not_evaluated | any          | Not Evaluated  |

#### Step 5: Produce results

Save results to `eval/results.json` (see queue-score.ts output format).

#### Step 6: Write a summary

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

---

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
- **Blind evaluation preferred.** When using the queue system, agents
  never see expected outcomes. Page titles are redacted by the collector.
  Verdicts are compared against ground truth only in the scoring phase.
