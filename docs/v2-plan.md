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

### Three tiers with two contracts

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
│        TIER 0 — DETERMINISTIC COLLECTORS & DRIVERS             │
│                  (plain Node, NO LLM, no API key)              │
│                                                                │
│  sr session (start/command/transcript/stop), collect-baseline, │
│  run-states (states.yml driver). "Playwright for a11y."        │
│  Consumes the same states.yml a Playwright spec would.         │
│  Output (CONTRACT 1 — deterministic artifacts):                │
│    focus-order.json, headings.json, landmarks.json,            │
│    forms.json, sr-run.json, sr-transcripts/*.txt, axe.json,    │
│    screenshots/, dom-snapshots/                                 │
└──────────────────────────────┬─────────────────────────────────┘
                               │ any host/skill/Playwright spec
                               │ can stop here — no LLM required
                               ▼
┌────────────────────────────────────────────────────────────────┐
│             TIER 1 — LLM AUDITOR (SKILL, Agent SDK)            │
│                                                                │
│  Reasons over Tier 0 artifacts for one page or element.        │
│  Inputs:   target, criteria, level, states.yml                 │
│  Reasoning: chain-of-draft per criterion                       │
│  Output (CONTRACT 2 — append-only JSONL of DecisionRecord)     │
│    + run.json + manifest.json, referencing Tier 0 artifacts    │
└──────────────────────────────┬─────────────────────────────────┘
                               │ decision-log JSONL is the wire
                               ▼
┌────────────────────────────────────────────────────────────────┐
│                  TIER 2 — ORCHESTRATOR (v2.1+)                 │
│                                                                │
│  Composes page audits into flow/site audits, emits             │
│  flow/site-scoped records, aggregates cross-page findings,     │
│  generates VPAT / ACR. Initially a thin TS script; v3 swaps    │
│  for LangGraph when fan-out semantics warrant.                 │
└────────────────────────────────────────────────────────────────┘
```

**Two contracts, not one.** Tier 0 emits *deterministic artifacts* (focus-order.json, headings.json, sr-transcripts, etc.) that any consumer can read without invoking an LLM — a Cursor state-sweep skill, a Playwright spec, or CI. Tier 1 (the LLM auditor) reasons over those artifacts and emits the *decision-log JSONL*. This separation is deliberate: the deterministic layer is co-equal with the decision log, not subordinate to it. A non-LLM consumer uses Tier 0 directly; the auditor is a layer on top.

**Tier 0 is "Playwright for accessibility."** It is a scriptable, session-driven, JSON-emitting driver in the same category as Playwright / agent-browser / chrome-devtools-mcp — but it drives the screen reader + AT-SPI/accessibility tree (the layer browser tools skip) and is deterministic-by-design (scripted, not agent-driven). It consumes the same `states.yml` recipe a Playwright spec uses, so one manifest drives the browser *and* the a11y/SR collectors.

### Distribution

| Channel | Surface | Audience |
|---|---|---|
| `npx skills add <source>` (skills.sh) | SKILL.md + bundled scripts/data | Devs in any code agent host |
| `npm install -g @org/a11y-auditor` | CLI binary | Devs running CLI/CI |
| `npx a11y-auditor` | Same CLI without install | Ad-hoc usage |

The skill and the CLI ship from the **same git repository**. The CLI is additionally published to npm. `skills add` symlinks the package's `skills/auditor/` directory into each detected host's skills location. No separate package per host.

The `<source>` placeholder above is the skills.sh CLI's required argument. It is a **git ref** — the skills CLI accepts GitHub shorthand (`owner/repo`), a full git URL, or a local path; it does *not* accept npm package names. After §18 resolves the repo name, `<source>` becomes the published GitHub shorthand (e.g., `estern1011/a11y-auditor-v2`). The npm package name (`@org/a11y-auditor`) is a separate distribution surface for the CLI binary (`npm install -g`), not for skill installation.

### Host-agnosticism: a build constraint, not a test target

Two distinct properties, deliberately kept separate:

- **Spec-compliance — "any agent can use it" — is a *build constraint*.** The SKILL.md depends only on the lowest-common-denominator agent surface: **Bash + Read + Edit + Write + Grep + Glob**, plus the deterministic Tier 0 CLI (no Agent SDK, no API key). No Claude-Code-specific idioms (`Agent`, `AskUserQuestion`, `Skill`, `ExitPlanMode`), no Cursor-specific features. Any host that can run a shell command can drive it. This holds *by construction*, for hosts that don't exist yet — it's not something we test, it's something we forbid ourselves from breaking.
- **Verification — "we confirmed these hosts" — is a *budget*.** We pay time to smoke-test specific hosts. v2 verifies **Cursor + Claude Code** (Cursor is the integration target; Continue deferred to v2.1).

Why the separation matters: if the only commitment were "verified on Cursor + CC," it would be tempting to reach for a host-specific shortcut to make something easier — and a third agent would silently break, undetected because we only test two. Treating host-agnosticism as a *constraint* forbids those shortcuts up front. The same property that makes it portable to any agent is exactly what lets your existing tooling (a Playwright spec, a state-sweep skill, CI) drive the Tier 0 CLI with no Anthropic dependency. "Flexible for any agent" and "usable from your existing tooling" are the same requirement.

Subagents from the v1 prototype (`baseline-collector`, `keyboard-walker`, `visual-cross-referencer`) become Tier 0 CLI subcommands the skill invokes via shell — which is what makes them reusable outside any single host.

---

## 3. Data model

### Decision record (per (run × page-or-element × state × criterion))

When a `states.yml` recipe drives the run, a "page" verdict is really "page in state X" — so `state` is a first-class field on the record, not something aggregation has to infer from filenames. Aggregation keys on `(pageUrl, state.name, criterion)`; `state` is absent for plain single-render audits.

Canonical source: a Zod schema in `src/schema/decisionLog.ts`. JSON Schema emitted at build time to `dist/schemas/decision-log.schema.json` for external consumers.

```ts
const DecisionRecord = z.object({
  recordId:           z.string().uuid(),
  runId:              z.string(),
  scope:              z.enum(['site', 'flow', 'page', 'element']),  // v2 emits page/element only
  pageUrl:            z.string().url().optional(),     // required for page/element scopes
  elementSelector:    z.string().optional(),           // required for element scope
  state:              z.object({                       // present when a states.yml recipe drove the run
                        name:        z.string(),         // matches a states.yml state name (filesystem-safe)
                        description: z.string().optional(),
                      }).optional(),
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
  statesFile:          z.string().optional(),    // path to states.yml, if a recipe drove the run (independent of auth)
  auth:                z.object({ type: z.enum(['storage-state','login-script','none']), file: z.string().optional() }),
  labels:              z.record(z.string()).optional(),
}).superRefine((rh, ctx) => {
  // Both file-backed auth modes need a file path to replay the run; 'none' must not carry a stale path.
  // auth is independent of statesFile — states.yml never carries credentials (§13).
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
    run.json                                  # the run header
    decisions.jsonl                           # TIER 1 — the LLM decision log
    collectors/                               # TIER 0 — deterministic artifacts (no LLM)
      states/                                 #   one subdir per states.yml state
        <stateName>/                          #   filesystem-safe name from states.yml
          sr-run.json                         #     SR session metadata + skipped-action errors
          focus-order.json                    #     tab stops, in order, with names/roles
          axe.json                            #     raw axe-core output
          headings.json                       #     heading tree
          landmarks.json                      #     landmark regions
          forms.json                          #     form controls + label associations
          sr-transcripts/
            orca.txt                          #     per-driver transcript
            voiceover.txt
    evidence/
      screenshots/                            #   numeric prefix + slug, e.g. 001-button-focus.png
      dom-snapshots/                          #   rendered HTML at moment of audit
    manifest.json                             # sha256 + size of every file under collectors/ + evidence/
```

- **Per-state layout is locked: `collectors/states/<stateName>/...`** — every state in `states.yml` gets its own subdirectory keyed by its filesystem-safe `name`. When no `--states` is given, a single implicit state named `initial` is used, so the shape is uniform (`collectors/states/initial/...`) and consumers never special-case the no-states path.
- **`collectors/` is the Tier 0 contract** — first-class deterministic artifacts, written by `collect-baseline` / `sr run-states` with no LLM involved. A Cursor skill, Playwright spec, or CI job can consume these directly. `decisions.jsonl` references them by relative path; it does not duplicate their content.
- Artifact paths in records are **relative to the run directory**.
- Manifest is the integrity check; verify-script catches dangling refs, missing files, modified bytes.
- `./runs/` is `.gitignore`d. `decisions.jsonl` and `collectors/*.json` may be committed selectively as regression baselines (both are text, both diff cleanly).

### Archival

`a11y-auditor archive <runDir>` → single `.tar.zst` blob (~5–10× smaller than raw). This is the artifact uploaded to S3 / posted to a PR / attached to a ticket / sent to a customer.

`a11y-auditor view <run> --evidence-path <relative-path>` decodes one file from the archive to a temp path without unpacking the whole thing.

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
| `--auth` | path to storage-state JSON, path to login-script TS, or omitted. Separate from `states.yml`; never carries credentials in the recipe (§13). |
| `--states` | path to `states.yml` (§6.5) — page-state reproduction only, audits each declared state |

`all` is **not** accepted at the skill level — that intent belongs to the orchestrator, which composes N targeted audits.

### Skill methodology (high-level)

For each criterion in scope:

1. **Determine applicability.** Is this criterion meaningfully evaluable on this target?
2. **Gather evidence from Tier 0.** Run the deterministic collectors (`collect-baseline`, `run-states` for multi-state, `sr` session for screen-reader transcripts, `cross-ref-visual`). These write `collectors/*.json` + transcripts + screenshots with no LLM involved; the agent reads those artifacts and references them by relative path in the record. The agent does not re-derive what Tier 0 already measured.
3. **Reason in drafts.** Produce ≤5 chain-of-draft steps (≤5 words each) leading to the verdict.
4. **Synthesize.** Write the 1-sentence reasoning, pick verdict + confidence.
5. **Append.** Call `a11y-auditor log append <record>` (validates against schema, fails fast on missing evidence).
6. **Move on.** Don't backtrack within a record; later corrections use `supersedesRecordId`.

### The line that protects the deep WCAG knowledge

The three-tier split is what *preserves* the original auditor's core value — deep WCAG reasoning — by separating it cleanly from evidence collection. Two rules enforce that:

- **Tier 0 makes no WCAG judgments.** It gathers focus order, headings, landmarks, forms, transcripts, contrast values. It never decides "this fails 1.3.1." All conformance reasoning — applicability, the judgment-heavy Tier B criteria, "does this announcement actually make sense to a screen-reader user," confidence calibration — lives only in this SKILL.md methodology + the criteria reference + chain-of-draft. Extracting tool-driving into Tier 0 *concentrates* the skill on WCAG judgment instead of diluting it with browser-driving instructions.
- **A standalone deterministic report is fine; degraded *conformance verdicts* are not.** `report --mode screen-reader` legitimately runs off Tier 0 alone — "here's what the collectors found" is a useful artifact. The failure mode to guard against is the opposite: letting the *decision log's WCAG verdicts* degrade into mere collector surfacing (focus traps, unlabeled controls) — that's axe-with-extra-steps and throws away the whole point. The deterministic layer handles what's mechanizable precisely so the LLM can spend its judgment on the contextual criteria no rule engine can touch. The report enriches with the decision log when present; the verdicts themselves must stay reasoned. (Tracked as a risk in §18.)

---

## 5. CLI design

### The Agent-SDK boundary

There are two classes of command, and the split is a hard contract:

- **Tier 0 — deterministic, plain Node, NO Agent SDK, no API key.** `sr *`, `collect-baseline`, `run-states`, `report`, `archive`, `view`, `log`, `capture-auth`. Callable from a Cursor skill, a Playwright spec, CI, or any agent host with zero Anthropic dependency.
- **Tier 1 — LLM orchestration, requires Agent SDK + API key.** Only `audit`. It internally calls the Tier 0 commands.

### Subcommands (v2)

| Command | Tier | Purpose |
|---|---|---|
| `audit <target>` | 1 | Run a scoped LLM audit. Spawns Agent SDK with skill loaded; internally drives Tier 0 commands. **Only command needing an API key.** |
| `sr doctor` | 0 | Preflight: verify screen reader + xvfb + dbus + AT-SPI (Linux/Orca) or VoiceOver (macOS) are wired up. Exit non-zero with a diagnosis if not. |
| `sr start [--driver orca\|voiceover]` | 0 | Start an SR session; returns a session handle. |
| `sr command <session> <action>` | 0 | Send one SR action (next, tab, activate, read-item, …). |
| `sr transcript <session>` | 0 | Emit the session transcript so far as JSON + `.txt`. |
| `sr stop <session>` | 0 | Tear down the SR session. |
| `sr run-states <states.yml>` | 0 | Drive a page through a `states.yml` recipe, capturing SR transcript + focus order per state. The session commands above, scripted. |
| `collect-baseline <url>` | 0 | Headless axe + a11y tree → `axe.json`, `headings.json`, `landmarks.json`, `forms.json`, `focus-order.json`, screenshots. |
| `run-states <states.yml>` | 0 | Drive the page through a `states.yml` recipe and run all deterministic collectors (axe + a11y + SR) against each state. The unifying entry point — see §6.5. |
| `cross-ref-visual <url>` | 0 | Compare rendered visuals to a11y tree. |
| `report --mode screen-reader [--format json\|md]` | 0 | SR-concern report (skipped states, transcript summaries, focus traps, unlabeled controls, unexpected announcements, heading/landmark issues). **Reads Tier 0 collectors directly — works with no decision log present** (e.g. before any LLM run); enriches with `decisions.jsonl` if it exists. JSON first, markdown optional. Renders `findings/screen-reader.md`. |
| `log append <record>` | 0 | Validate + append decision record. Used by the skill. |
| `eval <fixture-dir>` | 0 | Run eval suite against a fixture set, output calibration report. |
| `capture-auth <login-url>` | 0 | Open browser, user logs in, save storage state. |
| `archive <runDir>` | 0 | Compress run to `.tar.zst`. |
| `view <runArchive> --evidence-path <relative-path>` | 0 | Decode one file from archive. The path is the same relative string that appears in the decision record (e.g., `collectors/sr-transcripts/...` or `evidence/screenshots/001-button-focus.png`) and as a manifest key — stable, unique within a run, no separate id field. |

`walk-keyboard` from earlier drafts is now a thin convenience wrapper over `sr start → tab-loop → sr transcript → sr stop`; the session surface is the real contract.

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

### 6.5 `states.yml` — the page-state recipe (interop seam)

A single page often has multiple audit-relevant *states* (modal open, filter panel expanded, empty results, post-login). A static URL audit misses them. `states.yml` is a Playwright-shaped manifest that drives the page into each state; the deterministic collectors and the SR session run against each.

**v2 matches the consumer's exact contract** (from the `SCSZ-8151-a11y-state-sweep` branch). Not a near-copy — the same schema, so the consumer's existing axe / responsive / Orca passes share one state model with no translation. The entry point is `a11y-auditor sr run-states --states states.yml ...` (and `run-states` for the full collector sweep).

```yaml
states:
  - name: initial
    description: Default page load, no interactions
  - name: filters-expanded
    description: Filter panel expanded
    actions:
      - click: 'button:has-text("Filters")'
      - waitFor: '[data-testid="filter-panel"]'
  - name: row-modal-open
    description: First row detail modal open
    actions:
      - click: 'tbody tr:first-child a.student-name'
      - waitFor: '[role="dialog"]'
  - name: empty-state
    description: Empty results state
    navigate: '/students?search=zzzzznomatch'
```

**Type shape (v2 schema mirrors this exactly):**

```ts
type StatesManifest = { states: State[] };
type State = {
  name: string;          // required, unique, filesystem-safe
  description?: string;   // optional human context, copied into findings
  navigate?: string;      // optional URL/path override for this state
  actions?: StateAction[];// executed in order after navigation
};
type StateAction =
  | { click: string }
  | { fill: { selector: string; value: string } }
  | { press: { selector: string; key: string } }
  | { selectOption: { selector: string; value: string } }
  | { hover: string }
  | { waitFor: string }
  | { waitForLoadState: 'load' | 'domcontentloaded' | 'networkidle' }
  | { waitForTimeout: number };
```

**Semantics v2 honors (verbatim from the contract):**
- `states` is the top-level YAML key.
- `name` is **required, unique, filesystem-safe**: lowercase ASCII letters, digits, hyphens only; no spaces; no leading/trailing hyphens. (Enforced in the Zod schema.)
- `description` is optional human context, copied into findings.
- `navigate` is optional and overrides the default target URL for that state; absolute URL or app-relative path.
- `actions` run in order after navigation. **No actions = "navigate and audit the base render."**
- `initial` should normally be present and first.
- **A failed action marks that state `skipped` with an action error — it does not fail the whole audit.** (Surfaces as a `skipped` entry in `sr-run.json` + the SR-concern report.)

**`states.yml` is page-state reproduction ONLY — no credentials, no secret interpolation (decided).** It is a committed audit artifact (lives under `docs/investigations/...`, and its actions are copied into generated specs + raw capture JSON). Resolved secret values would leak unless every writer preserved placeholders perfectly, so secrets stay out entirely. Authentication is a *separate* mechanism (§13), never expressed in `states.yml`. If non-secret env interpolation (e.g., a test-data search term) is ever added, it is for **non-secret test data only**, and **resolved values must never be persisted** — the artifact keeps the placeholder, not the resolved string.

**Why this is the high-leverage piece:**
- **One recipe, three checks.** The same `states.yml` feeds `run-states` (axe + a11y + SR collectors), so adding screen-reader coverage to your existing browser/axe state sweep is mechanical — pass the same file.
- **It fixes the static-`page`-scope gap.** A `page`-scoped audit becomes "page in state X" — the right unit for modals, filters, empty states, without needing flow scope.

Each state's collector output is namespaced under `collectors/states/<stateName>/` in the run directory — e.g. `collectors/states/filters-expanded/sr-run.json`, `collectors/states/filters-expanded/focus-order.json`, `collectors/states/filters-expanded/sr-transcripts/orca.txt`. State names are filesystem-safe by contract, so they're directory-safe too. (Full layout in §3.) No `--states` ⇒ a single implicit `initial` state, same shape.

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

One CI job per PR that, in a vanilla Node container (no Bun), runs the built `dist/` CLI against a single fixture end-to-end. The eval-side smoke code is *not* invoked here — it can rely on Bun (see §10) and the canary's purpose is precisely to prove the shipped artifact works without Bun.

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
│   ├── schema/                    # Zod canonical (decision log, run header, states.yml)
│   ├── cli/                        # entry point + subcommands
│   ├── collectors/                 # TIER 0 — axe, focus-order, headings, landmarks, forms
│   ├── states/                     # states.yml parser + Playwright-backed driver
│   ├── sr/                         # sr session surface (start/command/transcript/stop)
│   ├── report/                     # report --mode screen-reader renderer
│   ├── lib/                        # decision-log, manifest, archive
│   └── drivers/                    # voiceover + orca (Node-compat ports)
├── fixtures/
│   ├── act/                        # from eval/act-test-cases.json
│   ├── authored/                   # Tier A hand-authored (v2.1 — see roadmap)
│   ├── sr-smoke/                   # tiny page for the SR-in-Codespaces gate
│   └── manifest.json
├── eval/
│   ├── smoke/
│   ├── sample/
│   └── scorer/
├── .devcontainer/                  # mirrors sprite-bootstrap (incl. Orca + xvfb + dbus)
├── .github/workflows/             # smoke eval + Codespaces canary + SR-in-Codespaces gate
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

Three jobs per PR:
1. **Smoke eval** (sprite-backed by default; if a sprite isn't available, falls back to a local **Bun-enabled** container — the smoke eval code under `eval/` may use Bun-only APIs, so the runner must provide Bun). ~12 cases, <5 min.
2. **Codespaces canary** — vanilla Node container (no Bun), runs the built `dist/` CLI against one fixture end-to-end. Proves the shipped artifact works without Bun.
3. **SR-in-Codespaces gate** — `a11y-auditor sr doctor` plus a tiny fixture page where Orca starts, tabs twice, and writes a transcript. This is the "it's actually easy to integrate" proof: it demonstrates the screen-reader path works in a Codespaces-equivalent container, not just axe/visual. **Contingent on the Orca-headless spike (slice 0) succeeding** — if `xvfb + dbus + at-spi` can't run Orca headless, this gate runs on a dedicated runner instead of in the canary.

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

Auth is a **separate mechanism from `states.yml`** (decided — see §6.5). `states.yml` never carries credentials. v2 supports two auth shapes:

**1. Storage state file** (one-time manual login, reusable):

```bash
a11y-auditor capture-auth https://app.example.com/login --output ./.a11y-auth/prod.json
a11y-auditor audit https://app.example.com/checkout --auth ./.a11y-auth/prod.json --criteria forms --level AA
```

Handles any login flow (OAuth, MFA, magic links, SAML) because the user does it themselves once. A pre-captured session can't be expressed as scripted actions, so this is first-class.

**2. Scripted login** (`--auth login-script.ts`) — a Playwright-style async function that performs login, kept **separate from `states.yml`** specifically so credentials never land in a committed audit artifact:

```bash
a11y-auditor audit https://app.example.com/checkout --auth ./scripts/login.ts --criteria forms --level AA
```

```ts
// login.ts — reads secrets from env at runtime, never persisted
export async function login(page) {
  await page.fill('#email', process.env.TEST_EMAIL);
  await page.fill('#password', process.env.TEST_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-testid=dashboard]');
}
```

The login script runs *before* the `states.yml` recipe (auth, then state reproduction). It pre-conditions the session; it is not part of the reproducible state model. The script file is `.gitignore`d by convention and credentials come from env vars at runtime — nothing resolves into any persisted artifact.

The run header's `auth.type` enum is `'storage-state' | 'login-script' | 'none'`.

### Deferred to v2.1

HTTP basic auth (`--auth-header`), bearer tokens (`--auth-header "Authorization: Bearer ..."`), OAuth/SSO automation (use storage state instead in v2).

### Security

- `capture-auth` never logs credentials (only post-login storage state).
- Storage-state files and login scripts are `.gitignore`d by convention; the CLI warns if it detects either tracked in `git ls-files`.
- **`states.yml` is credential-free by contract** — no secret interpolation. If non-secret env interpolation is ever added, resolved values are never persisted (placeholder stays in the artifact).
- Login scripts read secrets from env vars at runtime and run in a subprocess with network egress restricted to the target's origin.
- Decision log + collectors + screenshots + DOM snapshots scrub cookies, Authorization headers, and a configurable redaction list before persisting.

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

### v2 in scope (13 slices, ~4 weeks)

| # | Slice | Acceptance gate |
|---|---|---|
| 0 | Repo bootstrap (devcontainer w/ Orca+xvfb+dbus, CI, package.json, license, AGENTS.md) **+ Orca-headless spike** | `npm install` clean, smoke CI green on empty stub; `sr doctor` exits 0 in the devcontainer (or spike concludes Orca needs a dedicated runner) |
| 1 | Zod schemas (decision log, run header, `states.yml`) + JSON Schema emit + `log append` helper | Schema unit tests pass; `log append` rejects invalid records |
| 2 | Data: `criteria.json`, `categories.json`, `confidence-rubric.md` | Loader tests; lint script validates references |
| 3 | **Tier 0 collectors** (`collect-baseline` → axe/headings/landmarks/forms/focus-order JSON) | Each artifact emitted + schema-valid against v1 fixtures; no LLM/API key invoked |
| 4 | **`sr` session surface + Node-compat driver port** (voiceover + orca; start/command/transcript/stop) | Session drives a fixture; transcript JSON captured; runs under `dist/` (no Bun); no API key |
| 5 | **`states.yml` parser + `run-states` driver** (Playwright-backed) | A multi-state recipe drives a fixture; per-state collectors land under `collectors/<state>/`; matches consumer schema (§18 #2) |
| 6 | Skill rewrite for targeted invocation (page + element), host-agnostic | SKILL.md renders; loads in Claude Code + Cursor; no Claude-Code idioms by lint |
| 7 | CLI Tier 1: `audit` + Agent SDK loop (drives Tier 0 commands) | End-to-end run against one fixture produces valid decision log referencing collector artifacts |
| 8 | `report --mode screen-reader` renderer + `archive`/`view` | `findings/screen-reader.md` + JSON render from a run; archive round-trips |
| 9 | Eval scorer + calibration report | ACT smoke set runs, calibration report rendered |
| 10 | Sprite fan-out + Codespaces canary + **SR-in-Codespaces gate** | Sprite eval green; canary green; `sr doctor` + tab-twice transcript green in canary (or dedicated runner per slice 0) |
| 11 | Publish skill to skills.sh + verify install on **Cursor + Claude Code** | `npx skills add <source>` installs cleanly on both; smoke audit + `run-states` smoke runs on each |
| 12 | Docs (PLAN.md, architecture, rubric, AGENTS.md, README) | All docs land, link-check passes |

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
| 6 hand-authored Tier A fixtures (1.4.11, 2.4.11, 2.5.7, 2.5.8, 3.3.8, 4.1.3) | v2.1 — **cut to absorb `states.yml` work**; v2 launch relies on ACT-only Tier A coverage (31 criteria) |
| Continue host verification (Cursor + Claude Code only at launch) | v2.1 — Cursor is the integration target |
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
| Repo bootstrap + CI + devcontainer + Orca-headless spike | 1.5 |
| Schemas + Zod (incl. states.yml) + append helper + manifest | 1.5 |
| Confidence rubric + categories + criteria metadata | 0.5 |
| Tier 0 collectors (axe/headings/landmarks/forms/focus-order JSON) | 1.5 |
| `sr` session surface + Node-compat driver port (voiceover + orca) | 1.5 |
| `states.yml` parser + `run-states` driver (Playwright-backed) | 2.5 |
| Skill rewrite — host-agnostic, page + element targeted | 3 |
| CLI Tier 1: `audit` + Agent SDK loop | 1.5 |
| `report --mode screen-reader` + `archive`/`view` + `capture-auth` | 1 |
| Eval scorer + calibration report | 2 |
| Sprite fan-out + Codespaces canary + SR-in-Codespaces gate | 1.5 |
| Cross-host verification (Cursor + Claude Code) | 0.5 |
| Publish skill to skills.sh + verify install | 0.5 |
| Docs (PLAN, architecture, rubric, AGENTS) | 1 |
| Buffer / iteration | 1.5 |
| **Total** | **~21.5 working days (~4.3 weeks)** |

(Up ~1.5 days from the pre-feedback ~20: `states.yml` + `sr` session + Tier 0 split add work; cutting the 6 hand-authored fixtures and Continue verification claws most of it back. The deterministic-layer investment is the integration unlock, so the net is worth it.)

---

## 17. Success bar

v2 ships when all six hold:

1. **Tier A accuracy ≥ 95%** on verdicts marked `high` confidence, measured against the ACT fixture suite (~31 criteria with ground truth; the 6 hand-authored fixtures slip to v2.1).
2. **Tier B calibration**: human-reviewed sample of 100 records shows `high` ≥ 90% agreement with reviewer, monotonic decrease at `medium`/`low`.
3. **Tier C correct flagging**: ≥ 90% of fixtures where criterion is applicable-but-unverifiable get marked `needs-human-review`.
4. **Smoke eval green in CI** on every PR for the two weeks leading up to launch.
5. **Codespaces canary + SR-in-Codespaces gate green** on every PR (Node-compat ship target works; `sr doctor` + tab-twice transcript runs in a Codespaces-equivalent container).
6. **`states.yml` round-trip**: a multi-state recipe drives `run-states` and produces per-state collector artifacts that the consumer's existing state-sweep skill can read without translation.

---

## 18. Risks & open questions

| Risk | Mitigation |
|---|---|
| Orca headless (xvfb + dbus + at-spi) may not run in Codespaces/sprites | Spike is now **slice 0**, before anything depends on it. If it fails, SR gate moves to a dedicated runner and the Codespaces SR proof is descoped — the rest of Tier 0 (axe/a11y collectors) still runs headless. |
| `states.yml` schema mismatch with the consumer's existing state-sweep skill | **Open question §18 #1** — adopt the consumer's *exact* schema, not a near-copy. Blocking input before slice 5. |
| `states.yml` + `sr` + Tier 0 split expands scope | Cut 6 hand-authored fixtures + Continue verification to absorb; net +1.5 days (see §16). |
| **Deterministic layer cannibalizes the WCAG reasoning** (product drifts into "surface what collectors found" = axe-with-extra-steps, losing the LLM's deep-WCAG value) | Hard rule (§4): Tier 0 makes no WCAG judgments; collectors *feed* reasoning, never replace it. Eval guards it — Tier B calibration measures judgment quality, not collector coverage. SKILL.md rewrite (slice 6) must preserve/deepen the v1 methodology, reviewed against the original. |
| Skill drift across hosts (Cursor tool semantics differ from Claude Code) | Cursor + Claude Code verification slice with manual smoke + `run-states` smoke on each |
| Confidence calibration data takes longer than 1 sprint | Human spot-checks run async; eval scorer ships before calibration data is complete |
| Workshop instrumentation overhead | Spike before committing |
| `bun build --target node` produces broken output for some import | Codespaces canary catches it on every PR |

### Open questions for first review

- **RESOLVED — `states.yml` schema + auth boundary.** Exact contract from `SCSZ-8151-a11y-state-sweep` matched verbatim in §6.5 (type shape + semantics, incl. filesystem-safe names and skip-on-action-failure). **Credentials decision: declined** — `states.yml` is page-state reproduction only, no secret interpolation, because it's a committed audit artifact copied into specs + capture JSON and resolved secrets would leak. Scripted login stays a separate `--auth login-script.ts` mechanism (§13); `auth.type` enum is `'storage-state' | 'login-script' | 'none'`. Any future env interpolation is non-secret test data only, resolved values never persisted.
- **RESOLVED — Host targeting at launch.** Cursor + Claude Code verified; any-agent flexibility is a build constraint (§2); Continue deferred to v2.1.
- **Repo name.** Working name `a11y-auditor-v2`. Real name TBD.
- **License.** Default MIT for tooling; Apache-2.0 if we expect contributors who care about patent grants. Decide before repo init.
- **npm scope.** `@org/a11y-auditor` or unscoped `a11y-auditor`? Affects squatting risk.
- **Skill name on skills.sh.** Today's name is `auditor`. Keep, or pick something more specific (e.g., `a11y-auditor`, `wcag-auditor`)?
- **What's the persistent v2 deliverable to the user beyond the JSONL?** Now partly answered: `report --mode screen-reader` renders `findings/screen-reader.md`. Should a general (all-criteria) markdown report also be a v2 must-ship, or just the SR-concern one?

---

## 19. Bootstrap manifest (first day in new repo)

Order of operations once the new repo exists:

1. `git init`, `package.json`, `tsconfig.json`, `eslint`, `prettier`, `.gitignore`.
2. `.devcontainer/devcontainer.json` mirroring the sprite-bootstrap apt list + Bun + Node + **Orca + xvfb + dbus + at-spi**.
3. **Orca-headless spike** — `apt install` + `xvfb-run` + `sr doctor` against `fixtures/sr-smoke/`. Decides whether the SR gate lives in the Codespaces canary or a dedicated runner (slice 0).
4. `.github/workflows/ci.yml`: smoke eval job + Codespaces canary + SR-in-Codespaces gate.
5. `AGENTS.md` at root: 1-page brief (incl. the three-tier model + the Tier 0 / Agent-SDK boundary).
6. `docs/PLAN.md` (this doc, polished).
7. `src/schema/{decisionLog,runHeader,statesYml}.ts` + emit script + JSON Schema artifacts.
8. `skills/auditor/data/criteria.json` (copy from v1).
9. `skills/auditor/data/categories.json` (write fresh).
10. `skills/auditor/data/confidence-rubric.md`.
11. Stub `src/cli/index.ts` that prints `--help`.
12. Empty `runs/` with gitignore.
13. Conscious-copy: `fixtures/act/` from v1; author `fixtures/sr-smoke/` tiny page.

After day 1, slice work proceeds in numbered order per §15.

---

*End of plan. Next step: `/grill-me` stress test on this whole document before any code is written.*
