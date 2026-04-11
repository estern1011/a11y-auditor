# Cloud Environments for a11y-auditor: Vercel Sandbox vs Sprites.dev vs GitHub Codespaces

## What a11y-auditor needs from a cloud environment

| Requirement | Details |
|---|---|
| Runtime | Bun >= 1.0 (or Node >= 18) |
| Browser | Chromium via Playwright, with CDP on port 9222 |
| axe-core | `@axe-core/playwright` — runs inside the browser |
| agent-browser | Connects over CDP for screenshots and page interaction |
| Screen reader | Orca on Linux (replacing VoiceOver/macOS dependency) |
| Orca dependencies | DBus session bus, AT-SPI2 (at-spi2-core, at-spi2-atk), speech-dispatcher, GNOME/GTK libs |
| Session length | Full WCAG audits take 1–2 hours per page |

## Platform comparison

| | Vercel Sandbox | Sprites.dev | GitHub Codespaces |
|---|---|---|---|
| Provider | Vercel | Fly.io | GitHub |
| OS | Amazon Linux 2023 (Firecracker microVM) | Linux (Firecracker microVM) | Ubuntu (Docker container on VM) |
| Runtimes | Node 22/24, Python 3.13 (Bun installable via curl) | Full Linux — install anything (apt, curl, bun, etc.) | Full Ubuntu — apt, curl, bun, anything; devcontainer pre-configures |
| CPU / RAM | Up to 8 vCPU, 2 GB/vCPU (16 GB max) | Up to 8 CPU, 16 GB RAM | 2–32 cores, 4–128 GB RAM (select at launch) |
| Disk | Ephemeral by default; snapshots in beta | 100 GB persistent, NVMe-cached, survives sleep | 32–128 GB persistent across sessions |
| Max session | 45 min (Hobby) / 5 hr (Pro/Enterprise) | Unlimited — sleeps after 30s idle, wakes on demand | Configurable idle timeout (default 30 min); VM persists until deleted (default 30-day retention) |
| Persistence | Ephemeral; persistent sandboxes in beta | Native — full filesystem state persists between runs | Native — full filesystem persists; devcontainer rebuilds are opt-in |
| Chromium / Playwright | Yes — agent-browser + Chrome run natively | Yes — install Playwright + Chromium normally | Yes — `mcr.microsoft.com/playwright` base image or `postCreateCommand` install |
| CDP support | Yes — agent-browser uses CDP directly | Yes — standard CDP, you control the ports | Yes — full control, port forwarding built in |
| Orca / screen reader | Difficult — Amazon Linux, ephemeral, DBus setup each boot | Strong — full Linux VM, persistent, DBus + AT-SPI stay configured | Strong — Ubuntu/Debian, persistent, `desktop-lite` feature provides Xvfb + Fluxbox; DBus/AT-SPI installable via devcontainer |
| Networking | Each sandbox gets a URL; outbound access | Each Sprite gets a unique URL; outbound access | Port forwarding (public/private); outbound access |
| Startup time | Seconds (microVM boot) | 1–12 seconds; checkpoint restore ~300ms | 30–90 seconds (container build); faster on prebuilds |
| Pricing | Active CPU billing (pay only when executing) | $0.07/CPU-hr + $0.04375/GB-hr; free when sleeping | $0.18–$2.88/hr (compute) + storage; Pro gets 180 core-hours/mo free |
| Checkpoints | Snapshots (beta) | Checkpoints (~300ms), rollback to any point | No VM-level checkpoints; git-based state management |
| SDK / API | @vercel/sandbox TypeScript SDK | REST API + CLI | gh CLI, REST API, devcontainer.json config |
| Dev experience | Programmatic SDK; no built-in editor | CLI + REST; no built-in editor | VS Code (browser + desktop), JetBrains, Claude Code — full IDE |

## Verdict

**GitHub Codespaces is the best fit** for interactive auditing with Claude Code. **Sprites.dev** is the best fit for programmatic/API-driven audits.

### Why Codespaces wins for interactive use

1. **devcontainer.json = reproducible Orca stack** — Define Orca, AT-SPI2, DBus, Xvfb, Playwright, Bun, and Chromium in a single `devcontainer.json`. Every collaborator gets the same environment. The `desktop-lite` feature gives you Xvfb + Fluxbox + noVNC out of the box — a foundation for Orca's display requirements.

2. **Persistence without extra effort** — The filesystem persists across sessions natively. Install Orca deps once via `postCreateCommand`, and they survive idle timeouts. No beta features, no snapshots to manage.

3. **IDE + Claude Code integration** — Run Claude Code directly in the Codespace terminal (VS Code browser or desktop). The auditor can drive Orca, run axe-core, and take screenshots all within the same environment. Port forwarding lets you view noVNC or forward CDP.

4. **Ubuntu/Debian base** — Orca's natural home. `apt install orca at-spi2-core speech-dispatcher` works cleanly. No Amazon Linux package gaps.

5. **Generous free tier** — Pro accounts get 180 core-hours/month free. A 4-core Codespace running a 2-hour audit costs ~8 core-hours — you get ~22 full audits/month at no cost.

6. **Prebuilds** — GitHub can prebuild your devcontainer image so Codespace startup skips the Orca/Chromium install entirely. Launch to a ready-to-audit environment in under a minute.

### Why Sprites wins for programmatic/API use

1. **Checkpoints** — Snapshot a working Orca + Chromium + AT-SPI state in ~300ms. Restore to a clean audit environment instantly. Better than Codespaces for automated pipelines that spin up, audit, tear down.

2. **No idle timeout concerns** — Sprites sleep when idle and wake on demand with no 30-day deletion. For a long-running audit service that needs to be available on-demand, this model is simpler.

3. **REST API first** — If you're building an audit-as-a-service product that creates environments programmatically, Sprites' API is purpose-built for that. Codespaces' API exists but is designed for developer workflows, not ephemeral compute.

4. **Cost at scale** — $0.07/CPU-hr with no compute charges when sleeping. For a fleet of audit environments that run intermittently, this is cheaper than Codespaces.

### Where Vercel wins

- **agent-browser integration** — agent-browser is a Vercel Labs project, so the Vercel Sandbox skill works out of the box with zero setup.
- **Short automated scans** — If you only need axe-core checks that complete in minutes, Vercel's ephemeral model is simpler. Spin up, run `audit.ts`, tear down.
- **Snapshot-and-restore** — Good for reproducible CI-style a11y checks where you snapshot a known-good environment and restore it per run.
- **Not a good fit for Orca** — Amazon Linux + ephemeral + DBus bootstrapping makes full screen-reader audits fragile.

## Orca on Linux: what makes cloud audits possible

With an `orca-driver` backend replacing `vo-driver`, all three platforms become capable of full screen-reader audits. Here's what Orca needs and how each platform handles it:

| Orca requirement | Sprites.dev | GitHub Codespaces | Vercel Sandbox |
|---|---|---|---|
| **DBus session bus** | Full VM — start dbus-daemon normally, persists across sleep/wake | `desktop-lite` starts dbus; persists across sessions | Must configure per session; ephemeral by default |
| **AT-SPI2 (at-spi2-core)** | `apt install` once, persists | `apt install` in devcontainer `postCreateCommand`; persists | `dnf install` each boot, or snapshot |
| **speech-dispatcher** | Install once; capture text output, no audio needed | Same; install in devcontainer | Same install story |
| **GNOME/GTK libs** | ~200-400 MB; install once, checkpoint | ~200-400 MB; install once in devcontainer, prebuild for fast startup | Same size; reinstall or snapshot-restore each time |
| **Headless display** | Xvfb or similar; configure once | `desktop-lite` feature provides Xvfb + Fluxbox + noVNC | Xvfb; configure each session |
| **Orca process management** | `orca --replace` to start; survives checkpoint/restore | `orca --replace` in postStartCommand; survives idle timeout | Must start fresh each session |

### Key risk: AT-SPI ↔ Chromium bridge

The critical integration point is whether Chromium exposes its accessibility tree via AT-SPI2 so Orca can read it. Chromium supports this on Linux when launched with `--force-renderer-accessibility` or when AT-SPI is detected. In a cloud VM without a real display, you'll likely need:

```bash
export DISPLAY=:99           # Xvfb
export GTK_MODULES=gail:atk-bridge
export ACCESSIBILITY_ENABLED=1
chromium --force-renderer-accessibility
```

This is more straightforward to get working (and keep working) on Sprites where you control the full boot sequence and state persists.

### Codespaces devcontainer sketch

A starting point for a Codespaces environment with Orca + Playwright:

```jsonc
// .devcontainer/devcontainer.json
{
  "name": "a11y-auditor",
  "image": "mcr.microsoft.com/devcontainers/typescript-node:22-bookworm",
  "features": {
    "ghcr.io/devcontainers/features/desktop-lite:1": {
      "password": "a11y",
      "webPort": "6080",
      "vncPort": "5901"
    }
  },
  "postCreateCommand": "bash .devcontainer/setup.sh",
  "postStartCommand": "Xvfb :99 -screen 0 1280x1024x24 & export DISPLAY=:99 && dbus-daemon --session --address=unix:path=/tmp/dbus-session --fork",
  "forwardPorts": [6080, 5901, 9222],
  "remoteEnv": {
    "DISPLAY": ":99",
    "ACCESSIBILITY_ENABLED": "1",
    "GTK_MODULES": "gail:atk-bridge"
  }
}
```

```bash
# .devcontainer/setup.sh
#!/bin/bash
set -e

# Orca + accessibility stack
sudo apt-get update
sudo apt-get install -y orca at-spi2-core at-spi2-atk speech-dispatcher \
  libatk1.0-0 libatk-bridge2.0-0 libgbm1 libnss3 libxss1 xvfb

# Bun
curl -fsSL https://bun.sh/install | bash

# Playwright + Chromium
bun install
bunx playwright install --with-deps chromium
```

### What works on all platforms without Orca

- `audit.ts` (axe-core automated checks) — works everywhere
- `agent-browser` (screenshots, DOM snapshots, interaction) — works everywhere

## Sources

- [Vercel Sandbox docs](https://vercel.com/docs/vercel-sandbox)
- [Vercel Sandbox concepts](https://vercel.com/docs/vercel-sandbox/concepts)
- [Vercel Sandbox persistent sandboxes beta](https://vercel.com/changelog/vercel-sandbox-persistent-sandboxes-beta)
- [Sprites.dev](https://sprites.dev/)
- [Sprites.dev quickstart](https://docs.sprites.dev/quickstart/)
- [Simon Willison on Sprites.dev](https://simonwillison.net/2026/Jan/9/sprites-dev/)
- [E2B vs Sprites.dev comparison](https://northflank.com/blog/e2b-vs-sprites-dev)
- [Best sandbox runners 2026](https://betterstack.com/community/comparisons/best-sandbox-runners/)
- [AI agent sandboxes compared](https://rywalker.com/research/ai-agent-sandboxes)
- [agent-browser GitHub](https://github.com/vercel-labs/agent-browser)
- [Orca screen reader](https://orca.gnome.org/)
- [GNOME Orca source / AT-SPI architecture](https://github.com/GNOME/orca)
- [Debian Orca/AT-SPI setup](https://wiki.debian.org/Accessibility/Orca)
- [KDE AT-SPI / screen reader setup guide](https://techbase.kde.org/Development/Tutorials/Accessibility/Screen_Reader_Setup)
- [GitHub Codespaces overview](https://github.com/features/codespaces)
- [GitHub Codespaces billing](https://docs.github.com/billing/managing-billing-for-github-codespaces/about-billing-for-github-codespaces)
- [devcontainer desktop-lite feature](https://github.com/devcontainers/features/tree/main/src/desktop-lite)
- [Playwright in Codespaces](https://nikolay-dev.medium.com/how-to-run-playwright-tests-in-github-codespaces-5ac5dcd1babd)
- [devcontainer-desktop-lite-mcp-playwright example](https://github.com/capi/devcontainer-desktop-lite-mcp-playwright)
