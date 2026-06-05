# agent-orca-driver — Canonical Reference

This is the substantive agent-facing reference for `agent-orca-driver`. The
bin's `skills get core` subcommand prints this file. Orchestration-skill
authors are encouraged to inline excerpts of this into their own skill bodies
so the agent's loaded context stays self-contained.

## Mental model

`agent-orca-driver` is to Orca what `agent-browser` is to Chromium. The CLI
spawns Orca + a windowed Chromium on a virtual X display (Xvfb) and exposes a
single HTTP daemon on a localhost port. JSON in, JSON out, session-style. The
daemon owns Orca + Chromium + AT-SPI2 + speech capture; the calling agent
owns the reasoning.

The driver makes no WCAG judgments, picks no targets, writes no findings
reports, and ships no project context. Those are the orchestrator's job.

## Quickstart

```
# 1. Install on PATH and (optionally) register the skill stub:
npm install -g agent-orca-driver
npx skills add agent-orca-driver        # optional; for skills.sh hosts

# 2. Provision the Linux env (apt + Xvfb + AT-SPI2 + ffmpeg + Chromium):
agent-orca-driver setup

# 3. Verify everything is in place:
agent-orca-driver doctor

# 4. Start the daemon against a URL:
agent-orca-driver start https://example.com

# 5. Drive it over HTTP from another shell or your agent:
curl http://127.0.0.1:8001/
curl -X POST http://127.0.0.1:8001/next
curl 'http://127.0.0.1:8001/transcript?since=0'
```

## HTTP API

All routes bind to `127.0.0.1` by default. The `Host` header must read as
`127.0.0.1:<port>`, `localhost:<port>`, or a recognized Codespaces forwarded
URL (`<name>.app.github.dev`, `<name>.preview.app.github.dev`,
`<name>.githubpreview.dev`); any present `Origin` is checked against the same
allow-list.

Bodies are JSON unless noted (`Content-Type: application/json`). The driver
is single-session and serializes all screen-reader operations.

### Routes

| Method | Path | Body | Returns |
|---|---|---|---|
| GET    | `/`                | — | `StatusResponse` |
| POST   | `/navigate`        | `{ url: string }` | `VoResponse` |
| POST   | `/enter`           | — | `VoResponse` |
| POST   | `/next`            | — | `VoResponse` |
| POST   | `/previous`        | — | `VoResponse` |
| POST   | `/act`             | — | `VoResponse` |
| POST   | `/perform`         | `{ command: string }` (see `GET /commands`) | `VoResponse` |
| POST   | `/press`           | `{ key: string, modifiers?: string \| string[] }` | `VoResponse` |
| GET    | `/item-text`       | — | `VoResponse` |
| GET    | `/transcript?since=N` | — | `{ entries: TranscriptEntry[], length: number }` |
| DELETE | `/transcript`      | — | `{ cleared: number }` |
| POST   | `/audit`           | `AxeAuditOptions` (see below; all fields optional) | `AxeAuditResult` |
| GET    | `/loading-state`   | — | `LoadingState` |
| POST   | `/observe`         | `{ settleMs?: number }` | `{ started: true, settleMs: number }` |
| GET    | `/observe`         | — | `ObserverPoll` |
| DELETE | `/observe`         | — | `{ stopped: true }` |
| POST   | `/wait-for-selector` | `{ selector: string, state?: "visible" \| "hidden" \| "attached", timeout?: number }` | `{ ok: true, state: string }` |
| GET    | `/commands?filter=` | — | `{ commands: string[] }` |
| GET    | `/live`            | — | `text/html` viewer page |
| GET    | `/live-status`     | — | `{ running: boolean, viewers: number, display: string \| null }` |
| WS     | `/stream`          | (WebSocket upgrade — *not* a normal GET; plain HTTP returns 404) | binary fragmented-MP4 chunks |
| WS     | `/events`          | (WebSocket upgrade — plain HTTP returns 404) | JSON live events (see below) |
| POST   | `/stop`            | — | `{ success: true }`, then daemon exits |

### Response shapes

```ts
// GET / status. (Field name is `screenReaderActive` even though this is
// today an Orca-only driver, because a future agent-voiceover sibling will
// share the same HTTP surface on macOS.)
StatusResponse = {
  status: "running",
  screenReaderActive: boolean,
  currentUrl: string | null,
  cdpPort: number,
}

// Returned by every action route. `spoken` is whatever Orca actually
// announced for this action (deduplicated). `name`/`role`/`state` come from
// AT-SPI2 — `name` is the accessible name of the focused object (for a
// document root this is the page title; for a control it's the accessible
// name), `role` is the AT-SPI role, `state` is a filtered subset of AT-SPI
// states: focused, checked, expanded, collapsed, selected, required,
// visited, pressed, has-popup.
VoResponse = {
  spoken: string,
  name: string,
  role: string,
  state: string[],
  index?: number,    // present on transcript entries; see below
}

TranscriptEntry = VoResponse & { index: number }
// `index` is a monotonic, per-session counter starting at 1. To page
// incrementally, store the highest index you've seen and pass it as
// `since=<that-value>` next time — entries are returned where `index > since`.
// `since=0` returns the whole buffer.

AxeAuditOptions = {
  tags?: string[],         // axe rule tags, e.g. ["wcag2a","wcag2aa","wcag21aa"]
  includeTree?: boolean,   // default true; set false to omit the aria-snapshot
}

AxeAuditResult = {
  url: string,
  axe: {
    violations: AxeViolation[],
    incomplete: AxeViolation[],
    passes: number,        // count, not the full nodes
    inapplicable: number,
  },
  tree?: string,           // Playwright aria-snapshot of the page (text), if included
}

LoadingState = {
  busy: boolean,           // true if anything obviously async is in flight
  reasons: string[],       // e.g. ["aria-busy=true on <main>", "spinner labeled 'Loading'"]
}

ObserverPoll = {
  active: boolean,
  settled: boolean,
  mutationCount: number,
  msSinceLastMutation: number,
  elapsed: number,
  settleMs: number,
}
```

### `/events` WebSocket payloads

Each frame is one JSON object, tagged by `type`:

```ts
{ type: "transcript", t: number, source: "orca" | string, text: string }
{ type: "focus",      t: number, role: string, name: string, bbox?: { x, y, w, h } }
{ type: "phase",      t: number, name: string }    // emitted by orchestrators, if any
```

`t` is epoch ms. `bbox` is screen-coordinate (AT-SPI screen coords, which
match the Xvfb framebuffer the `/stream` video captures).

### `/stream` WebSocket

Binary frames. The first frames a viewer receives are the fragmented-MP4 init
segment (`ftyp` + `moov`), then live `moof`/`mdat` fragments. Late joiners
get the cached init segment replayed and are admitted at the next `moof`
boundary, so they're always decodable. The MIME to hand `MediaSource` is
`video/mp4; codecs="avc1.42E01E"` (h264 baseline, ~30 fps, 1280×1024).

### Example: walking a single tab stop

```
curl -X POST http://127.0.0.1:8001/next
# → {"spoken":"Main, navigation","name":"Main","role":"navigation","state":[],"index":1}

curl 'http://127.0.0.1:8001/transcript?since=0'
# → {"entries":[…],"length":1}

# Next call: ask for entries after the last index you saw, not since=length.
curl 'http://127.0.0.1:8001/transcript?since=1'
```

## Three canonical loops

### Loop 1 — Walk focus order

```
POST /navigate {url}    # or pass <url> to `start`
POST /enter             # focus into the web area
loop:
  POST /next            # advance one SR item
  GET  /item-text       # confirm what's announced
  → until /transcript shows the cycle restarting or you've covered every stop
```

### Loop 2 — Audit + announce

```
POST /navigate {url}
POST /audit             # axe-core violations + incomplete + aria-snapshot
POST /enter
loop POST /next + GET /transcript
→ cross-reference axe violations with what Orca actually announced
```

### Loop 3 — Drive through states

Use Playwright (via the same CDP port — exposed precisely so the agent can
drive Chromium *and* Orca against the same browser) to push the page through
its states. For each state:

```
DELETE /transcript      # zero the buffer
<trigger the state via Playwright>
POST /enter             # rebase Orca's focus
loop POST /next + GET /transcript
```

## Live view

Open `http://localhost:8001/live` in a browser to watch Chromium + Orca in
real time: a video of the X framebuffer (h264/fMP4 over the `/stream`
WebSocket, played via Media Source Extensions), a focus rectangle that tracks
the screen-reader caret (AT-SPI bounding box), and a live transcript panel.
The video encoder (ffmpeg) only runs while at least one viewer is connected.
In Codespaces the port is auto-forwarded — open the forwarded URL. The same
`/events` WebSocket can be consumed directly (JSON) if an orchestrator wants
the transcript/focus stream without the HTML viewer.

## Notes for fresh consumers

- `/perform`'s `command` must be a name from `GET /commands` (or one of the
  catalog names called out in the route table). Raw keypresses (Tab, letter
  keys, arbitrary combinations) go through `/press` instead.
- `/press`'s `modifiers` accepts either a single string (`"shift"`) or an
  array (`["shift", "ctrl"]`); valid values are `shift`, `ctrl`, `alt`,
  `super`.
- `/wait-for-selector`'s `selector` is a standard CSS selector evaluated
  against the page DOM. Use `state: "visible"` (default) or `"hidden"` to
  wait for visibility transitions, `"attached"` to wait for presence.
- `/audit`'s response counts `passes` and `inapplicable` (not the full node
  lists, to keep payloads tractable); `violations` and `incomplete` carry
  full axe records.
- `since`-paging the transcript: store the **highest `index` you've seen**
  and pass it as `since=`. Don't use the array length — `index` is a global
  counter that survives `DELETE /transcript`.
- `SAY_ALL` (and most `/perform` commands) returns *immediately* with the
  current AT-SPI focus state — it dispatches the Orca command, it doesn't
  block until Orca finishes speaking. Poll `/transcript` to follow what
  Orca says.
- The `/stream` and `/events` paths are **WebSocket-only** endpoints. A
  plain `GET` returns 404 with `{"error":"Unknown route: GET /stream"}` —
  that's expected; it's not a missing endpoint.

## What agent-orca-driver is NOT

- Not a WCAG knowledge base. Doesn't ship `criteria.json`, `categories.json`,
  a confidence rubric, or any methodology. The orchestration skill above
  carries the WCAG reasoning.
- Not an LLM-orchestrated auditor. No Agent SDK call inside the CLI, no API
  key. The agent driving it brings its own intelligence.
- Not a decision-log / VPAT / ACR generator. Output schema is the HTTP
  responses themselves.
- Not a `states.yml` runner. Use Playwright via the shared CDP port.
- Not a macOS tool. Linux/Orca only. A future `agent-voiceover` sibling can
  implement the same HTTP API surface on macOS.

## For orchestration-skill authors

If you're building an orchestration skill on top of this driver, copy the
route table and the loop(s) you care about into your own skill body. That
keeps the agent's loaded context self-contained — your skill works whether
or not `agent-orca-driver`'s SKILL.md stub is also loaded in the host.

The driver bin only needs to be on PATH. Your skill drives it via HTTP (or
shells out to `agent-orca-driver` directly with `--json`).
