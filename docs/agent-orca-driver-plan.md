# `agent-orca-driver` — Plan

**Status:** working spec. The composable bottom layer that v1 (this repo), the v2 plan (#22), and the work-codebase Cursor skill can all consume.
**Audience:** internal. Seed for the new repo's `README.md`.
**Branch:** `claude/cursor-a11y-skill-spec-Q4LQE` of `estern1011/a11y-auditor`.

---

## 1. Why this layer

Both v1 (this repo) and the v2 plan (#22) bundle three things together: the *driver* (Orca + Chromium + Xvfb plumbing), the *methodology* (WCAG reasoning, criteria taxonomy, confidence rubric), and the *orchestration* (target selection, multi-state recipes, report generation). Bundling them couples decisions that should be separable — v1 can't easily be used outside Claude Code, v2's spec re-implements the driver layer from scratch, and the work-codebase Cursor skill (the immediate consumer) can't use either because both assume their own methodology rather than composing with one already in place.

`agent-orca-driver` extracts the bottom layer cleanly. It ships in the same packaging shape as `agent-browser`: a CLI on PATH (`npm install -g agent-orca-driver`) plus a thin skills.sh skill stub (`npx skills add agent-orca-driver`) for host auto-discovery. The stub points the agent at `agent-orca-driver skills get core` at runtime to fetch the canonical API reference, which is bundled in the npm package as `AGENTS.md` — that same reference is what consumer-side orchestration skills inline into their own skill bodies. The CLI spawns Orca + a windowed Chromium on Xvfb and exposes an HTTP daemon any orchestration layer can drive. Live view as a real-time WebRTC video of the Xvfb framebuffer, served on the same HTTP port as the API, with synthetic focus-rectangle and transcript overlays layered on top.

**Nothing in the driver layer makes WCAG judgments, picks targets, or writes reports.** That's the orchestrator's job — and there can be many orchestrators in parallel: the work-codebase Cursor skill is the immediate one; v1 refactored to consume this package is another; v2's planned auditor (if revived) is a third. All three share the same HTTP API; the driver doesn't know or care which is calling.

---

## 2. Scope

### What `agent-orca-driver` is

- **A Node CLI on PATH** (`npm install -g agent-orca-driver`) that spawns Orca + a windowed Chromium on a virtual X display (Xvfb) and exposes a single HTTP daemon on a localhost port. *Headless from the operator's POV — no physical display required — but Chromium itself runs as a normal X11 windowed process, because Orca tracks focus via AT-SPI on a real window and the live-view WebRTC stream captures the Xvfb framebuffer to render.* Standalone use is first-class: an agent can drive it directly via `agent-orca-driver --help` without any skill wrapper.
- **A thin skills.sh skill stub** (`npx skills add agent-orca-driver`) for host auto-discovery. The stub is intentionally minimal — it points the agent at `agent-orca-driver skills get core` at runtime to fetch the canonical API reference, which is bundled in the npm package as `AGENTS.md`. This keeps the reference aligned with the installed CLI version (no stale cached docs in the host's skill directory).
- **An embeddable canonical reference** (`AGENTS.md` in the package) — the same content `skills get core` prints — that orchestration skills inline into their own skill bodies when composing the driver knowledge with their own methodology.
- A shared `setup.sh` that provisions everything Orca + the daemon need in a fresh Linux container with one command: apt packages (xvfb, dbus, at-spi2, pulseaudio, ffmpeg, orca) **plus Playwright's Chromium binary** (`npx playwright install --with-deps chromium` — the daemon launches Chromium via Playwright, so the browser binary has to land in setup, not at first `start`).
- The same HTTP API the existing `drivers/server.ts` in v1 already exposes — `/navigate`, `/next`, `/previous`, `/act`, `/perform`, `/press`, `/enter`, `/item-text`, `/transcript`, `/audit`, `/loading-state`, `/observe`, `/wait-for-selector`, `/commands`, `/stop`. Byte-identical. CLI commands support `--json` for agent consumption.
- A live-view URL on the *same* HTTP port as the API: a viewer page at `/live` that renders a WebRTC video of the Xvfb framebuffer plus a synthetic focus rectangle (AT-SPI bbox) and a live transcript panel (speech-dispatcher tap). The human watching sees Chromium + Orca + any OS-level overlay UI in real time, with the agent's reading position highlighted larger and more legibly than Orca's native indicator.

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
┌──────────────────────────────────────────────────────────────────┐
│  npx agent-orca-driver start <url> --port 8001                   │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐    │
│  │  Chromium    │  │  Orca SR     │  │  HTTP daemon         │    │
│  │  (windowed   │◀▶│  (AT-SPI +   │◀▶│  /next /act          │    │
│  │   on Xvfb,   │  │   xdotool +  │  │  /transcript ...     │    │
│  │   CDP on N)  │  │   speech-d)  │  │  /live  /events  WS  │    │
│  └──────────────┘  └──────────────┘  │  /webrtc/offer  SDP  │    │
│         │                  │         └──────────┬───────────┘    │
│         ▼                  ▼                    │                │
│       Xvfb :99 ──── ffmpeg x11grab ──── werift ─┘                │
│                  (VP8 over WebRTC; viewer at /live, one port)    │
└──────────────────────────────────────────────────────────────────┘
```

Three boundaries to respect:

1. **HTTP surface = stable contract.** Same routes regardless of underlying driver. A future `vo-driver` on macOS implements the same routes.
2. **No LLM dependency, no API key.** Pure Node + child processes. Runs offline.
3. **Setup is idempotent and one-command.** `npx agent-orca-driver setup` works in a fresh Codespace, fresh Docker container, or fresh GitHub-Actions runner.

---

## 4. CLI surface

The CLI is on PATH after `npm install -g agent-orca-driver`. Standalone invocation is first-class — agents can `agent-orca-driver --help` to discover it without any skill wrapper.

```
agent-orca-driver setup           # apt install + provision xvfb/dbus/at-spi2/pulseaudio/ffmpeg/chromium
agent-orca-driver start <url>     # spawn Chromium + Orca + daemon; print listening URL
                                  # options: --port 8001  --cdp-port 9222  --auth-token <tok>
agent-orca-driver stop            # tear down daemon + child processes
agent-orca-driver status          # is daemon up? what URL is loaded? on what ports?
agent-orca-driver doctor          # preflight: xvfb running? dbus? at-spi2? orca on PATH? chromium installed?
agent-orca-driver skills get core # print the canonical AGENTS.md reference (what the skill stub points at)
```

All commands support `--json` for agent consumption (parsed by orchestration skills; `setup`/`start`/`doctor`'s human-readable output becomes a structured object).

`setup` runs as the invoking user — the script `sudo`s internally for the apt step only, so Playwright's Chromium binary lands in that user's cache (`~/.cache/ms-playwright`). `start` is non-sudo and inherits the same cache. The whole script is idempotent. `doctor` exits non-zero with a one-line diagnosis if anything's missing.

After `start`, one URL prints (API + viewer are on the same port):
```
HTTP API:   http://localhost:8001
Live view:  http://localhost:8001/live
            (Codespaces auto-forwards the port — open in any browser tab)
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

## 6. Live view (WebRTC) — the new piece

The live view is a purpose-built viewer page at `/live` on the *same* HTTP port as the API. It renders three streams correlated by timestamp:

1. **Real-time video of the Xvfb framebuffer** — `ffmpeg -f x11grab` encoded as VP8 and bridged into a WebRTC PeerConnection by [`werift`](https://github.com/shinyoshiaki/werift-webrtc) (pure-Node WebRTC, no native deps). Renders into a `<video>` element in the viewer. ~30 fps, ~100 ms localhost latency.
2. **Synthetic focus rectangle** — an absolutely-positioned `<div>` over the video whose `top/left/width/height` track the latest AT-SPI focus-changed event. Bigger and more legible than Orca's native indicator; correlates the transcript to a specific element on screen.
3. **Live transcript panel** — sibling DOM element rendering speech-dispatcher lines (and optional agent action narration from orchestrators), color-coded by source, auto-scrolling, latest line highlighted.

Streams (2) and (3) ride a single WebSocket at `/events`:

| Event | Payload |
|---|---|
| `transcript` | `{t, source, text}` — every SR speech line, plus orchestrator-emitted action lines if it chooses to push them |
| `focus` | `{t, bbox: {x,y,w,h}, role, name}` — AT-SPI focus-changed event |
| `phase` | `{t, name}` — orchestrator has entered a phase (optional, no-op if not emitted) |

`setup.sh` provisions, `start` boots:

```bash
# scripts/setup.sh — install side. apt step runs via sudo internally;
# the Playwright install step is intentionally NOT under sudo so the
# Chromium binary lands in the invoking user's cache (~/.cache/ms-playwright),
# which is the same user that later runs `start`.
sudo apt-get install -y --no-install-recommends \
  orca xvfb xdotool at-spi2-core dbus-x11 libatk-adaptor \
  espeak-ng speech-dispatcher pulseaudio openbox \
  ffmpeg \
  libnss3 libnspr4
# ffmpeg encodes the Xvfb framebuffer for the WebRTC live view;
# libnss3/libnspr4 are Chromium runtime deps.
npx playwright install --with-deps chromium

# scripts/setup.sh — start-env:
# Nothing extra. The HTTP daemon spawns ffmpeg + werift on demand
# when the first viewer opens /live; tears them down when the last
# viewer disconnects. No persistent VNC server, no separate port.
```

On the wire, opening `/live` does:

1. Browser fetches `/live` (static HTML + JS bundled in the npm package).
2. Browser opens a `RTCPeerConnection`, POSTs an SDP offer to `/webrtc/offer`.
3. Daemon spawns `ffmpeg -f x11grab -i :99 -r 30 -c:v libvpx ...` piping VP8 RTP into a werift `MediaStreamTrack`, returns the SDP answer.
4. Browser opens a WebSocket to `/events` for transcript + focus events.
5. Viewer renders: `<video>` plays the WebRTC stream; overlay `<div>` follows focus events; transcript panel appends events.

The `/events` log is also persisted as JSONL alongside the run (under the same run-id directory the orchestrator uses for screenshots). Same viewer page can replay a past audit by pointing it at a recorded log instead of the live WebSocket — recording lands in v1.0; scrubber UI in v1.1.

**Why x11grab + WebRTC and not CDP screencast.** CDP captures only Chromium's compositor — it misses native popovers, native `<select>` chrome, the system cursor, Orca's own focus indicator (drawn by Orca onto the X display, not by Chrome), and anything else the X server paints. `x11grab` captures the framebuffer that all of these share, so the live view shows what a sighted dev would see if they sat next to a screen-reader user. WebRTC gives smooth ~30 fps at ~100 ms latency, which matters because the human's eye is correlating the video with the transcript and focus rectangle in real time. MJPEG would work but feels choppy at typical bandwidths; HLS adds multi-second segment buffering that kills the correlation.

**Why x11grab + WebRTC and not x11vnc + noVNC** (an earlier direction in this spec). VNC ships a generic remote-desktop UI we don't control — no way to layer a synthetic focus rectangle over the video, no way to put a transcript panel beside it, no way to correlate events to frames. With a viewer page we own, the overlays come for free and the layout is designed for the audit-watching use case instead of generic desktop access. It also collapses two forwarded ports (HTTP API + noVNC HTTP) into one.

**Why one port.** Viewer HTML (`GET /live`), SDP signaling (`POST /webrtc/offer`), event stream (`GET /events`, WebSocket-upgraded), and the existing API routes (`/navigate`, `/transcript`, etc.) are all served by the same Node HTTP daemon on `--port` (default 8001). The WebRTC media channel is UDP/SRTP, negotiated against a loopback ICE candidate, so it stays on the same host without a second listening TCP port. One forwarded port in Codespaces, one bound surface to secure.

**Library choice on the driver side.** [`werift`](https://github.com/shinyoshiaki/werift-webrtc) is the pure-Node WebRTC implementation we use. It ingests the ffmpeg RTP output and bridges it into the PeerConnection. The alternative — `wrtc` (Node bindings to libwebrtc) — is faster but adds a native build step that complicates the `npm install -g` story; we use werift to keep the install path as clean as `agent-browser`'s. If profiling shows werift is the bottleneck for a real audit, switching to `wrtc` is a v1.1 swap behind the same `/webrtc/offer` route.

**Security note.** All four surfaces (API, viewer, signaling, events WebSocket) bind to `127.0.0.1`. The WebRTC PeerConnection negotiates a loopback-only ICE candidate (no STUN/TURN configured), so the media stream itself stays on the loopback interface even though it's a UDP/SRTP transport. In Codespaces, the auto-port-forwarding mechanism bridges `127.0.0.1:<port>` to a GitHub-authenticated proxy URL; nothing is exposed to the public internet. Outside Codespaces, the operator must explicitly opt into network exposure by passing `--port 0.0.0.0:8001` — the CLI prints a warning if `--port` is non-loopback and `--auth-token` is unset, and refuses to start if `--port` is `0.0.0.0` with no auth token. When `--auth-token` is set:

- `/live`, `/webrtc/offer`, and the API routes require `Authorization: Bearer <tok>`. The viewer page reads the token from its query string on first load and reuses it for subsequent fetches.
- `/events` (WebSocket) takes the token as a query-string parameter (`/events?token=<tok>`) — the browser `WebSocket` constructor can't set arbitrary upgrade headers, so we accept the token in the URL and validate it on the upgrade handshake. The viewer constructs the WebSocket URL by reusing the same token it loaded itself with.

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
│   ├── setup.sh                    # apt + start-env + ffmpeg + playwright chromium
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
| `drivers/orca/setup.sh` | `scripts/setup.sh` | Extend install side with `ffmpeg` apt package **and `npx playwright install --with-deps chromium`** (v1 setup.sh omits Playwright provisioning — the driver currently relies on Playwright Chromium being preinstalled elsewhere). No extra start-env launchers — the WebRTC pipeline (ffmpeg + werift) starts on demand from the HTTP daemon when the first viewer opens `/live`. |
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
| 2 | `scripts/setup.sh`: apt install + xvfb/dbus/at-spi2 + `ffmpeg` + **Playwright Chromium binary** (`npx playwright install --with-deps chromium`). Add `werift` npm dep. `doctor` subcommand verifies all of the above, including that `ffmpeg -f x11grab -i :99 -frames:v 1 /dev/null` succeeds against the running Xvfb. | Fresh Codespace: `agent-orca-driver setup` then `agent-orca-driver doctor` exits 0; `agent-orca-driver start <fixture>` launches Chromium successfully without a separate `playwright install` step. |
| 3 | Build the `/live` viewer (static HTML + JS: `<video>` bound to the WebRTC stream, absolutely-positioned focus rectangle driven by `/events`, transcript panel). Wire `/webrtc/offer` (SDP exchange, werift PeerConnection backed by an ffmpeg x11grab pipe) and `/events` (WebSocket: transcript + focus). Smoke (manual): `start <fixture>`, walk 2 tab stops, verify transcript JSON. End-to-end Codespace run with the `/live` tab open. Add `--json` to CLI commands. | In a fresh Codespace, operator walks the smoke fixture end-to-end and sees Chromium + Orca in the `/live` tab with the focus rectangle tracking the SR caret and the transcript panel scrolling as Orca speaks. `agent-orca-driver status --json` returns parseable JSON. No CI gate — that's a v1.1 concern. |
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

The driver doesn't know or care which is calling. Its job is to make Orca + Chromium + Xvfb + AT-SPI work reliably in a no-physical-display Linux env (Chromium runs windowed on the virtual X display so Orca tracks focus via AT-SPI and ffmpeg/x11grab can capture the framebuffer for the live view) and expose a stable HTTP API. Any of the three consumers can ship, evolve, or be replaced independently without touching the driver.

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
6. **Auth gate when binding non-loopback.** No auth by default (Codespaces gates the forwarded port behind GitHub auth) vs require `--auth-token` to start? My lean: no auth by default, big printed warning if `--port` is non-loopback, and refuse to start if `--port` is `0.0.0.0` without `--auth-token` (handled in §6). When `--auth-token` is set, every endpoint requires `Authorization: Bearer <tok>`, including `/live`, `/webrtc/offer`, `/events`, and the API routes. Open sub-question: should the `/events` WebSocket also require a per-connection token rotation, or is the initial bearer-on-upgrade sufficient?
7. **werift vs wrtc for v1.0.** Ship werift (pure Node, clean install) or wrtc (native bindings, better perf)? My lean: ship werift in v1.0 since the audit live view doesn't need libwebrtc's perf headroom; revisit only if profiling shows werift is the bottleneck. Either way the same `/webrtc/offer` route holds; swap is invisible to the viewer.
7. **Smoke fixture content.** A canned static HTML in the repo, or fetch a public page (e.g., `example.com`) in the smoke test? My lean: bundled HTML — no network dependency in CI.

---

*End of plan. Next step: spin up the new repo, port the v1 drivers, ship slice 1.*
