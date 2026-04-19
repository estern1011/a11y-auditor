# Plan: Web dashboard + workflow-driven auditor

## Context

A Claude Design bundle was fetched from the provided `api.anthropic.com/v1/design/...` URL. It's a React prototype for a web UI with three surfaces:

1. **Configure** — URL + WCAG level + viewport + SR engine + tool toggles → launch.
2. **Run** — orchestrator graph (orchestrator + 3 sub-agents), 6-phase rail, event timeline, "VNC · live view" of the browser the agents are driving.
3. **Findings** — filterable list, detail pane with Overview / Evidence (annotated screenshot + markers) / SR Transcript / Remediation tabs.

### What this repo is today

- Bun-based Claude Code **skills + agents** package (`skills/auditor`, `skills/acr`, `skills/vo-driver`, `skills/orca-driver`).
- Orchestrator today = `skills/auditor/SKILL.md` read by a Claude Code session. Sub-agents = `.claude/agents/{baseline-collector,keyboard-walker,visual-cross-referencer}.md`.
- Real tooling: `collect.ts`, `audit.ts`, `drivers/voiceover/driver.ts`, `drivers/orca/driver.ts` (HTTP API on 7483/7484, CDP on 9222/9223).
- Evals already run on **sprites.dev** sandboxes via `eval/sprite-bootstrap.sh` (installs Bun, Orca system deps, Chromium, agent-browser on a fresh sprite).
- No persistence, no event stream, no web surface yet.

### Decisions locked

1. **Liveness:** replay-first, then live observer. Phase A ships replay; Phase C adds SSE + CDP screencast.
2. **VNC source:** CDP screencast (`Page.startScreencast`) relayed over WebSocket.
3. **Runs storage:** configurable via `A11Y_RUNS_DIR`. Default `./runs/` when invoked from the repo.
4. **Execution model:** hybrid. VoiceOver runs locally on the user's Mac; Orca runs in a sprite. Both surface into the same UI.
5. **Workflow runtime: LangGraph.js.** Shape-native agent graph (declared nodes + conditional edges), first-class streaming (`streamEvents` → SSE), checkpointer-based durability, runs in-process (zero ops, trivial for hybrid local-Mac + sprite).
6. **Agent judgment at nodes:** nodes that need an LLM invoke Claude via **Agent SDK**, not via a nested Claude Code session.
7. **Sandbox layer:** stays as sprites.dev (already working via `eval/sprite-bootstrap.sh`); orthogonal to the runner and swappable later.

### Why this shape

- Current "Claude-Code-as-orchestrator" works for humans but is opaque to the UI — the UI can't see phases, steps, or branch decisions.
- LangGraph gives us a *declared* agent graph that the UI can render directly: nodes, conditional edges, state channels, streaming events. The graph definition in code IS the graph in the UI.
- Zero ops, hybrid-friendly: LangGraph is a library that runs in-process in Bun on the Mac or in the sprite, no shared server required.
- The Claude Code skill doesn't go away — it becomes a thin entry-point that calls the same runner.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Web UI (web/)                            │
│  Configure · Run (graph/rail/timeline/VNC) · Findings           │
└────────────────┬────────────────────────────────────────────────┘
                 │ REST + SSE + WebSocket
┌────────────────▼────────────────────────────────────────────────┐
│                       Server (server/)                           │
│  /api/runs · /events · /stream (SSE) · /screencast (WS)         │
│  POST /api/runs → dispatch: local or sprite                     │
└────────────────┬─────────────────────────────────┬──────────────┘
                 │                                 │
     ┌───────────▼──────────────┐     ┌────────────▼─────────────┐
     │  Local runner (macOS)    │     │  Sprite runner (Linux)   │
     │  bun runner/index.ts     │     │  sprite exec ... bun     │
     │  VoiceOver + Chromium    │     │  Orca + Xvfb + Chromium  │
     └───────────┬──────────────┘     └────────────┬─────────────┘
                 │                                 │
                 └─────────────┬───────────────────┘
                               │  writes to
                    ┌──────────▼──────────────┐
                    │  $A11Y_RUNS_DIR/<id>/   │
                    │   meta.json             │
                    │   events.ndjson         │
                    │   findings.json         │
                    │   markers.json          │
                    │   transcript.json       │
                    │   artifacts/*.png       │
                    └─────────────────────────┘
```

The runner is the same binary in both environments. Sprite runs are dispatched by the server via `sprite exec`. Local (macOS + VoiceOver) runs cannot be dispatched remotely — the server hands the user a copy-pasteable `bun run audit <url>` command, the user runs it on their Mac, and the runner writes into the local `$A11Y_RUNS_DIR` which the same-host server then reads.

Run directories are per-environment: the Mac runner writes to the Mac's filesystem, the sprite runner writes to the sprite's filesystem. For Orca runs the server reconciles the sprite's run dir back (rsync on completion; Phase C may push NDJSON line-by-line).

## LangGraph graph

```
boot ──► discover ──► baseline ──► keyboard ──► visual ──► report
                          │            │           │
                          │            │           └─► [empty tree → skip]
                          │            └─► [no interactive → skip]
                          └─► [auth gate? → auth → baseline]
```

### State schema (`runner/state.ts`)

Illustrative shape — actual code is source of truth. Typed state channels via `Annotation.Root`; each node returns a partial update and reducers merge:

```ts
export const State = Annotation.Root({
  url: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  sr: Annotation<'voiceover' | 'orca'>({ reducer: (_, b) => b, default: () => 'orca' }),
  driverPort: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  findings: Annotation<Finding[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  transcript: Annotation<TranscriptLine[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  artifacts: Annotation<Record<string, string>>({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  phaseStatus: Annotation<Record<PhaseId, PhaseStatus>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({ boot: 'pending', discover: 'pending', baseline: 'pending', keyboard: 'pending', visual: 'pending', report: 'pending' }),
  }),
  // agent-decided signals used by conditional edges:
  needsAuth: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  hasInteractive: Annotation<boolean>({ reducer: (_, b) => b, default: () => true }),
  treeEmpty: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
});
```

### Graph definition (`runner/graph.ts`)

Illustrative — real edges live in code. The "skip" annotations in the ASCII diagram above are upstream branch decisions: `baseline` decides whether `keyboard` runs, and whichever of `{baseline, keyboard}` hands off last decides whether `visual` runs.

```ts
const g = new StateGraph(State)
  .addNode('boot', bootNode)           // tool: start SR driver, write meta.json
  .addNode('discover', discoverNode)   // tool: collect.ts → writes state.artifacts + transcript
  .addNode('auth', authNode)           // agent: Claude Agent SDK session to complete a login flow
  .addNode('baseline', baselineNode)   // agent: baseline-collector
  .addNode('keyboard', keyboardNode)   // agent: keyboard-walker
  .addNode('visual', visualNode)       // agent: visual-cross-referencer
  .addNode('report', reportNode)       // tool: write findings.json + markers.json
  .addEdge(START, 'boot')
  .addEdge('boot', 'discover')
  .addConditionalEdges('discover', s => s.needsAuth ? 'auth' : 'baseline')
  .addEdge('auth', 'baseline')
  .addConditionalEdges('baseline', s =>
    s.hasInteractive ? 'keyboard' : (s.treeEmpty ? 'report' : 'visual'))
  .addConditionalEdges('keyboard', s => s.treeEmpty ? 'report' : 'visual')
  .addEdge('visual', 'report')
  .addEdge('report', END);

export const graph = g.compile({ checkpointer });
```

### Node shape

- **Tool nodes** (`boot`, `discover`, `report`) call `collect.ts` / `audit.ts` / driver HTTP API and return a partial state update.
- **Agent nodes** (`auth`, `baseline`, `keyboard`, `visual`) wrap a Claude **Agent SDK** session configured from the existing `.claude/agents/<id>.md` file (system prompt + tool allowlist). The node awaits the session, parses its structured output, and returns the state patch including the signals that drive conditional edges (`hasInteractive`, `treeEmpty`, etc.).

### Durability + UI event stream

- **Checkpointer**: `SqliteSaver` at `<run-dir>/graph.sqlite`. Resume via `graph.stream(null, { configurable: { thread_id: runId } })` — LangGraph replays state from the last checkpoint.
- **Event stream**: The runner does `for await (const ev of graph.streamEvents(input, { version: 'v2', configurable: { thread_id } }))` and appends each event to `events.ndjson`. The server's SSE endpoint re-streams those lines. The web UI's agent-graph + timeline render from the same events.
- Graph visualization for the UI: `graph.getGraph().drawMermaid()` emits a mermaid source. Save it to `<run-dir>/graph.mmd` at boot so the UI can render the exact declared shape.

## Phase A — replay dashboard + LangGraph runner

Goal: full UI reads from on-disk run dirs. Runner replaces the "SKILL.md read by Claude Code" orchestration for new runs. Existing Claude Code skill still works as a thin entry-point.

### Runner (new `runner/`)

- `runner/index.ts` — CLI: `bun runner/index.ts <url> [--wcag AA] [--viewport 1440x900] [--sr voiceover|orca] [--run-id <id>]`. Creates a run dir, writes `meta.json`, compiles + invokes the LangGraph graph, streams events to `events.ndjson`.
- `runner/graph.ts` — LangGraph `StateGraph` definition (see above).
- `runner/state.ts` — typed `Annotation.Root` state schema.
- `runner/nodes/` — one file per node: `boot.ts`, `discover.ts`, `auth.ts`, `baseline.ts`, `keyboard.ts`, `visual.ts`, `report.ts`.
- `runner/agent-host.ts` — wraps Claude Agent SDK. Loads the relevant `.claude/agents/<id>.md` as system prompt + tool allowlist and runs the agent to completion. Returns structured output for the node to turn into a state patch.
- `runner/events.ts` — adapter that turns LangGraph `streamEvents` output into our NDJSON line format (stable schema for the UI, independent of LangGraph internal event shapes).
- `runner/tools/` — small wrappers around `collect.ts`, `audit.ts`, the SR driver HTTP API. These are what tool nodes call.

### Server (new `server/`)

- `server/index.ts` — `Bun.serve`. Routes:
  - `GET /api/runs` → list
  - `GET /api/runs/:id` → meta + step-graph status (derived from events)
  - `GET /api/runs/:id/{events,findings,markers,transcript}`
  - `GET /api/runs/:id/artifacts/*`
  - `POST /api/runs` → dispatch. Body: `{ url, sr: 'voiceover'|'orca', ... }`.
    - If `sr === 'orca'`: spawn `sprite exec -s <name> ... bun runner/index.ts <url> --run-id <id>`. Returns run-id.
    - If `sr === 'voiceover'`: returns run-id + a copy-pasteable launch command for the user's local Mac. (Can't drive the Mac remotely.)
  - Static fallback → `web/dist`.
- `server/runs.ts` — run-dir helpers.
- `server/dispatch.ts` — sprite dispatch (wraps `sprite` CLI).

### Web app (new `web/`)

Vite + React + TS. Ports the prototype verbatim then swaps mock data for API calls.

- `web/src/views/{Configure,Run,Findings}.tsx`.
- `web/src/components/{AgentGraph,PhaseRail,Timeline,VncViewer,Sidebar,Topbar,Icon}.tsx`.
- `web/src/styles/{app,agent-graph,vnc,tokens,ui}.css` — copy from the design bundle.
- `web/src/api.ts` + `web/src/types.ts`.
- AgentGraph renders from `graph.mmd` (LangGraph-generated mermaid source) + per-node status derived from `events.ndjson`. Phase rail projects from the same status map.

### Claude Code skill entry point

- `skills/auditor/SKILL.md` — reduced to a short instruction: "To audit `<url>`: run `bun runner/index.ts <url>` from the repo. Report the run-id. The UI shows progress." Preserves the familiar `/auditor` affordance but delegates to the runner.

### De-scoping (Phase A)

- Drop the Tweaks FAB, split run tab, pop-out VNC modal, draggable Evidence markers.
- Skip stub pages for runs/criteria/acr/targets/settings — omit the nav entries.

## Phase B — sprite-dispatched Orca runs

Goal: Configure → Start in the UI actually launches an Orca run without the user touching a terminal.

- `server/dispatch.ts` implements `dispatchSprite(run)`:
  1. `sprite create <name> --skip-console`
  2. `cat eval/sprite-bootstrap.sh | sprite exec -s <name> -- bash -s -- <branch>`
  3. `sprite exec -s <name> --dir ~/a11y-auditor -- env A11Y_RUN_ID=<id> A11Y_RUNS_DIR=<shared> bun runner/index.ts <url> ...`
  4. Optional: stream NDJSON back by tailing the sprite's run dir via `sprite exec ... tail -f`.
- Run dir sharing: simplest first pass is "write inside the sprite, rsync back on completion." Upgrade to a live fuse mount or S3-backed runs dir later if needed.
- Auth: for private URLs, `meta.json` carries optional headers/cookies the runner forwards to the driver's `start` command.

## Phase C — live observer

- `GET /api/runs/:id/stream` (SSE) — tails `events.ndjson`, pushes new lines. Closes on `{k:'done'}`.
- `GET /api/runs/:id/screencast` (WS) — opens CDP on the run's driver port (stored in `meta.json`), calls `Page.startScreencast`, relays frames. Only valid while the run is live.
  - For local (VoiceOver) runs: the server connects to `localhost:9222` on the same machine.
  - For sprite (Orca) runs: server connects via a port-forwarded CDP endpoint (`sprite port-forward`).
- Web switches Run view to SSE when `status === 'running'`; replays history then streams new events. VncViewer becomes a real screencast client.

## Critical files

New:
- `runner/{index.ts,graph.ts,state.ts,agent-host.ts,events.ts,nodes/,tools/}`
- `server/{index.ts,runs.ts,dispatch.ts}`
- `web/` — full Vite + React + TS project
- `.gitignore` — add `runs/`, `web/dist/`, `web/node_modules/`
- Root `package.json` — scripts (`audit`, `web:dev`, `server:dev`, `dev`, `build`) + deps (`@langchain/langgraph`, `@langchain/langgraph-checkpoint-sqlite`, `@anthropic-ai/claude-agent-sdk`)

Existing to reuse / modify:
- `collect.ts:148-166` `Evidence` shape → runner tool wrapper; Evidence tab. Add `--out` flag.
- `audit.ts:34-44` `AuditResult` shape → runner tool wrapper; Findings source. Add `--out` flag.
- `drivers/voiceover/driver.ts`, `drivers/orca/driver.ts` — reused unchanged; runner calls HTTP API on 7483/7484.
- `skills/auditor/SKILL.md` — reduced to an entry-point instruction that invokes the runner.
- `.claude/agents/{baseline-collector,keyboard-walker,visual-cross-referencer}.md` — reused as Agent SDK system prompts; frontmatter defines the tool allowlist the runner hands to the SDK session.
- `eval/sprite-bootstrap.sh` — already installs everything needed; server's dispatcher calls it unchanged.
- `skills/acr/criteria.json` — source for Findings criterion text.

## Verification (per phase)

Phase A:
- `bun run audit https://example.com` on a Mac → run dir populated → UI lists it → Findings page renders real violations → Evidence tab shows screenshot + markers.
- Same command on a sprite via `sprite exec` → same output shape.
- Kill the runner mid-run → relaunch with `--run-id <id>` → LangGraph checkpointer resumes from the last completed node.
- UI renders the agent graph from `graph.mmd` and per-node status from `events.ndjson`.
- `bun run build` produces a single deploy bundle.

Phase B:
- UI Configure → Start with `sr: orca` → sprite spins up → run appears in UI within ~30s → completes end-to-end without terminal interaction.

Phase C:
- Local VoiceOver run: timeline fills in real time via SSE; VNC tab shows live Chromium at >5fps.
- Sprite Orca run: same, via port-forwarded CDP.

## Open questions

To resolve before or during Phase A:

- **Secrets flow.** Every agent node needs `ANTHROPIC_API_KEY`. Where does the key live for (a) local Mac runs, (b) sprite runs dispatched by the server, (c) the server itself? Candidates: `.env` read by the runner for local; `sprite` env vars piped through dispatch for cloud; server reads from its own host env, never echoes to the UI.
- **Driver port allocation.** Default ports are 9222 (VoiceOver) and 9223 (Orca) — concurrent runs on one host will collide. Proposal: the runner picks a free port at boot, writes it to `meta.json`, and passes it to the driver as `--cdp-port`. Requires adding a `--cdp-port` flag to both driver scripts.
- **Cancel / timeout.** No user-triggered cancel from the UI and no per-node timeout. LangGraph runs can hang on a stuck agent. Proposal: `DELETE /api/runs/:id` sends SIGTERM (local) / `sprite exec … kill` (sprite); each node carries a `timeoutMs` that the runner enforces via `AbortSignal`.
- **Cost envelope.** Each run fans out to ~3 Agent SDK sessions plus the `auth` session when triggered. No per-run token cap or cost estimate. Proposal: runner accumulates usage into state, emits a `budget` event line, and aborts above a configurable ceiling.
- **Auth node security.** The plan currently describes the `auth` node as "Claude Agent SDK session to complete a login flow" — that's hand-wavy for credential handling. Needs a dedicated design note before it ships: where credentials come from, how they're scoped, whether the session records them in `transcript.json`, how they're scrubbed from screenshots.

## Risks

- **Agent SDK vs. Claude Code agent parity.** The runner hosts sub-agents via Agent SDK using the same `.claude/agents/*.md` prompts. Need to confirm tool-allowlist + transcript semantics match what those agents expect today. Mitigation: keep the three agent files unchanged; `agent-host.ts` reads the same frontmatter and configures the SDK session identically.
- **LangGraph event-shape churn.** LangGraph's `streamEvents` schema evolves. Mitigation: `runner/events.ts` translates LangGraph events into our stable NDJSON schema — the UI never sees LangGraph types directly.
- **Agent output → state contract.** Conditional edges depend on signals the agent must return (`needsAuth`, `hasInteractive`, `treeEmpty`). Mitigation: each agent node validates its Agent SDK output against a Zod schema before returning the state patch; on validation failure the node fails loudly.
- **Sprite run-dir shuttling.** "Write in sprite, rsync back" is simple but adds latency to the UI for live runs. If that bites, swap to a shared FUSE mount or push each event line back via `sprite exec ... tee -a`.
- **CDP screencast coupling.** Screencast WS needs the run's CDP port; runner writes it into `meta.json` on boot, server reads from there.
- **Claude Code skill compatibility.** Users with `/auditor` muscle-memory still get a working flow; just delegate to the runner. No breaking change.
