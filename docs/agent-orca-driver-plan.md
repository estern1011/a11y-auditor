# `agent-orca-driver` — Plan

**Status:** working spec. The composable bottom layer that v1 (this repo), the v2 plan (#22), and the work-codebase Cursor skill can all consume.
**Audience:** internal. Seed for the new repo's `README.md`.
**Branch:** `claude/cursor-a11y-skill-spec-Q4LQE` of `estern1011/a11y-auditor`.

---

## 1. Why this layer

Both v1 (this repo) and the v2 plan (#22) bundle three things together: the *driver* (Orca + Chromium + Xvfb plumbing), the *methodology* (WCAG reasoning, criteria taxonomy, confidence rubric), and the *orchestration* (target selection, multi-state recipes, report generation). Bundling them couples decisions that should be separable — v1 can't easily be used outside Claude Code, v2's spec re-implements the driver layer from scratch, and the work-codebase Cursor skill (the immediate consumer) can't use either because both assume their own methodology rather than composing with one already in place.

`agent-orca-driver` extracts the bottom layer cleanly. It ships in the same packaging shape as `agent-browser`: a CLI on PATH (`npm install -g agent-orca-driver`) plus a thin skills.sh skill stub (`npx skills add agent-orca-driver`) for host auto-discovery. The stub points the agent at `agent-orca-driver skills get core` at runtime to fetch the canonical API reference, which is bundled in the npm package as `AGENTS.md` — that same reference is what consumer-side orchestration skills inline into their own skill bodies. The CLI spawns Orca + a windowed Chromium on Xvfb and exposes an HTTP daemon any orchestration layer can drive. Live view over VNC on a forwarded port.

**Nothing in the driver layer makes WCAG judgments, picks targets, or writes reports.** That's the orchestrator's job — and there can be many orchestrators in parallel: the work-codebase Cursor skill is the immediate one; v1 refactored to consume this package is another; v2's planned auditor (if revived) is a third. All three share the same HTTP API; the driver doesn't know or care which is calling.

---

## 2. Scope

### What `agent-orca-driver` is

- **A Node CLI on PATH** (`npm install -g agent-orca-driver`) that spawns Orca + a windowed Chromium on a virtual X display (Xvfb) and exposes a single HTTP daemon on a localhost port. *Headless from the operator's POV — no physical display required — but Chromium itself runs as a normal X11 windowed process, because Orca tracks focus via AT-SPI on a real window and the noVNC live view needs something to render.* Standalone use is first-class: an agent can drive it directly via `agent-orca-driver --help` without any skill wrapper.
- **A thin skills.sh skill stub** (`npx skills add agent-orca-driver`) for host auto-discovery. The stub is intentionally minimal — it points the agent at `agent-orca-driver skills get core` at runtime to fetch the canonical API reference, which is bundled in the npm package as `AGENTS.md`. This keeps the reference aligned with the installed CLI version (no stale cached docs in the host's skill directory).
- **An embeddable canonical reference** (`AGENTS.md` in the package) — the same content `skills get core` prints — that orchestration skills inline into their own skill bodies when composing the driver knowledge with their own methodology.
- A shared `setup.sh` that provisions everything Orca + the daemon need in a fresh Linux container with one command: apt packages (xvfb, dbus, at-spi2, pulseaudio, x11vnc, noVNC, websockify, orca) **plus Playwright's Chromium binary** (`npx playwright install --with-deps chromium` — the daemon launches Chromium via Playwright, so the browser binary has to land in setup, not at first `start`).
- The same HTTP API the existing `drivers/server.ts` in v1 already exposes — `/navigate`, `/next`, `/previous`, `/act`, `/perform`, `/press`, `/enter`, `/item-text`, `/transcript`, `/audit`, `/loading-state`, `/observe`, `/wait-for-selector`, `/commands`, `/stop`. Byte-identical. CLI commands support `--json` for agent consumption.
- A live-view URL (noVNC over forwarded port) so the human watching the agent can see Orca + Chromium working in real time.

### What `agent-orca-driver` is NOT

- Not a WCAG knowledge base. Doesn't ship `criteria.json`, `categories.json`, a confidence rubric, or any methodology. That's the consumer's skill's job — the orchestration skill that *uses* `agent-orca-driver` carries the WCAG reasoning.
- Not an LLM-orchestrated auditor. No Agent SDK call inside the CLI, no API key. The agent host driving it brings its own intelligence.
- Not a decision-log / VPAT / ACR generator. Doesn't define any output schema beyond the HTTP responses themselves.
- Not a `states.yml` runner. Playwright already runs `states.yml`-shaped recipes; the consumer's orchestration skill calls into `agent-orca-driver` from inside a Playwright script if it needs SR coverage of each state.
- Not a macOS tool. **Linux/Orca only.** VoiceOver stays in v1; a future `agent-voiceover` sibling skill can mirror the same HTTP API if/when macOS demand appears.

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

The CLI is on PATH after `npm install -g agent-orca-driver`. Standalone invocation is first-class — agents can `agent-orca-driver --help` to discover it without any skill wrapper.

```
agent-orca-driver setup           # apt install + provision xvfb/dbus/at-spi2/pulseaudio/x11vnc/noVNC/chromium
agent-orca-driver start <url>     # spawn Chromium + Orca + daemon; print listening URLs
                                  # options: --port 8001  --cdp-port 9222  --vnc-port 6080
agent-orca-driver stop            # tear down daemon + child processes
agent-orca-driver status          # is daemon up? what URL is loaded? on what ports?
agent-orca-driver doctor          # preflight: xvfb running? dbus? at-spi2? orca on PATH? chromium installed?
agent-orca-driver skills get core # print the canonical AGENTS.md reference (what the skill stub points at)
```

All commands support `--json` for agent consumption (parsed by orchestration skills; `setup`/`start`/`doctor`'s human-readable output becomes a structured object).

`setup` is sudo-required (apt) and idempotent. `start` is non-sudo. `doctor` exits non-zero with a one-line diagnosis if anything's missing.

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
| POST | `/perform` | `{command}` — named SR action from the Orca command catalog (e.g. `FIND_NEXT_HEADING`, `FIND_NEXT_LANDMARK`, `READ_CURRENT_LINE`, `SAY_ALL`, `FIND_NEXT_BUTTON`). See `GET /commands` for the full Orca-specific list. Raw keypresses not in the catalog (Tab, arbitrary letters) go through `/press`. |
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
# In scripts/setup.sh — install side (apt + Playwright browser binary):
apt-get install -y --no-install-recommends \
  orca xvfb xdotool at-spi2-core dbus-x11 libatk-adaptor \
  espeak-ng speech-dispatcher pulseaudio openbox \
  x11vnc novnc websockify \
  libnss3 libnspr4   # plus other Chromium runtime deps
npx playwright install --with-deps chromium

# In scripts/setup.sh — start-env (launchers, run on every fresh shell):
x11vnc -display :99 -localhost -forever -shared -nopw -bg -quiet -ncache 10
websockify -D 127.0.0.1:${VNC_PORT:-6080} localhost:5900 \
  --web=/usr/share/novnc
```

Codespaces auto-forwards both `--port` (HTTP API) and `--vnc-port` (noVNC HTTP). The user opens the noVNC URL in any browser tab and sees Chromium + Orca's caret tracking live — same UX as opening a dev-server URL.

**Why x11vnc + noVNC and not CDP screencast:** CDP only shows the browser viewport. We want the full Xvfb display so Orca's focus indicator, system caret, and any overlay UI are all visible — exactly what a sighted dev would see if they sat next to a screen-reader user.

**Security note:** Both `x11vnc` (VNC on 5900) and `websockify` (noVNC HTTP on `${VNC_PORT}`, default 6080) bind to `127.0.0.1` explicitly. `-nopw` on x11vnc is acceptable *because* the listener is loopback-only — `-nopw` alone does *not* imply loopback binding (per the x11vnc man page), and websockify's `[source_addr:]source_port` syntax defaults to all interfaces when `source_addr` is omitted. In Codespaces, the auto-port-forwarding mechanism bridges `127.0.0.1:6080` to a GitHub-authenticated proxy URL; nothing is exposed to the public internet. Outside Codespaces, the operator must explicitly opt into network exposure by passing `--vnc-port 0.0.0.0:6080` — the CLI prints a warning if that's done without `--vnc-password`, and refuses to start if `--vnc-port` is `0.0.0.0` with an empty password.

---

## 7. Distribution

Two install steps, both recommended (matches `agent-browser`'s pattern):

| Step | Command | What it does |
|---|---|---|
| 1 | `npm install -g agent-orca-driver` | Puts the `agent-orca-driver` bin on PATH. Required — the skill stub and orchestration skills both assume the bin is callable by name. |
| 2 | `npx skills add agent-orca-driver` | Adds a thin discovery stub at the host's skills location (e.g. `~/.cursor/skills/agent-orca-driver/SKILL.md`). The stub points the agent at `agent-orca-driver skills get core` for the full reference. |

Standalone use works without step 2 — an agent can just discover the bin via `agent-orca-driver --help` or read `AGENTS.md` from the installed package. Step 2 is for hosts (Cursor, Claude Code) that auto-surface skills, to make discovery automatic.

```jsonc
// package.json
{
  "name": "agent-orca-driver",
  "type": "module",
  "bin": { "agent-orca-driver": "dist/bin/agent-orca-driver.js" },
  "files": ["dist/", "scripts/", "SKILL.md", "AGENTS.md"],
  "engines": { "node": ">=20.0.0" }
}
```

- Built with `tsc` (no Bun runtime dep — Node-only ship target, same migration v2-plan §10 already scoped at ½ day).
- `scripts/setup.sh` ships in the package (`files` array).
- Both `SKILL.md` (the thin stub) and `AGENTS.md` (the substantive canonical reference) ship in `files` so they travel with the npm package. `skills get core` reads `AGENTS.md` from the installed package and prints it to stdout — no network fetch, no hosted endpoint, content always matches the installed version.

---

## 8. Repo layout

The repo is the published artifact — `SKILL.md` and `AGENTS.md` at the root ship in the npm package; `skills.sh` discovers the stub via `SKILL.md`'s frontmatter.

```
agent-orca-driver/
├── SKILL.md                        # SKILL STUB — frontmatter declares the skills.sh skill;
│                                   #   body is minimal (mental model + "run `agent-orca-driver
│                                   #   skills get core` for the full API"). Host installs this.
├── AGENTS.md                       # CANONICAL API REFERENCE — what `skills get core` prints.
│                                   #   Full route table, three canonical loops, anti-instructions.
│                                   #   Orchestration-skill authors inline excerpts of this.
├── README.md                       # HUMAN-FACING — two-step install, quickstart, links.
├── bin/
│   └── agent-orca-driver.ts        # CLI entry (commands: setup/start/stop/status/doctor/skills)
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
│   ├── setup.sh                    # apt + start-env + x11vnc + noVNC + playwright chromium
│   └── devcontainer/               # optional: drop-in .devcontainer for users
├── test/
│   └── smoke.test.ts               # local-only smoke (no CI gating in v1.0)
├── fixtures/
│   └── smoke.html                  # minimal page for the smoke test
├── package.json
└── tsconfig.json
```

Three audience-distinct docs at the root, each with a different reader in mind:
- **`SKILL.md`** — the skill stub. Frontmatter (skills.sh manifest) + a tiny body (mental model paragraph + pointer to `skills get core`). Skills.sh installs this; hosts that auto-surface skills pick it up. Intentionally minimal so it doesn't go stale relative to the bin.
- **`AGENTS.md`** — the canonical agent-facing API reference. The bin's `skills get core` subcommand reads this from the installed package and prints it to stdout, so it's always aligned with the installed CLI version. Orchestration skills (work-skill, future v2) inline excerpts of this into their own skill bodies — that's the composition seam.
- **`README.md`** — human-landing-on-GitHub quickstart. The two-step install, what the tool does, links to SKILL.md and AGENTS.md for agents, dev setup notes for contributors.

---

## 9. `SKILL.md` + `AGENTS.md` — the two docs the agent sees

The split mirrors `agent-browser`'s pattern: SKILL.md is a thin discovery stub, AGENTS.md is the substantive canonical reference, and the bin's `skills get core` subcommand bridges them at runtime so the content stays aligned with the installed CLI version.

### 9a. `SKILL.md` — the discovery stub (~20 lines)

Lives at the repo root. Skills.sh installs this. Intentionally minimal — the substantive content lives in `AGENTS.md` and is reachable at runtime.

Outline:
1. **Frontmatter.** Standard skills.sh manifest — `name: agent-orca-driver`, `description`, `triggers`, declared bundled commands.
2. **Mental model (1 paragraph).** "agent-orca-driver is to Orca what agent-browser is to Chromium. HTTP API on `localhost:8001`, JSON in/out, session-style. The daemon owns Orca + Chromium; you own the reasoning."
3. **Pointer.** "For the full API reference, three canonical loops, and anti-instructions, run `agent-orca-driver skills get core`. That prints the canonical content from your installed CLI version — always aligned, never stale."

### 9b. `AGENTS.md` — the canonical agent-facing reference

Lives at the repo root, shipped in the npm package's `files` array. `agent-orca-driver skills get core` reads it from the installed package and prints to stdout. Orchestration skills inline excerpts into their own bodies.

Outline:
1. **Mental model.** Same paragraph as the SKILL.md stub (consciously duplicated — orchestration skills inlining excerpts shouldn't have to chase a reference).
2. **Quickstart.** Two-step install (`npm install -g` + `npx skills add`), then `agent-orca-driver setup` → `start <url>` → curl the API.
3. **HTTP route table.** Same table as §5, with one-line example curl per route and a `--json` note where it applies.
4. **Three canonical loops** (the patterns the agent picks from):
   - **Walk focus order.** `POST /navigate` → `POST /enter` → loop `POST /next` + `GET /item-text` until `/transcript` shows the cycle restarting.
   - **Audit + announce.** `POST /navigate` → `POST /audit` (axe-core findings) → `POST /enter` → walk transcript → cross-reference axe violations with what SR actually announced.
   - **Drive through states.** Use Playwright separately to drive the page (via the same CDP port — `--cdp-port` is the Chromium CDP, exposed precisely so the agent can drive Chromium *and* Orca against the same browser). For each state: `DELETE /transcript` → trigger state → `POST /enter` → walk → snapshot transcript.
5. **What agent-orca-driver is NOT** (anti-instructions for the agent): doesn't pick targets, doesn't make WCAG verdicts, doesn't write findings reports, doesn't ship project context. Those are the orchestrating skill's job.
6. **Inlining note** (for orchestration-skill authors). "If you're building an orchestration skill on top of this, copy the route table + the loop(s) you need into your own skill body. That keeps the agent's loaded context self-contained — your skill works whether or not `agent-orca-driver`'s SKILL.md is also loaded in the host."

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
| `drivers/orca/setup.sh` | `scripts/setup.sh` | Extend install side with x11vnc + novnc + websockify apt packages **and `npx playwright install --with-deps chromium`** (v1 setup.sh omits Playwright provisioning — the driver currently relies on Playwright Chromium being preinstalled elsewhere); extend start-env with x11vnc + websockify launchers |
| `.claude/skills/vo-driver/SKILL.md` | `SKILL.md` | Rewrite host-agnostically (drop Claude-Code-specific frontmatter, use the skills.sh manifest shape); expand 3 canonical loops |

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
| 1 | Bootstrap repo + package.json + tsconfig + bin entry. Port driver code from v1 to Node (drop Bun calls). Add `skills get core` subcommand stub that reads `AGENTS.md` from the package root and prints to stdout. | `tsc` clean. `npm pack` produces a tarball. Daemon boots locally, `/` returns status. `agent-orca-driver skills get core` prints `AGENTS.md` content. |
| 2 | `scripts/setup.sh`: apt install + xvfb/dbus/at-spi2 + x11vnc + noVNC + websockify + **Playwright Chromium binary** (`npx playwright install --with-deps chromium`). `doctor` subcommand verifies all of the above. | Fresh Codespace: `agent-orca-driver setup` then `agent-orca-driver doctor` exits 0; `agent-orca-driver start <fixture>` launches Chromium successfully without a separate `playwright install` step. |
| 3 | Smoke (manual): `start <fixture>`, walk 2 tab stops, verify transcript JSON. End-to-end Codespace run with VNC live view. Add `--json` to CLI commands. | In a fresh Codespace, operator walks the smoke fixture end-to-end and sees Chromium + Orca in the noVNC tab. `agent-orca-driver status --json` returns parseable JSON. No CI gate — that's a v1.1 concern. |
| 4 | `SKILL.md` (thin stub with frontmatter + pointer), `AGENTS.md` (the substantive canonical reference per §9b), `README.md` (two-step install + quickstart). Manual smoke with Cursor against a real page. | Cursor, after the two-step install, picks up the skill stub, fetches `AGENTS.md` via `skills get core`, and drives a focus-order walk + axe audit successfully. |
| 5 | Publish to npm + register skill on skills.sh. Buffer for issues. | `npm install -g agent-orca-driver && npx skills add agent-orca-driver` installs cleanly on Cursor + Claude Code; a fresh Codespace install + smoke walk succeeds. |

### Out of scope for v1.0

- macOS support (`agent-voiceover` is a future sibling package)
- WCAG taxonomy / criteria / categories / methodology (consumer's skill)
- Decision-log schema / report rendering / archive (consumer's skill, or v2 if revived)
- `states.yml` runner (Cursor + Playwright via CDP port handles this)
- Agent-SDK-orchestrated `audit` command (consumer's host is the LLM)
- CI automation of the smoke test (manual smoke in v1.0; CI gating is v1.1 if it becomes worth automating)
- Multi-host verification matrix beyond a manual smoke on Cursor + Claude Code

---

## 12. Composability — three consumers, one driver

`agent-orca-driver` is deliberately the *bottom* layer. Three different orchestration layers can sit on top of it, all consuming the same HTTP API:

| Consumer | What it adds on top of the driver |
|---|---|
| **Work-codebase Cursor skill** | Project + product context, target selection, WCAG reasoning informed by the design system. The original motivating consumer. |
| **v1 (`estern1011/a11y-auditor`)** | The existing methodology skill, `audit.ts` / `collect.ts` orchestration, the eval queue, batch tooling, the `acr` report generator. Refactored to depend on `agent-orca-driver` instead of embedding `drivers/orca/` directly. |
| **v2 (`#22` plan, if revived)** | Decision-log JSONL schema, Tier-0 collector taxonomy, `states.yml` runner, Agent-SDK `audit` command, eval scorer, chain-of-draft methodology. Built as a separate package that depends on `agent-orca-driver` for the SR hands. |

The driver doesn't know or care which is calling. Its job is to make Orca + Chromium + Xvfb + AT-SPI work reliably in a no-physical-display Linux env (Chromium runs windowed on the virtual X display so Orca + VNC both function) and expose a stable HTTP API. Any of the three consumers can ship, evolve, or be replaced independently without touching the driver.

**How consumers consume:** each orchestration-skill author runs `agent-orca-driver skills get core` (or reads `AGENTS.md` from the installed npm package) and inlines the route table + canonical loop(s) they care about into their own skill body. That keeps the orchestration skill self-contained — it works whether or not `agent-orca-driver`'s SKILL.md stub is also loaded in the host. The driver bin only needs to be on PATH.

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
2. **Skill name on skills.sh.** `agent-orca-driver` (matches the package), `orca-driver`, or something more verb-shaped (`audit-with-orca`)? Decides what users type after `npx skills add`.
3. **npm scope.** Unscoped `agent-orca-driver` (squat risk; check availability) or scoped `@estern1011/agent-orca-driver` / `@a11y-tools/agent-orca-driver`?
4. **License.** MIT (default for tooling) vs Apache-2.0 (patent grant). Decide before publish.
5. **CDP port handling.** Should `start` always launch its own Chromium, or accept `--cdp-port` to attach to a Chromium the consumer already launched (so Playwright + Orca share one browser)? My lean: ship "launch own Chromium" in v1.0; add "attach to existing" in v1.1 once we see how the consumer skill actually wants to wire it.
6. **VNC password default.** No password by default (Codespaces gates the port behind GitHub auth) vs require `--vnc-password` to start? My lean: no password by default, big printed warning if `--vnc-port` is on `0.0.0.0` (already addressed in §6 — refuses to start if `0.0.0.0` without `--vnc-password`).
7. **Smoke fixture content.** A canned static HTML in the repo, or fetch a public page (e.g., `example.com`) in the smoke test? My lean: bundled HTML — no network dependency in CI.

---

*End of plan. Next step: spin up the new repo, port the v1 drivers, ship slice 1.*
