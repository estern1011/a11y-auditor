# a11y-auditor v2 — Plan

**Status:** working spec. Will be stress-tested with `/grill-me` before any code is written.
**Audience:** internal, and the seed for the new repo's `docs/PLAN.md` (later `README.md` once polished for external readers).
**Branch of origin:** `claude/codespaces-agent-package-XjYlI` of `estern1011/a11y-auditor`.

---

## 1. Vision

### User story (locked, verbatim)

> A developer running *any code agent* can install the auditor via `npx skills add`, invoke `/auditor <url> --criteria <category> --level AA`, and has the criteria and categories to reference. They will get a JSONL decision log with per-criterion verdicts at confidence levels, and that log can be evaluated against our fixture suite with measurable calibration.

### One-line pitch

An LLM-driven WCAG 2.2 auditor that ships as a portable agent skill, makes targeted scoped audits, and produces a structured, append-only decision log that a human (or an orchestrator) can grade, diff, and aggregate into a VPAT.

### What v2 isn't

- A "scan our whole site" tool. Site-wide is the orchestrator's job (v2.1+).
- A replacement for human accessibility expertise. v2 explicitly flags items that need expert review.
- A hosted SaaS. v2 is a developer tool; SaaS is v3.
- A WCAG-3 / cognitive-WCAG product.
- A mobile-app audit tool.
- A multi-browser test runner (Chromium-only in v2).

---

## 2. Architecture

### Two tiers with a single contract

```
┌────────────────────────────────────────────────────────────────┐
│                       USER ENTRY POINTS                        │
│                                                                │
│  Interactive (skill)        │       Batch / CI (CLI)          │
│  /auditor <url> ...          │       npx a11y-auditor audit    │
│  Reads SKILL.md, runs CLI    │       Spawns Agent SDK + skill  │
│  subcommands via shell        │       Same subcommands         │
└──────────────────┬──────────────────────────┬─────────────────┘
                   │                          │
                   ▼                          ▼
┌────────────────────────────────────────────────────────────────┐
│                    AUDIT PRIMITIVE (SKILL)                     │
│                                                                │
│  Targeted, scoped audit of one page or one element             │
│  Inputs:   target (URL [+selector]), criteria, level, auth     │
│  Reasoning: chain-of-draft per criterion                       │
│  Output:   append-only JSONL of DecisionRecord                 │
│             + run.json + evidence/ + manifest.json              │
└──────────────────────────────┬─────────────────────────────────┘
                               │
                               ▼  decision-log JSONL is the wire
┌────────────────────────────────────────────────────────────────┐
│                  ORCHESTRATOR (v2.1+)                          │
│                                                                │
│  Composes page audits into flow/site audits, emits             │
│  flow/site-scoped records, aggregates cross-page findings,     │
│  generates VPAT / ACR. Initially a thin TS script; v3 swaps    │
│  for LangGraph when fan-out semantics warrant.                 │
└────────────────────────────────────────────────────────────────┘
```

**The seam between tiers is the decision-log schema** — a JSONL file conforming to a Zod source of truth. Anything that produces conforming records is a valid audit producer; anything that consumes them is a valid downstream tool.

### Distribution

| Channel | Surface | Audience |
|---|---|---|
| `npx skills add <source>` (skills.sh) | SKILL.md + bundled scripts/data | Devs in any code agent host |
| `npm install -g @org/a11y-auditor` | CLI binary | Devs running CLI/CI |
| `npx a11y-auditor` | Same CLI without install | Ad-hoc usage |

The skill and the CLI ship from the **same git repository**. The CLI is additionally published to npm. `skills add` symlinks the package's `skills/auditor/` directory into each detected host's skills location. No separate package per host.

The `<source>` placeholder above is the skills.sh CLI's required argument. It is a **git ref** — the skills CLI accepts GitHub shorthand (`owner/repo`), a full git URL, or a local path; it does *not* accept npm package names. After §18 resolves the repo name, `<source>` becomes the published GitHub shorthand (e.g., `estern1011/a11y-auditor-v2`). The npm package name (`@org/a11y-auditor`) is a separate distribution surface for the CLI binary (`npm install -g`), not for skill installation.

### Host-agnosticism commitment

The SKILL.md depends on only the lowest-common-denominator agent tools: **Bash, Read, Edit, Write, Grep, Glob.** No Claude-Code-specific idioms (no `Agent`, `AskUserQuestion`, `Skill`, `ExitPlanMode`). Subagents from the v1 prototype (`baseline-collector`, `keyboard-walker`, `visual-cross-referencer`) become CLI subcommands the skill invokes via shell.

v2 launch testing covers Claude Code, Cursor, Continue. Spec-compliance on the other ~47 skills.sh hosts but not eval-verified.

---

## 3. Data model

### Decision record (per (run × page-or-element × criterion))

Canonical source: a Zod schema in `src/schema/decisionLog.ts`. JSON Schema emitted at build time to `dist/schemas/decision-log.schema.json` for external consumers.

```ts
const DecisionRecord = z.object({
  recordId:           z.string().uuid(),
  runId:              z.string(),
  scope:              z.enum(['site', 'flow', 'page', 'element']),  // v2 emits page/element only
  pageUrl:            z.string().url().optional(),     // required for page/element scopes
  elementSelector:    z.string().optional(),           // required for element scope
  criterion:          z.string().regex(/^[1-4]\.[0-9]+\.[0-9]+$/),
  criterionLevel:     z.enum(['A', 'AA']),
  verdict:            z.enum([
                        'supports', 'partially-supports', 'does-not-support',
                        'not-applicable', 'not-evaluated',
                      ]),
  confidence:         z.enum(['high', 'medium', 'low', 'needs-human-review']),
  reasoningDrafts:    z.array(z.string().max(40)).max(5),    // Chain-of-Draft
  reasoning:          z.string().min(1).max(200),             // 1-sentence synthesis
  uncertaintyNotes:   z.string().min(1).max(500).optional(),  // required when confidence ∈ {low, needs-human-review}
  applicableButUntested: z.boolean().optional(),
  evidence:           z.array(Evidence),                       // see refinement below
  supersedesRecordId: z.string().uuid().nullable(),
  agent: z.object({
    name:    z.string(),
    version: z.string(),
    model:   z.string(),    // resolved full model id (e.g., "claude-sonnet-4-6-20251015")
  }),
  ts: z.string().datetime(),
}).superRefine((rec, ctx) => {
  // Evidence required for verdicts that make a claim; not required for applicability records.
  const requiresEvidence = !['not-applicable', 'not-evaluated'].includes(rec.verdict);
  if (requiresEvidence && rec.evidence.length < 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['evidence'],
      message: `verdict '${rec.verdict}' requires at least one evidence pointer`,
    });
  }
  // uncertaintyNotes required when the agent flags uncertainty.
  const requiresUncertaintyNotes = ['low', 'needs-human-review'].includes(rec.confidence);
  if (requiresUncertaintyNotes && !rec.uncertaintyNotes) {
    ctx.addIssue({
      code: 'custom',
      path: ['uncertaintyNotes'],
      message: `confidence '${rec.confidence}' requires uncertaintyNotes`,
    });
  }
  // page/element scopes must identify their target so verdicts can be replayed and attributed.
  if ((rec.scope === 'page' || rec.scope === 'element') && !rec.pageUrl) {
    ctx.addIssue({
      code: 'custom',
      path: ['pageUrl'],
      message: `scope '${rec.scope}' requires pageUrl`,
    });
  }
  if (rec.scope === 'element' && !rec.elementSelector) {
    ctx.addIssue({
      code: 'custom',
      path: ['elementSelector'],
      message: `scope 'element' requires elementSelector`,
    });
  }
});
```

### Evidence (tagged union)

```ts
const Evidence = z.discriminatedUnion('type', [
  AxeFinding,      // { type: 'axe', ruleId, selector, impact, helpUrl?, measured? }
  Screenshot,      // { type: 'screenshot', path, annotated?, selector? }
  SrTranscript,    // { type: 'sr-transcript', path, lines: '12-19', reader: 'voiceover' | 'orca' }
  FocusStop,       // { type: 'focus-stop', stopId, selector? }
  DomQuery,        // { type: 'dom-query', selector, properties: {...} }
  HumanNote,       // { type: 'human-note', note }
]);
```

Adding a new evidence kind = one new schema branch. No breaking changes.

### Run header (one per run)

```ts
const RunHeader = z.object({
  runId:               z.string(),
  startedAt:           z.string().datetime(),
  endedAt:             z.string().datetime().nullable(),
  scope: z.object({
    pages:             z.array(z.string().url()),
    wcagLevel:         z.enum(['A', 'AA']),
    criteria:          z.array(z.string()),       // resolved criterion ids
    criteriaSelector:  z.string(),                // original --criteria arg, for replay
  }),
  orchestratorVersion: z.string(),
  auth:                z.object({ type: z.enum(['storage-state','login-script','none']), file: z.string().optional() }),
  labels:              z.record(z.string()).optional(),
}).superRefine((rh, ctx) => {
  // Both file-backed auth modes need a file path to replay the run; 'none' must not carry a stale path.
  const requiresFile = rh.auth.type === 'storage-state' || rh.auth.type === 'login-script';
  if (requiresFile && !rh.auth.file) {
    ctx.addIssue({ code: 'custom', path: ['auth', 'file'],
      message: `auth type '${rh.auth.type}' requires file` });
  }
  if (rh.auth.type === 'none' && rh.auth.file) {
    ctx.addIssue({ code: 'custom', path: ['auth', 'file'],
      message: `auth type 'none' must not have file` });
  }
});
```

### Append-only discipline

- Records are appended to JSONL, never updated or deleted in-place.
- Corrections are new records with `supersedesRecordId` pointing at the prior record. Original stays.
- The eventual SQLite ingest (v2.1) uses the same append-only invariant; a `CHECK` constraint or trigger rejects `UPDATE`/`DELETE`.
- Same pattern Datomic and event-sourced systems use.

### Run directory layout

```
runs/
  2026-MM-DDTHH-MM-SSZ--<slug>/
    run.json                       # the run header
    decisions.jsonl                # the decision log
    evidence/
      screenshots/                 # numeric prefix + slug, e.g. 001-button-focus.png
      sr-transcripts/              # per-driver
      dom-snapshots/               # rendered HTML at moment of audit
    manifest.json                  # sha256 + size of every evidence file
```

- Evidence paths in records are **relative to the run directory**.
- Manifest is the integrity check; verify-script catches dangling refs, missing files, modified bytes.
- `./runs/` is `.gitignore`d. `decisions.jsonl` may be committed selectively as regression baselines.

### Archival

`a11y-auditor archive <runDir>` → single `.tar.zst` blob (~5–10× smaller than raw). This is the artifact uploaded to S3 / posted to a PR / attached to a ticket / sent to a customer.

`a11y-auditor view <run> --evidence-id <id>` decodes one file from the archive to a temp path without unpacking the whole thing.

### Selective retention

Orchestrator config: `keep-screenshots-for ∈ {all, fails-only, none}`. For nightly regression jobs, `fails-only` cuts artifact size by 20–50×.

### Future data tiers

| Tier | Where | When | Why |
|---|---|---|---|
| **JSONL** (v2) | Inside the skill's output dir | now | zero deps, agent-writable, git-friendly source of truth |
| **SQLite** (v2.1) | Orchestrator's local data dir | v2.1 | rollups, trend queries, regression diffs |
| **Turso / libSQL** (v3) | Hosted | v3 | multi-tenant writes, replication |

JSONL is the immutable event log. SQLite/Turso are materialized views — if either corrupts, re-ingest from JSONL.

---

## 4. Skill design

### Layout

```
skills/auditor/
├── SKILL.md                       # methodology, host-agnostic
├── data/
│   ├── criteria.json              # WCAG 2.2 metadata
│   ├── categories.json            # hybrid taxonomy (see §6)
│   └── confidence-rubric.md       # the levels rubric
└── scripts/                        # (optional thin shims if needed)
```

### Invocation contract

```
<target> --criteria <selector> --level <A|AA> [--auth <config>]
```

| Param | Values |
|---|---|
| `target` | URL (`page` scope) or URL + CSS selector (`element` scope) |
| `--criteria` | category name (`contrast`, `keyboard`, `forms`, …) OR comma list of criterion IDs (`1.4.3,2.4.7`) OR `applicable` (agent enumerates) |
| `--level` | `A` / `AA` (AAA deferred — see §15) |
| `--auth` | path to storage-state JSON, path to login script TS, or omitted |

`all` is **not** accepted at the skill level — that intent belongs to the orchestrator, which composes N targeted audits.

### Skill methodology (high-level)

For each criterion in scope:

1. **Determine applicability.** Is this criterion meaningfully evaluable on this target?
2. **Gather evidence.** Run the appropriate CLI subcommand (`collect-baseline`, `walk-keyboard`, `cross-ref-visual`, or direct DOM/CDP queries). Capture screenshots, SR transcripts, DOM snapshots, axe findings as artifacts; reference them in the record.
3. **Reason in drafts.** Produce ≤5 chain-of-draft steps (≤5 words each) leading to the verdict.
4. **Synthesize.** Write the 1-sentence reasoning, pick verdict + confidence.
5. **Append.** Call `a11y-auditor log append <record>` (validates against schema, fails fast on missing evidence).
6. **Move on.** Don't backtrack within a record; later corrections use `supersedesRecordId`.

---

## 5. CLI design

### Subcommands (v2)

| Command | Purpose |
|---|---|
| `audit <target>` | Run a scoped audit. Spawns Agent SDK with skill loaded. |
| `capture-auth <login-url>` | Open browser, user logs in, save storage state. |
| `collect-baseline <url>` | Headless axe + a11y tree + screenshots (called by skill). |
| `walk-keyboard <url>` | Tab through page, capture focus order + SR transcript (called by skill). |
| `cross-ref-visual <url>` | Compare rendered visuals to a11y tree (called by skill). |
| `log append <record>` | Validate + append decision record. Used by skill. |
| `eval <fixture-dir>` | Run eval suite against a fixture set, output calibration report. |
| `archive <runDir>` | Compress run to `.tar.zst`. |
| `view <runArchive> --evidence-path <relative-path>` | Decode one evidence file from archive. The path is the same relative string that appears in the decision record (e.g., `evidence/screenshots/001-button-focus.png`) and as a manifest key — stable, unique within a run, no separate id field needed. |

### Model selection

- Default: Sonnet (whatever's current at launch).
- Override: `--model <id>` accepting short aliases (`opus`/`sonnet`/`haiku`) resolved to current latest in family.
- Resolved full ID logged into every decision record's `agent.model` for reproducibility.
- v2: one model for all criteria. Tier-routing deferred to v2.1+ pending calibration data.

### Interactive (skill) mode

Uses whatever model the host has selected. The skill can't pick. Document clearly.

---

## 6. Categories & taxonomy

User-facing category names (axe-style), mapped to criterion sets in our own config:

```ts
// src/data/categories.ts (sketch)
export const CATEGORIES = {
  contrast:        ['1.4.3', '1.4.11'],
  keyboard:        ['2.1.1', '2.1.2', '2.1.4', '2.4.3', '2.4.7'],
  forms:           ['1.3.1', '2.4.6', '3.3.1', '3.3.2', '3.3.3', '3.3.4', '3.3.7', '3.3.8', '4.1.2'],
  images:          ['1.1.1', '1.4.5'],
  structure:       ['1.3.1', '1.3.2', '2.4.1', '2.4.2', '2.4.6'],
  language:        ['3.1.1', '3.1.2'],
  media:           ['1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.4.2'],
  motion:          ['2.2.2', '2.3.1'],
  pointer:         ['2.5.1', '2.5.2', '2.5.3', '2.5.4', '2.5.7', '2.5.8'],
  focus:           ['2.4.7', '2.4.11'],
  // ...
};
```

WCAG Principles (POUR) and Guidelines (1.1, 1.2, ...) are derivable from any criterion ID — preserved, just not the primary filter.

`criteria.json` ships the full WCAG 2.2 metadata (title, level, principle, guideline, description) so the agent has reference material without lookup.

---

## 7. Confidence & reasoning

### The four levels (verdict-agnostic rubric)

| Level | Means |
|---|---|
| **high** | Direct, reproducible evidence — a measurement, a binary observation, a DOM property. Verdict follows deterministically from what I saw. Available for any criterion the agent can directly observe, regardless of suite. |
| **medium** | Inferred from context. Behavior strongly suggests the verdict; interpretation is involved. |
| **low** | Pattern-matched from similar cases. Real ambiguity I can name. |
| **needs-human-review** | Applies but the *thing being measured* isn't programmatically accessible — flashing rates, language clarity, content semantics requiring human comprehension. |

`uncertaintyNotes` is **required** when confidence is `low` or `needs-human-review`. That's where "because [specific reason]" lives.

### Chain-of-Draft (CoD)

Each record carries ≤5 reasoning drafts, ≤5 words each, leading to a 1-sentence final synthesis. Adopted from Zoom's 2025 Chain-of-Draft work — ~80% fewer reasoning tokens than full CoT with comparable accuracy.

Example for 1.4.3 Contrast (Minimum) on a button:
```
reasoningDrafts: ["measure bg color", "#4a90e2 vs white", "ratio 3.1:1", "needs 4.5:1", "fails"]
reasoning:       "Button background #4a90e2 on white yields 3.1:1, below the 4.5:1 threshold."
verdict:         "does-not-support"
confidence:      "high"
```

Token budget: ~110 tokens/record. At 50 criteria/page on Sonnet: ~$0.08/page in reasoning overhead. Negligible.

---

## 8. Tiers of criteria

| Tier | What | How we eval | Examples |
|---|---|---|---|
| **A — Verifiable** | Criteria with formal rules or measurable thresholds | Verdict accuracy vs fixture ground truth (ACT + hand-authored) | 1.4.3 contrast ratio, 1.4.11 non-text contrast, 2.5.8 target size, 1.1.1 alt presence |
| **B — Reasoned** | Criteria where context/judgment dominates *and* are evaluable on a single page or element | **Confidence calibration** — human spot-checks a sample, score agreement at each confidence band | 3.3.4 error prevention, 4.1.3 status messages, 2.4.6 link descriptiveness in context |
| **C — Flagged for human** | Two cases: (a) criteria the agent can't programmatically verify; (b) criteria that need scope v2 doesn't emit (flow/site) | **Applicability eval** — did the agent flag `needs-human-review` when criterion applies? | (a) 2.3.1 three flashes, some 2.5.1 pointer gestures, 1.4.2 audio control on user-uploaded media; (b) **scope-deferred in v2** — 2.4.5 multiple ways, 3.2.3 consistent navigation, 3.2.4 consistent identification, 3.2.6 consistent help, 3.3.7 redundant entry |

### ACT coverage gap

ACT-rules covers 31 of ~55 WCAG 2.2 A/AA criteria. The remaining 24 have no published rules:
- WCAG 2.2-new criteria (2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8) — too recent
- Behavioral / contextual criteria (3.3.4, 4.1.3, 3.2.2, 3.2.3, 3.2.4) — not amenable to static rules

This is **not a coverage gap** in our product — it's the value-add of an LLM agent over a static rule engine. Tier B + Tier C explicitly carve out that space.

### 6 hand-authored Tier A fixtures (priority list)

Highest-value gaps where measurable thresholds exist but ACT hasn't published a rule, and each can be exercised on a single page or element (the only scopes v2 emits):

| Criterion | Pattern |
|---|---|
| 1.4.11 Non-text Contrast (AA) | Pass: 3:1 button border. Fail: 2.1:1 icon. |
| 2.4.11 Focus Not Obscured (AA, 2.2-new) | Pass: focus visible above sticky header. Fail: header overlays focus. |
| 2.5.7 Dragging Movements (AA, 2.2-new) | Pass: drag has button alternative. Fail: drag-only reorder. |
| 2.5.8 Target Size (AA, 2.2-new) | Pass: 24×24 px. Fail: 16×16 px touching another target. |
| 3.3.8 Accessible Authentication (AA, 2.2-new) | Pass: paste-allowed password. Fail: blocked paste, no alternative. |
| 4.1.3 Status Messages (A) | Pass: live region announces submit. Fail: silent success. |

**Not in this list — 3.2.6 Consistent Help and 3.3.7 Redundant Entry (both A, 2.2-new).** Both require comparison across multiple pages or process steps, and v2 defers flow/site scope. Move to v2.1 as flow-scoped fixtures when the orchestrator lands; until then the skill should flag both as `needs-human-review` when invoked on a single page.

Each fixture: a single HTML file, no JS framework, filename encodes criterion + verdict (`1.4.11/pass-button-border.html`), companion `fixtures.json` lists expected `(verdict, criterion)` pairs.

---

## 9. Eval strategy

### Three cadences

| Cadence | Set | Volume | Wall time | When |
|---|---|---|---|---|
| **Smoke** | `smoke-test-cases.json` | ~12 cases | <5 min on 1 sprite | Every PR |
| **Sample** | `sample-test-cases.json` | ~140 cases | ~30 min, 3 sprites | On merge to main |
| **Full** | `act-test-cases.json` + Tier A authored | ~1,026 cases | ~1 hr, 10+ sprites | Nightly |

Existing eval queue scaffold (`eval/queue-init.ts` / `queue-collect.ts` / `queue-score.ts`) carries over with one adapter: ACT cases → decision-log expectations.

### Sprite fan-out

- `sprite-bootstrap.sh` from v1 carries over.
- Each sprite claims work from filesystem queue, writes results back, manifest hashes verify integrity.
- Cost projection: ~$0.25 / nightly full eval (sprites pricing × LLM costs).

### Codespaces canary

One CI job per PR that runs the smoke set inside a vanilla Codespaces-equivalent container. Proves the Node-compat ship target works without Bun.

### Scorer

`a11y-auditor eval <fixture-dir>`:
1. Reads each fixture's expected `(verdict, criterion)` pairs.
2. Reads the audit's `decisions.jsonl`.
3. Diffs, grouped by criterion and confidence band.
4. Emits calibration report: precision/recall × confidence × tier.

---

## 10. Tech stack

| Concern | Choice |
|---|---|
| Language | TypeScript |
| Dev runtime | Bun (fast install, native TS, `bun:test`) |
| Ship runtime | Node ≥ 20 (universal compat) |
| Build | `bun build --target node` → `dist/` (Node-compatible) |
| Schema | Zod (canonical) + emitted JSON Schema |
| Browser automation | Playwright / CDP |
| a11y engine | axe-core (injected) |
| SR drivers | VoiceOver (macOS, AppleScript) + Orca (Linux, AT-SPI over D-Bus) |
| Decision-log storage v2 | JSONL on disk |
| Decision-log storage v2.1 | + SQLite (`better-sqlite3`) ingest |
| Decision-log storage v3 | + Turso (libSQL) for hosted |
| Eval orchestration | Sprite (`sprites.dev`) fan-out + Codespaces canary |
| Distribution | npm (`@org/a11y-auditor`) + skills.sh (`npx skills add <source>`) |
| Trace observability | Raindrop Workshop (dev-time only) |

### Bun → Node compat boundary

Anything under `skills/auditor/` and anything shipped via npm must run on plain Node ≥ 20. Bun-specific APIs (`Bun.spawn`, `Bun.sleep`, `Bun.file`, `Bun.write`, `bun:test`) are allowed only in `eval/` and orchestrator code that runs on our infrastructure.

Repo scan (v1):
- 4 product files use Bun APIs (`cli.ts`, `collect.ts`) — must be migrated.
- 2 test files use `bun:test` — dev only, can stay Bun.
- 3 eval files use Bun APIs — eval-side, can stay Bun.

All replacements are shallow: `Bun.spawn` → `child_process.spawn`, `Bun.sleep` → `setTimeout` promise, `Bun.file/write` → `fs/promises`. ~½ day total migration.

---

## 11. Dev infrastructure

### Repo

New repo (working name `a11y-auditor-v2`, final name TBD). Single TS package to start; split into workspaces only when there's a second shipped artifact.

### Layout (target)

```
a11y-auditor-v2/
├── docs/
│   ├── PLAN.md                    # this doc, polished
│   ├── architecture.md
│   ├── confidence-rubric.md
│   └── categories.md
├── schemas/                        # generated from src/schema/*.ts
├── skills/
│   └── auditor/                    # PUBLISHED PATH — skills add reads from here
│       ├── SKILL.md                # methodology, host-agnostic
│       └── data/                   # criteria.json, categories.json, confidence-rubric.md
├── src/
│   ├── schema/                    # Zod canonical
│   ├── cli/                        # entry point + subcommands
│   ├── lib/                        # decision-log, manifest, archive
│   └── drivers/                    # voiceover + orca (Node-compat ports)
├── fixtures/
│   ├── act/                        # from eval/act-test-cases.json
│   ├── authored/                   # 6 hand-authored Tier A
│   └── manifest.json
├── eval/
│   ├── smoke/
│   ├── sample/
│   └── scorer/
├── .devcontainer/                  # mirrors sprite-bootstrap
├── .github/workflows/             # smoke eval + Codespaces canary
├── package.json
├── AGENTS.md                       # repo-level brief for agents
└── README.md
```

### `package.json` shape

```json
{
  "name": "@org/a11y-auditor",
  "type": "module",
  "bin": { "a11y-auditor": "dist/cli/index.js" },
  "files": ["dist/", "skills/", "schemas/"],
  "scripts": {
    "build": "bun build src/cli/index.ts --target=node --outdir=dist/cli && bun run schema:emit",
    "schema:emit": "bun run src/schema/emit.ts",
    "test": "bun test",
    "eval:smoke": "bun run eval/smoke/run.ts"
  },
  "engines": { "node": ">=20.0.0" }
}
```

The `files` array is what makes the skill installable: `dist/` is the built CLI, `skills/` is the published skill directory `skills add` symlinks (no build step — SKILL.md and the JSON data ship as-is), `schemas/` is the emitted JSON Schema for external consumers.

### CI

Two jobs per PR:
1. **Smoke eval** (sprite-backed by default; if a sprite isn't available, falls back to a local **Bun-enabled** container — the smoke eval code under `eval/` may use Bun-only APIs, so the runner must provide Bun). ~12 cases, <5 min.
2. **Codespaces canary** — vanilla Node container, runs the built `dist/` output against one fixture. Proves shipped artifact works without Bun.

Nightly job: full ACT + authored fixture run, fan out across sprites.

### Tracking

Linear. Epics per v2 slice (see §15). Issues have explicit acceptance criteria gated on eval-green + smoke-green.

### AGENTS.md (root brief for any agent that joins the repo)

One page: two-tier architecture, decision-log schema location, append-only invariant, where each thing lives, current sprint focus, acceptance gates. So a new agent doesn't re-derive context.

---

## 12. Observability

| Layer | Tool | When |
|---|---|---|
| Persistent product output | JSONL decision log | always — it's the product |
| Dev-time agent traces | Raindrop Workshop (local daemon, SQLite-backed) | during skill prompt iteration |
| CI eval | structured calibration report from `a11y-auditor eval` | every PR |
| Production trace observability | Deferred to v3 — likely Langfuse (self-hosted) or LangSmith (if LangGraph) | v3 |

Workshop is for *humans iterating on the skill*, not part of the runtime stack. Self-healing eval loops (Workshop's headline feature) are interesting but risky for v2 — v2 iterates via human-reviewed PRs informed by traces.

Spike required: ~½ day to verify Workshop instruments Claude Agent SDK runs (not just Claude Code interactive) and that overhead is acceptable.

---

## 13. Authentication

### v2 supports two formats

**Storage state file** (one-time manual login, reusable):

```bash
a11y-auditor capture-auth https://app.example.com/login --output ./.a11y-auth/prod.json
a11y-auditor audit https://app.example.com/checkout --auth ./.a11y-auth/prod.json --criteria forms --level AA
```

Handles any login flow (OAuth, MFA, magic links, SAML) because the user does it themselves once.

**Login script** (for auditing the login flow itself, or fully-automated reaudits):

```bash
a11y-auditor audit https://app.example.com/login --auth ./scripts/login.ts --criteria forms --level AA
```

Where `login.ts` is a Playwright-style async function reading credentials from env vars. Two purposes: pre-condition login when storage state isn't a fit; audit the login experience itself.

### Deferred to v2.1

HTTP basic auth (`--auth-header`), bearer tokens (`--auth-header "Authorization: Bearer ..."`), OAuth/SSO automation (use storage state instead in v2).

### Security

- `capture-auth` never logs credentials (only post-login storage state).
- Storage state files auto-`.gitignore`d.
- Login scripts run in subprocess with network egress restricted to the audit target's origin.
- Decision log + screenshots + DOM snapshots scrub cookies, Authorization headers, and a configurable redaction list before persisting.

---

## 14. Conscious-copy from v1

| From `estern1011/a11y-auditor` | Why | Adapt how |
|---|---|---|
| `eval/act-test-cases.json` | 1010 ACT cases, free ground truth | Keep as-is initially; later refactor into per-rule files |
| `eval/sample-test-cases.json`, `smoke-test-cases.json` | Curated subsets | Same |
| `eval/sprite-bootstrap.sh` | Sprite onramp, proven | Update repo URL |
| `eval/queue-init.ts` / `queue-collect.ts` / `queue-score.ts` | Queue scaffold | Keep concept; rewrite against new schema |
| `drivers/voiceover/*`, `drivers/orca/*` | Working SR drivers | Bun→Node-compat refactor |
| `skills/auditor/SKILL.md` | v1 methodology | Heavy rewrite for v2's targeted/scoped contract — reference, not source |
| `skills/acr/criteria.json` | WCAG 2.2 metadata | Drop in as `src/data/criteria.json` |

### What we don't copy

- `audit.ts`, `collect.ts`, `cli.ts` at repo root — replaced by `src/cli/` subcommands designed around the v2 invocation contract.
- `eval/run-batch.ts` (47%-accuracy heuristic) — replaced by Agent-SDK-driven scorer.
- `panoramaed-audit-2026-04-06.md` — historical artifact.
- Existing `.claude/agents/` and `.claude/skills/` — host-specific, replaced by host-agnostic SKILL.md.

---

## 15. Roadmap

### v2 in scope (12 slices, ~4 weeks)

| # | Slice | Acceptance gate |
|---|---|---|
| 0 | Repo bootstrap (devcontainer, CI, package.json, license, AGENTS.md) | `npm install` clean, smoke CI green on empty stub |
| 1 | Zod schemas + JSON Schema emit + decision-log append helper | Schema unit tests pass; `log append` rejects invalid records |
| 2 | Data: `criteria.json`, `categories.json`, `confidence-rubric.md` | Loader tests; lint script validates references |
| 3 | Skill rewrite for targeted invocation (page + element) | SKILL.md renders; loads in Claude Code; no Claude-Code idioms detected by lint |
| 4 | Subagent → CLI subcommand refactor (`collect-baseline`, `walk-keyboard`, `cross-ref-visual`) | Each subcommand standalone; existing v1 fixtures pass against them |
| 5 | CLI: `audit`, `capture-auth`, `log`, `archive`, `view`, Agent SDK loop | End-to-end run against one fixture produces valid decision log |
| 6 | Driver port to Node-compat (voiceover + orca) | Drivers run under `dist/` (no Bun); SR transcript captured for one fixture |
| 7 | Eval scorer + calibration report | ACT smoke set runs, calibration report rendered |
| 8 | 6 hand-authored Tier A fixtures + expected verdicts | All 6 fixtures pass smoke; Tier A coverage = 37 criteria |
| 9 | Sprite fan-out + Codespaces canary CI | Sprite eval green; canary green |
| 10 | Publish skill to skills.sh + verify install on Claude Code / Cursor / Continue | `npx skills add <source>` (with the pinned source string from §18 resolution) installs cleanly on all three; smoke audit runs on each |
| 11 | Docs (PLAN.md, architecture, rubric, AGENTS.md, README) | All four docs land, link-check passes |

### Explicitly NOT in v2 (the "won't" list)

| Deferred | When |
|---|---|
| Flow-scoped + site-scoped records emitted by agent | v2.1 (orchestrator concern) |
| Cross-page criteria (2.4.5, 3.2.3, 3.2.4, 3.2.6, 3.3.7) evaluated automatically — skill flags as `needs-human-review` in v2 (see Tier C deferral list in §8) | v2.1 |
| SQLite ingest of decision logs | v2.1 |
| LangGraph orchestrator | v3 |
| Turso / hosted backend | v3 |
| Public web UI / dashboard | v3 |
| ACR / VPAT report generator (existing `skills/acr` deferred) | v2.1 |
| Cross-browser (Firefox, Safari) | v2.1 if customer asks |
| WCAG AAA conformance (`--level AAA`) | v2.1+ — requires sourcing AAA metadata (28 criteria) and AAA fixtures; existing `criteria.json` is A/AA only |
| Mobile / responsive audits | future |
| Cognitive WCAG / WCAG 3 draft | future |
| Localization of agent prompts / categories | future |
| Auto-iteration of skill via Workshop self-healing | v2.1+ once skill is stable |
| Per-criterion model routing (Tier-aware) | v2.1+ once calibration data exists |

### v2.1 candidates (post-v2 backlog, not committed)

- Flow / site scope record emission + cross-page criteria eval
- SQLite ingest + diff queries + regression alerts
- ACR / VPAT renderer reading from decision log
- HTTP auth header support (`--auth-header`)
- Cross-host eval matrix (formal verification on more skills.sh hosts)

### v3 candidates (further out)

- LangGraph orchestrator with checkpointing, parallel fan-out, retries
- Turso for multi-tenant hosted decision logs
- Hosted web dashboard
- Hosted trace observability (LangSmith or Langfuse)

---

## 16. Time estimate

| Block | Days |
|---|---|
| Repo bootstrap + CI + devcontainer | 1 |
| Schemas + Zod + append helper + manifest | 1.5 |
| Confidence rubric + categories + criteria metadata | 0.5 |
| Skill rewrite — host-agnostic, page + element targeted | 3 |
| Subagent → CLI subcommand refactor | 1.5 |
| CLI + Agent SDK loop + `--auth` plumbing | 2 |
| `capture-auth` flow + credential redaction | 0.5 |
| Driver port to Node-compat (voiceover + orca) | 1 |
| Eval scorer + calibration report | 2 |
| 6 hand-authored fixtures + expected verdicts | 1.0 |
| Sprite fan-out + Codespaces canary | 1 |
| Cross-host compatibility verification (Cursor + Continue) | 1 |
| Publish skill to skills.sh + verify install | 0.5 |
| Docs (PLAN, architecture, rubric, AGENTS) | 1 |
| Buffer / iteration | 2 |
| **Total** | **~20 working days (~4 weeks)** |

---

## 17. Success bar

v2 ships when all five hold:

1. **Tier A accuracy ≥ 95%** on verdicts marked `high` confidence, measured against ACT fixtures + 6 hand-authored fixtures (~37 criteria with ground truth).
2. **Tier B calibration**: human-reviewed sample of 100 records shows `high` ≥ 90% agreement with reviewer, monotonic decrease at `medium`/`low`.
3. **Tier C correct flagging**: ≥ 90% of fixtures where criterion is applicable-but-unverifiable get marked `needs-human-review`.
4. **Smoke eval green in CI** on every PR for the two weeks leading up to launch.
5. **Codespaces canary green** on every PR (Node-compat ship target works).

---

## 18. Risks & open questions

| Risk | Mitigation |
|---|---|
| Orca on sprites untested (xvfb + dbus + at-spi) | ~½ day spike before relying on it — slice 0 |
| Skill drift across hosts (Cursor / Continue have subtler tool semantics than Claude Code) | Compatibility verification slice with manual smoke run on each |
| Confidence calibration data takes longer than 1 sprint | Human spot-checks can run async; eval scorer ships before calibration data is complete |
| 4-week estimate slips | Buffer is 2 days; if it slips >1 week, cut the 6 hand-authored fixtures from v2 and rely on ACT-only Tier A coverage |
| Workshop instrumentation overhead | Spike before committing |
| `bun build --target node` produces broken output for some import | Codespaces canary catches it on every PR |

### Open questions for first review

- **Repo name.** Working name `a11y-auditor-v2`. Real name TBD.
- **License.** Default MIT for tooling; Apache-2.0 if we expect contributors who care about patent grants. Decide before repo init.
- **npm scope.** `@org/a11y-auditor` or unscoped `a11y-auditor`? Affects squatting risk.
- **Skill name on skills.sh.** Today's name is `auditor`. Keep, or pick something more specific (e.g., `a11y-auditor`, `wcag-auditor`)?
- **What's the persistent v2 deliverable to the user beyond the JSONL?** Today the answer is "a rendered markdown report alongside the JSONL." Should this be promoted to a v2 must-ship vs deferred to v2.1?

---

## 19. Bootstrap manifest (first day in new repo)

Order of operations once the new repo exists:

1. `git init`, `package.json`, `tsconfig.json`, `eslint`, `prettier`, `.gitignore`.
2. `.devcontainer/devcontainer.json` mirroring the sprite-bootstrap apt list + Bun + Node.
3. `.github/workflows/ci.yml`: smoke eval job + Codespaces canary job.
4. `AGENTS.md` at root: 1-page brief.
5. `docs/PLAN.md` (this doc, polished).
6. `src/schema/decisionLog.ts` + emit script + JSON Schema artifact.
7. `src/data/criteria.json` (copy from v1).
8. `src/data/categories.json` (write fresh).
9. `docs/confidence-rubric.md`.
10. Stub `src/cli/index.ts` that prints `--help`.
11. Empty `runs/` with gitignore.
12. Conscious-copy: `fixtures/act/` from v1.

After day 1, slice work proceeds in numbered order per §15.

---

*End of plan. Next step: `/grill-me` stress test on this whole document before any code is written.*
