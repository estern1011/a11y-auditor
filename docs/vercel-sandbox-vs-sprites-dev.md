# Vercel Sandbox vs Sprites.dev as Cloud Environments for a11y-auditor

## What a11y-auditor needs from a cloud environment

| Requirement | Details |
|---|---|
| Runtime | Bun >= 1.0 (or Node >= 18) |
| Browser | Chromium via Playwright, with CDP on port 9222 |
| axe-core | `@axe-core/playwright` — runs inside the browser |
| agent-browser | Connects over CDP for screenshots and page interaction |
| VoiceOver | macOS only — neither platform can provide this |
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
| Networking | Each sandbox gets a URL; outbound access | Each Sprite gets a unique URL; outbound access |
| Startup time | Seconds (microVM boot) | 1–12 seconds; checkpoint restore ~300ms |
| Pricing | Active CPU billing (pay only when executing) | $0.07/CPU-hr + $0.04375/GB-hr; free when sleeping |
| Checkpoints | Snapshots (beta) | Checkpoints (~300ms), rollback to any point |
| SDK / API | @vercel/sandbox TypeScript SDK | REST API + CLI |

## Verdict

**Sprites.dev is the better fit** for running a11y-auditor in the cloud.

### Why Sprites wins

1. **Session length** — Full WCAG audits take 1–2 hours. Vercel caps at 45 min on Hobby; you need Pro ($20/mo) for the 5-hour limit. Sprites have no timeout — they sleep when idle and wake when needed.

2. **Persistence** — Auditing multiple pages across sessions is common. With Sprites, Chromium, Playwright, and Bun stay installed across runs. No reinstalling deps each time. Vercel's persistence is still in beta.

3. **Full Linux flexibility** — Sprites give you a full VM. You can install Bun directly, manage Chromium system dependencies (libgbm, libnss3, etc.) without Amazon Linux package quirks, and configure the environment however you need.

4. **Cost** — A 4-hour audit session on Sprites costs ~$0.44. On Vercel Pro, the same session costs more given active CPU billing, and you need the Pro plan to even reach that session length.

### Where Vercel wins

- **agent-browser integration** — agent-browser is a Vercel Labs project, so the Vercel Sandbox skill works out of the box with zero setup.
- **Short automated scans** — If you only need axe-core checks that complete in minutes, Vercel's ephemeral model is simpler. Spin up, run `audit.ts`, tear down.
- **Snapshot-and-restore** — Good for reproducible CI-style a11y checks where you snapshot a known-good environment and restore it per run.

## The VoiceOver limitation

Neither platform solves the biggest constraint: **VoiceOver requires macOS**. The `@guidepup/guidepup` dependency controls VoiceOver via AppleScript, which doesn't exist on Linux.

On either cloud environment, you can run:
- `audit.ts` (axe-core automated checks) — works
- `agent-browser` (screenshots, DOM snapshots, interaction) — works
- `vo-driver` (VoiceOver screen reader testing) — **does not work**

For full audits including screen reader verification, you still need a macOS host (local machine, GitHub Actions macOS runners, or MacStadium).

## Sources

- [Vercel Sandbox docs](https://vercel.com/docs/vercel-sandbox)
- [Vercel Sandbox concepts](https://vercel.com/docs/vercel-sandbox/concepts)
- [Sprites.dev](https://sprites.dev/)
- [Sprites.dev quickstart](https://docs.sprites.dev/quickstart/)
- [Simon Willison on Sprites.dev](https://simonwillison.net/2026/Jan/9/sprites-dev/)
- [E2B vs Sprites.dev comparison](https://northflank.com/blog/e2b-vs-sprites-dev)
- [Best sandbox runners 2026](https://betterstack.com/community/comparisons/best-sandbox-runners/)
- [agent-browser GitHub](https://github.com/vercel-labs/agent-browser)
- [Vercel Sandbox persistent sandboxes beta](https://vercel.com/changelog/vercel-sandbox-persistent-sandboxes-beta)
- [AI agent sandboxes compared](https://rywalker.com/research/ai-agent-sandboxes)
