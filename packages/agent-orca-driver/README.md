# agent-orca-driver

> Composable Orca + Chromium + Xvfb driver. HTTP daemon any orchestration layer can drive.

`agent-orca-driver` spawns Orca (the Linux screen reader) and a windowed
Chromium on a virtual X display, then exposes a stable HTTP API any agent
(or human) can call. JSON in, JSON out, session-style. The daemon owns the
screen-reader plumbing; the calling layer owns the methodology.

Linux only — Orca only. A future `agent-voiceover` sibling can offer the same
HTTP API surface on macOS.

## Install

```sh
# Step 1 — put the bin on PATH:
npm install -g agent-orca-driver

# Step 2 (optional) — register the skill stub for skills.sh-aware hosts:
npx skills add agent-orca-driver
```

Standalone use works without step 2; the bin is callable by name and
`agent-orca-driver --help` is the discovery surface.

## Quickstart

```sh
agent-orca-driver setup            # apt + Xvfb + AT-SPI2 + ffmpeg + Chromium
agent-orca-driver doctor           # preflight check
agent-orca-driver start https://example.com
# in another shell:
curl http://127.0.0.1:8001/
```

## CLI

```
agent-orca-driver setup            Install OS deps + Playwright Chromium
agent-orca-driver start <url>      Spawn Chromium + Orca + daemon, load <url>
agent-orca-driver stop             Tear down the running daemon
agent-orca-driver status           Print daemon status (pid, ports, URL)
agent-orca-driver doctor           Preflight: Xvfb, dbus, at-spi2, orca, ffmpeg
agent-orca-driver skills get core  Print the canonical AGENTS.md reference
```

All commands accept `--json` for agent-friendly structured output.

```
--port <n>      HTTP daemon port (default: 8001)
--cdp-port <n>  Chromium CDP port (default: 9223)
```

## Documentation

- [`SKILL.md`](./SKILL.md) — thin discovery stub for skills.sh-aware hosts
- [`AGENTS.md`](./AGENTS.md) — canonical agent-facing API reference (route
  table, three canonical loops, anti-instructions). `agent-orca-driver skills
  get core` prints this verbatim from the installed package.
- [`SECURITY.md`](./SECURITY.md) — network surface, allow-list rules, and
  the analysis of why `npm audit`'s `dbus-native` advisories don't apply in
  this package's usage.

## Live view

Once the daemon is running, open `http://localhost:8001/live` in a browser
(in Codespaces, the forwarded URL) to watch Chromium + Orca in real time:

- a video of the X framebuffer (h264/fMP4 over the `/stream` WebSocket,
  played via Media Source Extensions),
- a focus rectangle tracking the screen-reader caret (AT-SPI bounding box),
- a live, auto-scrolling transcript panel (`/events` WebSocket).

The video encoder (ffmpeg) runs only while a viewer is connected.

## Status

`0.1.0-dev` — Days 1–3 of the [agent-orca-driver
plan](https://github.com/estern1011/a11y-auditor/pull/24). What's wired up:

- Node port of the v1 (`estern1011/a11y-auditor`) HTTP daemon, Orca core,
  AT-SPI2 client, Chromium lifecycle, and axe-core injection
- CLI: `setup`, `start`, `stop`, `status`, `doctor`, `skills get core`
- `scripts/setup.sh` — one-command provisioner (apt packages + ffmpeg +
  Playwright Chromium; apt via sudo, browser binary into the user's cache)
- `doctor` — verifies required binaries, that ffmpeg advertises libx264, and
  that Playwright Chromium actually launches; informational DISPLAY / D-Bus /
  x11grab checks
- **Live view** — `/live` viewer page, `/stream` (h264/fMP4 over WebSocket),
  `/events` (transcript + AT-SPI focus bbox), all on the same HTTP port
- `SKILL.md` + `AGENTS.md` + `README.md`

License: MIT.
