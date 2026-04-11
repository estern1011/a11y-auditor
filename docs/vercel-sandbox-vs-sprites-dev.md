# Vercel Sandbox vs Sprites.dev as Cloud Environments for a11y-auditor

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

| | Vercel Sandbox | Sprites.dev |
|---|---|---|
| Provider | Vercel | Fly.io |
| OS | Amazon Linux 2023 (Firecracker microVM) | Linux (Firecracker microVM) |
| Runtimes | Node 22/24, Python 3.13 (Bun installable via curl) | Full Linux — install anything (apt, curl, bun, etc.) |
| CPU / RAM | Up to 8 vCPU, 2 GB per vCPU (16 GB max) | Up to 8 CPU, 16 GB RAM |
| Disk | Ephemeral by default; snapshots in beta | 100 GB persistent, NVMe-cached, survives sleep |
| Max session | 45 min (Hobby) / 5 hr (Pro/Enterprise) | Unlimited — sleeps after 30s idle, wakes on demand |
| Persistence | Ephemeral; persistent sandboxes in beta | Native — full filesystem state persists between runs |
| Chromium / Playwright | Yes — agent-browser + Chrome run natively | Yes — install Playwright + Chromium normally |
| CDP support | Yes — agent-browser uses CDP directly | Yes — standard CDP, you control the ports |
| Orca / screen reader | Possible but difficult — Amazon Linux, ephemeral, DBus setup each boot | Strong fit — full Linux VM, persistent, DBus + AT-SPI stay configured |
| Networking | Each sandbox gets a URL; outbound access | Each Sprite gets a unique URL; outbound access |
| Startup time | Seconds (microVM boot) | 1–12 seconds; checkpoint restore ~300ms |
| Pricing | Active CPU billing (pay only when executing) | $0.07/CPU-hr + $0.04375/GB-hr; free when sleeping |
| Checkpoints | Snapshots (beta) | Checkpoints (~300ms), rollback to any point |
| SDK / API | @vercel/sandbox TypeScript SDK | REST API + CLI |

## Verdict

**Sprites.dev is the better fit** for running a11y-auditor in the cloud.

### Why Sprites wins

1. **Orca persistence** — Orca's dependency stack is heavy: DBus, AT-SPI2, speech-dispatcher, GNOME/GTK libs. On Sprites, you install once and it persists across sleep/wake cycles. On Vercel, you'd reinstall or restore from a snapshot every session (and snapshot persistence is still in beta).

2. **DBus session bus** — Orca requires a running DBus session bus for AT-SPI communication. In a full Sprites VM, you control init and can ensure DBus starts reliably. Vercel's Amazon Linux microVMs are more constrained — getting a stable DBus session bus in an ephemeral sandbox is fragile.

3. **Session length** — Full WCAG audits take 1–2 hours. Vercel caps at 45 min on Hobby; you need Pro ($20/mo) for the 5-hour limit. Sprites have no timeout — they sleep when idle and wake when needed.

4. **Checkpoints for known-good Orca state** — Once Orca + AT-SPI + Chromium are all configured and talking to each other, you can checkpoint that state on Sprites (~300ms). Rolling back to a clean, working Orca environment between audits is trivial. Vercel snapshots are similar in concept but still beta.

5. **Full Linux flexibility** — Sprites give you a full VM where you can install Bun, manage Chromium system deps (libgbm, libnss3), configure AT-SPI, and run Orca without fighting Amazon Linux package availability.

### Where Vercel wins

- **agent-browser integration** — agent-browser is a Vercel Labs project, so the Vercel Sandbox skill works out of the box with zero setup.
- **Short automated scans** — If you only need axe-core checks that complete in minutes, Vercel's ephemeral model is simpler. Spin up, run `audit.ts`, tear down.
- **Snapshot-and-restore** — Good for reproducible CI-style a11y checks where you snapshot a known-good environment and restore it per run.

## Orca on Linux: what makes cloud audits possible

With an `orca-driver` backend replacing `vo-driver`, both platforms become capable of full screen-reader audits. Here's what Orca needs and how each platform handles it:

| Orca requirement | Sprites.dev | Vercel Sandbox |
|---|---|---|
| **DBus session bus** | Full VM — start dbus-daemon normally, persists across sleep/wake | Must configure per session; ephemeral by default |
| **AT-SPI2 (at-spi2-core)** | `apt install` once, persists | `dnf install` each boot, or snapshot |
| **speech-dispatcher** | Install once; for automation, capture text output instead of audio | Same install story; audio output not needed |
| **GNOME/GTK libs** | ~200-400 MB of deps; install once, checkpoint | Same size; reinstall or snapshot-restore each time |
| **Headless display** | Xvfb or similar; configure once | Xvfb; configure each session |
| **Orca process management** | `orca --replace` to start; survives checkpoint/restore | Must start fresh each session |

### Key risk: AT-SPI ↔ Chromium bridge

The critical integration point is whether Chromium exposes its accessibility tree via AT-SPI2 so Orca can read it. Chromium supports this on Linux when launched with `--force-renderer-accessibility` or when AT-SPI is detected. In a cloud VM without a real display, you'll likely need:

```bash
export DISPLAY=:99           # Xvfb
export GTK_MODULES=gail:atk-bridge
export ACCESSIBILITY_ENABLED=1
chromium --force-renderer-accessibility
```

This is more straightforward to get working (and keep working) on Sprites where you control the full boot sequence and state persists.

### What works on both platforms without Orca

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
