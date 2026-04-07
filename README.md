# a11y-auditor

WCAG 2.2 AA accessibility auditing for Claude Code. Combines a real VoiceOver screen reader, axe-core automated checks, and browser interaction into a single audit workflow.

```
┌──────────────────────────────────────────────────────┐
│                 Auditor skill (Claude)                │
│                                                      │
│  "You are an accessibility auditor with three tools" │
└───────┬──────────────────┬──────────────────┬────────┘
        │                  │                  │
  ┌─────▼─────┐    ┌──────▼──────┐    ┌──────▼──────┐
  │ vo-driver  │    │  audit.ts   │    │agent-browser│
  │            │    │             │    │             │
  │ Screen     │    │ Automated   │    │ Page        │
  │ reader     │    │ checks      │    │ interaction │
  │            │    │ (axe-core)  │    │ (click,     │
  │ VoiceOver  │    │             │    │  screenshot │
  │ + browser  │    │ Connects    │    │  snapshot)  │
  │            │    │ via HTTP    │    │             │
  │ CDP :9222  │◄───┤             │    │ Connects    │
  │            │◄───┴─────────────┘    │ via CDP     │
  └────────────┘                       └─────────────┘
```

**vo-driver** owns the headed browser + VoiceOver, exposes CDP so other tools share the same session. **audit.ts** runs axe-core and returns the accessibility tree. **agent-browser** handles clicking, typing, and screenshots. The auditor skill teaches Claude how to orchestrate all three.

## Requirements

- **macOS** (VoiceOver is macOS-only)
- **Bun** >= 1.0.0
- **agent-browser** installed separately (`npm i -g agent-browser`)
- Display must be awake (VoiceOver needs an active display)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/your-org/a11y-auditor.git
cd a11y-auditor
bun install
bunx playwright install chromium
```

### 2. Enable VoiceOver AppleScript control

System Settings > Accessibility > VoiceOver > Open VoiceOver Utility > General > **"Allow VoiceOver to be controlled with AppleScript"**

### 3. Grant TCC permissions

```bash
bunx @guidepup/setup
```

This grants the terminal app permission to control VoiceOver. You may need to restart your terminal after this step.

### 4. Install as a Claude Code skill

```bash
# From any project where you want to use the auditor:
npx skills add /path/to/a11y-auditor --skill auditor
npx skills add /path/to/a11y-auditor --skill vo-driver
```

Or, once published to GitHub:

```bash
npx skills add https://github.com/your-org/a11y-auditor --skill auditor
```

## Skills

### `auditor`

Full WCAG 2.2 AA audit methodology. Tell Claude to audit a page and it will:

1. Launch vo-driver (browser + VoiceOver)
2. Run axe-core for an automated baseline
3. Test document structure (headings, landmarks, images)
4. Test keyboard navigation (tab order, focus traps, focus indicators)
5. Test forms (labels, error handling, required fields)
6. Test interactive components (modals, tabs, accordions)
7. Cross-reference screenshots against the accessibility tree
8. Produce a structured report with confidence levels

```
> /auditor https://example.com
```

### `vo-driver`

VoiceOver screen reader automation. Use it standalone for targeted screen reader testing without running a full audit.

```bash
bun vo-driver.ts start https://example.com    # launch browser + VoiceOver
bun vo-driver.ts next                         # VO+Right
bun vo-driver.ts previous                     # VO+Left
bun vo-driver.ts act                          # VO+Space
bun vo-driver.ts press Tab                    # raw keystroke
bun vo-driver.ts perform FIND_NEXT_HEADING    # VoiceOver command
bun vo-driver.ts transcript                   # what VoiceOver has said
bun vo-driver.ts item-text                    # current focused item
bun vo-driver.ts stop                         # shutdown
```

### `audit.ts`

axe-core automated checks. Runs against vo-driver's browser via HTTP.

```bash
bun audit.ts                          # full page scan
bun audit.ts ".modal-dialog"          # scoped to selector
bun audit.ts --tags wcag2a,wcag2aa    # WCAG-only filter
bun audit.ts --no-tree                # skip accessibility tree
```

## Quick start

```bash
# Terminal 1: start a session
bun vo-driver.ts start https://example.com

# Terminal 2: run automated checks
bun audit.ts

# Terminal 2: interact via agent-browser
agent-browser --cdp 9222 snapshot -i
agent-browser --cdp 9222 screenshot

# Terminal 2: test with screen reader
bun vo-driver.ts perform FIND_NEXT_HEADING
bun vo-driver.ts press Tab
bun vo-driver.ts transcript
```

Or just tell Claude:

```
> Audit https://example.com for WCAG 2.2 AA compliance
```

## How it works

vo-driver launches a headed Chromium browser and VoiceOver, then runs as a daemon exposing both a CLI and an HTTP API. Other tools connect to the same browser:

- **audit.ts** sends requests to vo-driver's HTTP endpoint, which runs axe-core in the browser context and returns violations + the accessibility tree
- **agent-browser** connects via Chrome DevTools Protocol (CDP) on port 9222 for page interaction and screenshots
- **vo-driver CLI** sends VoiceOver commands via AppleScript and returns what VoiceOver announces

The auditor skill prompt teaches Claude the methodology — which tool to use for which WCAG criterion, how to collect evidence, and how to structure the report.

## Limitations

- **macOS only.** VoiceOver is a macOS screen reader. The command interface (next, previous, act, press, perform) is designed to be portable — future backends for NVDA (Windows) and Orca (Linux) could implement the same interface.
- **Single AT/browser combination.** Tests VoiceOver + Chrome. A full conformance claim requires testing with multiple AT/browser pairs (NVDA + Firefox, JAWS + Chrome, etc.).
- **Automated checks catch ~30-40% of WCAG issues.** The rest require human judgment — that's what vo-driver and the auditor methodology are for.
- **Display must be awake.** VoiceOver requires an active display. If the machine sleeps, wake it and restart vo-driver.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| VoiceOver won't start | Run `bunx @guidepup/setup` and restart terminal |
| Stuck in browser chrome | `bun vo-driver.ts enter` |
| Commands timing out | Wake the display, then `bun vo-driver.ts kill` + `start` |
| Daemon won't stop | `bun vo-driver.ts kill` |
| CDP connection refused | Check `bun vo-driver.ts status` for the port |
| agent-browser can't connect | Make sure you're using `--cdp 9222` (or whatever port vo-driver reports) |

Logs: `/tmp/vo-driver.log`

## Development

```bash
bun install
bun test              # run tests
bun run typecheck     # type-check without emitting
```

## License

MIT
