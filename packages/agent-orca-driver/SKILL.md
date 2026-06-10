---
name: agent-orca-driver
description: |
  Drive Orca (the Linux screen reader) + Chromium on a virtual display via an
  HTTP daemon. Use when an agent needs to walk a page as a screen-reader user
  would, capture transcripts, or pair axe-core findings with what Orca
  actually announces.
triggers:
  - "orca"
  - "linux screen reader"
  - "agent-orca-driver"
  - "screen reader on linux"
bundled_commands:
  - agent-orca-driver setup
  - agent-orca-driver start
  - agent-orca-driver stop
  - agent-orca-driver status
  - agent-orca-driver doctor
  - agent-orca-driver skills get core
---

# agent-orca-driver

`agent-orca-driver` is to Orca what `agent-browser` is to Chromium: an HTTP
daemon on `localhost:8001` that owns Orca + Chromium + Xvfb + AT-SPI2 and
exposes a stable JSON API. JSON in, JSON out, session-style. The daemon
owns the screen-reader plumbing; the calling agent owns the reasoning.

## Full reference

This SKILL.md is intentionally minimal so it doesn't drift from the installed
CLI. For the canonical API reference, three canonical loops, anti-instructions,
and inlining notes for orchestration-skill authors, run:

```
agent-orca-driver skills get core
```

That prints the bundled `AGENTS.md` from the package version currently
installed on PATH — always aligned, never stale.

## Quickstart

```
npm install -g agent-orca-driver
agent-orca-driver setup
agent-orca-driver start https://example.com
# in another shell:
curl http://127.0.0.1:8001/
```

For everything else: `agent-orca-driver skills get core`.
