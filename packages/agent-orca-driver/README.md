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

## Status

`0.1.0-dev` — Day-1 slice of the [agent-orca-driver
plan](https://github.com/estern1011/a11y-auditor/pull/24). What's wired up:

- Node port of the v1 (`estern1011/a11y-auditor`) HTTP daemon, Orca core,
  AT-SPI2 client, Chromium lifecycle, and axe-core injection
- CLI: `start`, `stop`, `status`, `doctor` (preflight), `skills get core`
- `SKILL.md` + `AGENTS.md` + `README.md`

What's coming in the next slice (Day 2):
- `scripts/setup.sh` provisioner (apt + ffmpeg + Playwright Chromium) and a
  fuller `doctor` that verifies Xvfb is running, ffmpeg supports libx264,
  the Playwright Chromium binary is installed, etc.

License: MIT.
