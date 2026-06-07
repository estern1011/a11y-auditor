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

All routes bind to `127.0.0.1` by default. Host + Origin allow-list applies:
the request `Host` header must read as `127.0.0.1:<port>` or
`localhost:<port>`, and any present `Origin` must match the same.

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Status (daemon up, current URL, CDP port) |
| POST | `/navigate` | `{url}` — load URL, focus into page |
| POST | `/enter` | Focus into web area (after load) |
| POST | `/next` / `/previous` | Move SR focus one item |
| POST | `/act` | Activate the focused item |
| POST | `/perform` | `{command}` — named SR action (`FIND_NEXT_HEADING`, `FIND_NEXT_LANDMARK`, `READ_CURRENT_LINE`, `SAY_ALL`, `FIND_NEXT_BUTTON`, …). See `GET /commands`. |
| POST | `/press` | `{key, modifiers?}` — raw keypress (Tab, arbitrary letters) |
| GET | `/item-text` | Read text/role/state of current SR focus |
| GET | `/transcript?since=N` | SR announcement log (incremental) |
| DELETE | `/transcript` | Clear transcript buffer |
| POST | `/audit` | Run axe-core against current page |
| GET | `/loading-state` | Targeted SC 4.1.3 check (aria-busy, aria-live, role=status, spinner labels) |
| POST/GET/DELETE | `/observe` | Start/poll/stop a DOM mutation observer |
| POST | `/wait-for-selector` | `{selector, state?, timeout?}` |
| GET | `/commands?filter=` | Catalog of `/perform` command names |
| GET | `/live` | Live-view HTML page (video + focus rect + transcript) |
| GET | `/live-status` | JSON: is the video encoder running, how many viewers |
| WS | `/stream` | Binary h264/fMP4 chunks of the Xvfb framebuffer (for MSE) |
| WS | `/events` | JSON live events: `transcript`, `focus` (with AT-SPI bbox), `phase` |
| POST | `/stop` | Graceful shutdown |

### Example: walking a single tab stop

```
curl -X POST http://127.0.0.1:8001/next
# → {"spoken":"Main, navigation","name":"Main","role":"navigation","state":[],"index":0}

curl 'http://127.0.0.1:8001/transcript?since=0'
# → {"entries":[…],"length":1}
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
