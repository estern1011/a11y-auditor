# `agent-orca-driver` — Plan

**Status:** working spec. The composable bottom layer that v1 (this repo), the v2 plan (#22), and the work-codebase Cursor skill can all consume.
**Audience:** internal. Seed for the new repo's `README.md`.
**Branch:** `claude/cursor-a11y-skill-spec-Q4LQE` of `estern1011/a11y-auditor`.

---

## 1. Why this layer

Both v1 (this repo) and the v2 plan (#22) bundle three things together: the *driver* (Orca + Chromium + Xvfb plumbing), the *methodology* (WCAG reasoning, criteria taxonomy, confidence rubric), and the *orchestration* (target selection, multi-state recipes, report generation). Bundling them couples decisions that should be separable — v1 can't easily be used outside Claude Code, v2's spec re-implements the driver layer from scratch, and the work-codebase Cursor skill (the immediate consumer) can't use either because both assume their own methodology rather than composing with one already in place.

`agent-orca-driver` extracts the bottom layer cleanly. It's an HTTP daemon — same shape as `agent-browser`, but driving Orca + Chromium under Xvfb instead of just Chromium — that any orchestration layer can sit on top of. Install in any Linux env (Codespaces first-class), `npx agent-orca-driver start <url>`, point any code agent at `http://localhost:8001`, watch live over VNC on a forwarded port.

**Nothing in the driver layer makes WCAG judgments, picks targets, or writes reports.** That's the orchestrator's job — and there can be many orchestrators in parallel: the work-codebase Cursor skill is the immediate one; v1 refactored to consume this package is another; v2's planned auditor (if revived) is a third. All three share the same HTTP API; the driver doesn't know or care which is calling.

---

## 2. Scope

### What `agent-orca-driver` is

- A Node CLI (`npx agent-orca-driver`) that spawns Orca + a windowed Chromium on a virtual X display (Xvfb) and exposes a single HTTP daemon on a localhost port. *Headless from the operator's POV — no physical display required — but Chromium itself runs as a normal X11 windowed process, because Orca tracks focus via AT-SPI on a real window and the noVNC live view needs something to render.*
- A shared `setup.sh` that provisions everything Orca needs in a fresh Linux container (apt packages, xvfb, dbus, at-spi2, pulseaudio, x11vnc, noVNC, websockify) with one command.
- The same HTTP API the existing `drivers/server.ts` in v1 already exposes — `/navigate`, `/next`, `/previous`, `/act`, `/perform`, `/press`, `/enter`, `/item-text`, `/transcript`, `/audit`, `/loading-state`, `/observe`, `/wait-for-selector`, `/commands`, `/stop`. Byte-identical.
- A live-view URL (noVNC over forwarded port) so the human watching Cursor can see Orca + Chromium working in real time.
- An `AGENTS.md` host-agnostic doc explaining the API + canonical loops, so Cursor, Claude Code, Continue, or any agent that can `curl` can drive it from day one.

### What `agent-orca-driver` is NOT

- Not a WCAG knowledge base. Doesn't ship `criteria.json`, `categories.json`, a confidence rubric, or any methodology. That's the consumer's skill's job.
- Not an LLM-orchestrated auditor. No Agent SDK, no API key, no chain-of-draft. The agent driving it brings its own intelligence.
- Not a decision-log / VPAT / ACR generator. Doesn't define any output schema beyond the HTTP responses themselves.
- Not a `states.yml` runner. Playwright already runs `states.yml`-shaped recipes; the consumer's skill calls `agent-orca-driver` from inside a Playwright script if it needs SR coverage of each state.
- Not a macOS tool. **Linux/Orca only.** VoiceOver stays in v1; a future `vo-driver` sibling can mirror the same HTTP API if/when macOS demand appears.
- Not a `skills.sh` skill. It's a CLI tool. The agent's skill (which lives in the consumer's codebase) calls into it.

---

## 3. Architecture

One process, one port, three responsibilities:

```
┌──────────────────────────────────────────────────────────────┐
│  npx agent-orca-driver start <url> --port 8001 --vnc-port 6080       │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │  Chromium    │  │  Orca SR     │  │  HTTP daemon     │    │
│  │  (windowed   │◀▶│  (AT-SPI +   │◀▶│  /next /act      │    │
│  │   on Xvfb,   │  │   xdotool)   │  │  /transcript ... │    │
│  │   CDP on N)  │  │              │  │                  │    │
│  └──────────────┘  └──────────────┘  └──────────────────┘    │
│         │                  │                   ▲             │
│         ▼                  ▼                   │             │
│       Xvfb :99 ──── x11vnc ──── websockify ── noVNC HTTP     │
│                         (forwarded port: live view in browser)│
└──────────────────────────────────────────────────────────────┘
```

Three boundaries to respect:

1. **HTTP surface = stable contract.** Same routes regardless of underlying driver. A future `vo-driver` on macOS implements the same routes.
2. **No LLM dependency, no API key.** Pure Node + child processes. Runs offline.
3. **Setup is idempotent and one-command.** `npx agent-orca-driver setup` works in a fresh Codespace, fresh Docker container, or fresh GitHub-Actions runner.

---

## 4. CLI surface

```
npx agent-orca-driver setup           # apt install + provision xvfb/dbus/at-spi2/pulseaudio/x11vnc/noVNC
npx agent-orca-driver start <url>     # spawn Chromium + Orca + daemon; print listening URLs
                              # options: --port 8001  --cdp-port 9222  --vnc-port 6080
npx agent-orca-driver stop            # tear down daemon + child processes
npx agent-orca-driver status          # is daemon up? what URL is loaded? on what ports?
npx agent-orca-driver doctor          # preflight: xvfb running? dbus? at-spi2? orca on PATH?
```

`setup` is sudo-required (apt) and idempotent. `start` is non-sudo. `doctor` exits non-zero with a one-line diagnosis if anything's missing — useful in CI gates.

After `start`, two URLs print:
```
HTTP API:   http://localhost:8001
Live view:  http://localhost:6080/vnc.html?autoconnect=1
            (Codespaces auto-forwards both — open in any browser tab)
```

---

## 5. HTTP API

Copied verbatim from v1's `drivers/server.ts`. Stable contract — any v1 consumer keeps working.

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Status (daemon up, current URL, CDP port) |
| POST | `/navigate` | `{url}` — load URL, focus into page |
| POST | `/enter` | Focus into web area (after load) |
| POST | `/next` / `/previous` | Move SR focus one item |
| POST | `/act` | Activate the focused item |
| POST | `/perform` | `{command}` — named SR action from the driver's command catalog (e.g. `FIND_NEXT_HEADING`, `READ_CURRENT_ITEM`, `FIND_NEXT_LANDMARK`, `OPEN_WEB_ROTOR`). See `GET /commands` for the full list. Raw keypresses (Tab, Escape, etc.) go through `/press`, not `/perform`. |
| POST | `/press` | `{key, modifiers?}` — raw keypress |
| GET | `/item-text` | Read text/role/state of current SR focus |
| GET | `/transcript?since=N` | SR announcement log (incremental) |
| DELETE | `/transcript` | Clear transcript buffer |
| POST | `/audit` | Run axe-core against current page (CDP-injected) |
| GET | `/loading-state` | Is the page settled? |
| POST/GET/DELETE | `/observe` | Start/poll/stop a DOM mutation observer |
| POST | `/wait-for-selector` | `{selector, state?, timeout?}` |
| GET | `/commands?filter=` | List of `/perform` commands the driver supports |
| POST | `/stop` | Graceful shutdown |

Security (carried from v1): bound to `127.0.0.1`, host + origin allow-list, navigation URL scheme allow-list (`http`/`https`/`data` only).

---

## 6. Live view (VNC) — the new piece

`setup.sh` provisions, `start` boots:

```bash
# In scripts/setup.sh (added to existing start-env):
x11vnc -display :99 -localhost -forever -shared -nopw -bg -quiet -ncache 10
websockify -D ${VNC_PORT:-6080} localhost:5900 \
  --web=/usr/share/novnc
```

Codespaces auto-forwards both `--port` (HTTP API) and `--vnc-port` (noVNC HTTP). The user opens the noVNC URL in any browser tab and sees Chromium + Orca's caret tracking live — same UX as opening a dev-server URL.

**Why x11vnc + noVNC and not CDP screencast:** CDP only shows the browser viewport. We want the full Xvfb display so Orca's focus indicator, system caret, and any overlay UI are all visible — exactly what a sighted dev would see if they sat next to a screen-reader user.

**Security note:** `-nopw` is acceptable because `-localhost` is passed explicitly (without it, `x11vnc` would listen on all interfaces — `-nopw` alone does *not* imply loopback binding, per the x11vnc man page). VNC sits on `127.0.0.1:5900` only; the only public surface is the `websockify` port, which Codespaces gates behind the user's GitHub auth. Outside Codespaces, the operator is responsible for not exposing `--vnc-port` publicly — the CLI prints a warning if `--vnc-port` is bound to `0.0.0.0` without `--vnc-password`, and refuses to start if `--vnc-port` is `0.0.0.0` AND `--vnc-password` is empty.

---

## 7. Distribution

```jsonc
// package.json
{
  "name": "agent-orca-driver",
  "type": "module",
  "bin": { "agent-orca-driver": "dist/bin/agent-orca-driver.js" },
  "files": ["dist/", "scripts/"],
  "engines": { "node": ">=20.0.0" }
}
```

- Single npm package. `npx agent-orca-driver` or `npm i -g agent-orca-driver`.
- Built with `tsc` (no Bun runtime dep — Node-only ship target, same migration v2-plan §10 already scoped at ½ day).
- `scripts/setup.sh` ships in the package (`files` array) so `npx agent-orca-driver setup` resolves to it.
- No `skills.sh` integration. The consumer's skill (which lives in their codebase) shells out to `npx agent-orca-driver`.

---

## 8. Repo layout

```
agent-orca-driver/
├── bin/
│   └── agent-orca-driver.ts                # CLI entry (commands: setup/start/stop/status/doctor)
├── src/
│   ├── server.ts                   # HTTP daemon (Node port of v1's drivers/server.ts)
│   ├── interface.ts                # ScreenReaderDriver type
│   ├── orca/
│   │   ├── driver.ts
│   │   ├── core.ts                 # AT-SPI + xdotool
│   │   ├── speech.ts               # speech-dispatcher tap
│   │   ├── atspi.ts
│   │   └── types.ts
│   ├── browser/
│   │   └── chromium.ts             # launch Chromium windowed on Xvfb (NOT --headless) with CDP
│   ├── audit.ts                    # axe-core injection (port from v1)
│   ├── wait.ts                     # loading-state, observer, waitForSelector
│   └── lib/
│       └── runtime-paths.ts        # pidfile + logfile locations
├── scripts/
│   ├── setup.sh                    # apt + start-env + x11vnc + noVNC
│   └── devcontainer/               # optional: drop-in .devcontainer for users
├── test/
│   └── smoke.test.ts               # boot driver against fixtures/, walk 2 tab stops
├── fixtures/
│   └── smoke.html                  # minimal page for the smoke test
├── AGENTS.md                       # the host-agnostic doc agents read
├── README.md                       # quickstart + Cursor recipe
├── package.json
└── tsconfig.json
```

---

## 9. `AGENTS.md` — the asset that gives Cursor autonomy

This is the actual deliverable. Outline:

1. **Mental model (1 paragraph).** "agent-orca-driver is to Orca what agent-browser is to Chromium. HTTP API, JSON in/out, session-style. The daemon owns Orca + Chromium; you own the reasoning."

2. **Quickstart.** `npx agent-orca-driver setup` → `npx agent-orca-driver start https://...` → curl the API. Three commands.

3. **HTTP route table.** Same table as §5, with one-line example curl per route.

4. **Three canonical loops** (the patterns Cursor will pick from):
   - **Walk focus order.** `POST /navigate` → `POST /enter` → loop `POST /next` + `GET /item-text` until `/transcript` shows the cycle restarting.
   - **Audit + announce.** `POST /navigate` → `POST /audit` (axe-core findings) → `POST /enter` → walk transcript → cross-reference axe violations with what SR actually announced.
   - **Drive through states.** Use Playwright separately to drive the page (via the same CDP port — `--cdp-port` is the Chromium CDP, exposed precisely so Cursor can drive Chromium *and* Orca against the same browser). For each state: `POST /transcript DELETE` → trigger state → `POST /enter` → walk → snapshot transcript.

5. **What agent-orca-driver is NOT** (anti-instructions): doesn't pick targets, doesn't make WCAG verdicts, doesn't write findings reports, doesn't ship project context. Those are the consumer's job.

6. **Recipes for specific hosts** (a few lines each, not a host-port-of-everything): Cursor (`.cursor/rules` snippet linking to the AGENTS.md sections), Claude Code (skill-style call pattern), shell/CI (curl examples).

---

## 10. Conscious-copy from v1

| From `estern1011/a11y-auditor` | To `agent-orca-driver` | Notes |
|---|---|---|
| `drivers/server.ts` | `src/server.ts` | Already Node-shaped; port the few Bun calls (~½ day) |
| `drivers/orca/*` | `src/orca/*` | Direct port |
| `drivers/interface.ts` | `src/interface.ts` | Drop VoiceOver-specific bits |
| `drivers/wait.ts` | `src/wait.ts` | Direct port |
| `drivers/runtime-paths.ts` | `src/lib/runtime-paths.ts` | Direct port |
| `audit.ts` (axe injection) | `src/audit.ts` | Port the axe-core wiring; drop the WCAG-tag filter taxonomy (consumer's concern) |
| `drivers/orca/setup.sh` | `scripts/setup.sh` | Extend with x11vnc + websockify + noVNC blocks |
| `.claude/skills/vo-driver/SKILL.md` | `AGENTS.md` | Rewrite host-agnostically; expand 3 canonical loops |

### What we don't copy

- `drivers/voiceover/*` — macOS only, out of scope.
- `collect.ts` — Cursor calls the HTTP API directly; doesn't need a batch collector.
- `cli.ts` (v1 root) — replaced by `bin/agent-orca-driver.ts` with a smaller subcommand set.
- `.claude/agents/*` — Claude-Code-specific orchestration. Cursor's skill orchestrates differently.
- `eval/`, `eval/queue-*`, fixtures — out of scope; this is a driver, not an auditor.

---

## 11. Roadmap (~5 working days)

| Day | Slice | Acceptance gate |
|---|---|---|
| 1 | Bootstrap repo + package.json + tsconfig + bin entry. Port driver code from v1 to Node (drop Bun calls). | `tsc` clean. `npm pack` produces a tarball. Daemon boots locally, `/` returns status. |
| 2 | `scripts/setup.sh`: apt install + xvfb/dbus/at-spi2 + x11vnc + noVNC + websockify. `doctor` subcommand. | Fresh Codespace: `npx agent-orca-driver setup` then `npx agent-orca-driver doctor` exits 0. |
| 3 | Smoke test: `start <fixture>`, walk 2 tab stops, verify transcript. End-to-end Codespace run with VNC. | `test/smoke.test.ts` passes in CI. Open noVNC URL in browser, see Chromium + Orca. |
| 4 | `AGENTS.md` (host-agnostic), `README.md` (quickstart). Manual smoke with Cursor against a real page. | Cursor, given only AGENTS.md, drives a focus-order walk + axe audit successfully. |
| 5 | Publish to npm. Add a GitHub Action that runs the smoke test on every PR. Buffer for issues. | `npm install -g agent-orca-driver && agent-orca-driver setup && agent-orca-driver doctor` works on a vanilla Ubuntu container. |

### Out of scope for v1.0

- macOS support (`vo-driver` is a future sibling package)
- WCAG taxonomy / criteria / categories / methodology (consumer's skill)
- Decision-log schema / report rendering / archive (consumer's skill, or v2 if revived)
- `states.yml` runner (Cursor + Playwright via CDP port handles this)
- Agent-SDK-orchestrated `audit` command (consumer's host is the LLM)
- Multi-host verification matrix beyond a smoke check on Cursor + Claude Code

---

## 12. Composability — three consumers, one driver

`agent-orca-driver` is deliberately the *bottom* layer. Three different orchestration layers can sit on top of it, all consuming the same HTTP API:

| Consumer | What it adds on top of the driver |
|---|---|
| **Work-codebase Cursor skill** | Project + product context, target selection, WCAG reasoning informed by the design system. The original motivating consumer. |
| **v1 (`estern1011/a11y-auditor`)** | The existing methodology skill, `audit.ts` / `collect.ts` orchestration, the eval queue, batch tooling, the `acr` report generator. Refactored to depend on `agent-orca-driver` instead of embedding `drivers/orca/` directly. |
| **v2 (`#22` plan, if revived)** | Decision-log JSONL schema, Tier-0 collector taxonomy, `states.yml` runner, Agent-SDK `audit` command, eval scorer, chain-of-draft methodology. Built as a separate package that depends on `agent-orca-driver` for the SR hands. |

The driver doesn't know or care which is calling. Its job is to make Orca + Chromium + Xvfb + AT-SPI work reliably in a no-physical-display Linux env (Chromium runs windowed on the virtual X display so Orca + VNC both function) and expose a stable HTTP API. Any of the three consumers can ship, evolve, or be replaced independently without touching the driver.

### Migration path for v1

v1's `drivers/orca/` and `drivers/server.ts` are extractable into `agent-orca-driver`. Once the new package is published:

1. v1 adds `agent-orca-driver` as a dependency.
2. v1's existing CLI (`cli.ts`) replaces its embedded `drivers/orca/` invocations with calls to the npm package's bin (or its HTTP API).
3. v1's `drivers/voiceover/` stays in v1 — the Linux-only driver doesn't replace it.
4. Optional: v1's `audit.ts` and `wait.ts` axe-injection code also migrate into `agent-orca-driver`, since they're driver-adjacent (they back the `/audit`, `/loading-state`, `/observe`, `/wait-for-selector` routes). Or they stay in v1 and v1 calls those routes over HTTP — equivalent outcome, choose later.

This turns the temporary code duplication (driver lives in two places between publish and v1 cutover) into an *explicit, time-bounded refactor* rather than a "copy and let it drift" choice. v1's release cadence and the driver's release cadence become independent — exactly what the layering buys you.

---

## 13. Open questions

1. **Repo home.** New repo under `estern1011/agent-orca-driver`, or under an org (`@a11y-tools/agent-orca-driver`)?
2. **npm scope.** Unscoped `agent-orca-driver` (squat risk; check availability) or scoped `@estern1011/agent-orca-driver` / `@a11y-tools/agent-orca-driver`?
3. **License.** MIT (default for tooling) vs Apache-2.0 (patent grant). Decide before publish.
4. **CDP port handling.** Should `start` always launch its own Chromium, or accept `--cdp-port` to attach to a Chromium the consumer already launched (so Playwright + Orca share one browser)? My lean: ship "launch own Chromium" in v1.0; add "attach to existing" in v1.1 once we see how Cursor actually wants to wire it.
5. **VNC password default.** No password by default (Codespaces gates the port behind GitHub auth) vs require `--vnc-password` to start? My lean: no password by default, big printed warning if `--vnc-port` is on `0.0.0.0`.
6. **Smoke fixture content.** A canned static HTML in the repo, or fetch a public page (e.g., `example.com`) in the smoke test? My lean: bundled HTML — no network dependency in CI.

---

*End of plan. Next step: spin up the new repo, port the v1 drivers, ship slice 1.*
