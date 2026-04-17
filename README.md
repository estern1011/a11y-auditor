# a11y-auditor

WCAG 2.2 AA accessibility auditing for Claude Code. Combines real screen readers (VoiceOver on macOS, Orca on Linux), axe-core automated checks, and browser interaction into a single audit workflow.

```
┌──────────────────────────────────────────────────────┐
│                 Auditor skill (Claude)                │
│                                                      │
│  "You are an accessibility auditor with four tools"  │
└───────┬──────────┬──────────────┬──────────┬─────────┘
        │          │              │          │
  ┌─────▼─────┐  ┌▼───────────┐  ┌▼────────┐  ┌▼──────────┐
  │ sr-driver  │  │ collect.ts │  │audit.ts │  │agent-     │
  │            │  │            │  │         │  │browser    │
  │ Screen     │  │ Baseline   │  │Automated│  │ Page      │
  │ reader     │  │ evidence   │  │ checks  │  │ interact  │
  │            │  │ sweep      │  │(axe-core│  │ (click,   │
  │ VoiceOver  │  │            │  │ + a11y  │  │ screenshot│
  │ or Orca    │  │ axe + sr + │  │  tree)  │  │ snapshot) │
  │ + browser  │  │ screenshot │  │         │  │           │
  │            │  │ in one cmd │  │ via HTTP│  │ via CDP   │
  │ CDP :9222  │◄─┴────────────┘  └─────────┘  └───────────┘
  │ (or :9223) │◄──────────────────┘        ◄──┘
  └────────────┘
```

**sr-driver** owns the headed browser + screen reader, exposes CDP so other tools share the same session. **collect.ts** runs a baseline evidence sweep in a single command. **audit.ts** runs axe-core and returns the accessibility tree. **agent-browser** handles clicking, typing, and screenshots. The auditor skill teaches Claude how to orchestrate all four.

## Requirements

- **macOS** (VoiceOver) or **Linux** (Orca)
- **Bun** >= 1.0.0
- **Node.js** >= 18.0.0 (fallback)
- **agent-browser** installed separately (`npm i -g agent-browser`)
- macOS: display must be awake (VoiceOver needs an active display)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/estern1011/a11y-auditor.git
cd a11y-auditor
bun install
bunx playwright install chromium
```

### 2. Platform-specific setup

#### macOS (VoiceOver)

1. Enable AppleScript control: System Settings > Accessibility > VoiceOver > Open VoiceOver Utility > General > **"Allow VoiceOver to be controlled with AppleScript"**
2. Grant TCC permissions:
   ```bash
   bunx @guidepup/setup
   ```
   You may need to restart your terminal after this step.

#### Linux (Orca)

```bash
sudo bash drivers/orca/setup.sh           # install system deps (Orca, AT-SPI2, xvfb, etc.)
bash drivers/orca/setup.sh check          # verify everything is ready
```

The Orca driver auto-detects virtual desktop environments and starts Xvfb + openbox + D-Bus + AT-SPI2 automatically. Works in Codespaces, Docker, and cloud VMs.

### 3. Install as a Claude Code skill

```bash
# From any project where you want to use the auditor:
npx skills add /path/to/a11y-auditor --skill auditor
npx skills add /path/to/a11y-auditor --skill acr
npx skills add /path/to/a11y-auditor --skill vo-driver
npx skills add /path/to/a11y-auditor --skill orca-driver
```

Or, once published to GitHub:

```bash
npx skills add https://github.com/estern1011/a11y-auditor --skill auditor
npx skills add https://github.com/estern1011/a11y-auditor --skill acr
npx skills add https://github.com/estern1011/a11y-auditor --skill vo-driver
npx skills add https://github.com/estern1011/a11y-auditor --skill orca-driver
```

## Skills

### `auditor`

Full WCAG 2.2 AA audit methodology. Tell Claude to audit a page and it will:

1. Launch the screen reader driver
2. Run a baseline evidence sweep with `collect.ts`
3. Test document structure (headings, landmarks, images)
4. Test keyboard navigation (tab order, focus traps, focus indicators)
5. Test forms (labels, error handling, required fields)
6. Test interactive components (modals, tabs, accordions)
7. Cross-reference screenshots against the accessibility tree
8. Produce a structured report with confidence levels

```
> /auditor https://example.com
```

### `acr`

Generate an Accessibility Conformance Report (ACR) in VPAT 2.5 format from audit findings.

```
> /acr
```

### `vo-driver` / `orca-driver`

Screen reader automation. Use standalone for targeted screen reader testing without running a full audit. The command interface is identical across both drivers.

```bash
# macOS
bun drivers/voiceover/driver.ts start https://example.com

# Linux
bun drivers/orca/driver.ts start https://example.com

# Commands (same for both drivers)
bun {sr-driver} next                         # next item
bun {sr-driver} previous                     # previous item
bun {sr-driver} act                          # activate current item
bun {sr-driver} press Tab                    # raw keystroke
bun {sr-driver} perform FIND_NEXT_HEADING    # screen reader command
bun {sr-driver} transcript                   # what the screen reader has said
bun {sr-driver} item-text                    # current focused item
bun {sr-driver} stop                         # shutdown
```

### `collect.ts`

Baseline evidence collector. Runs axe-core, screen reader navigation, and screenshots in a single command against a running driver session.

```bash
bun collect.ts <url>                                  # full sweep
bun collect.ts <url> --tools axe,sr,screenshot        # select tools
bun collect.ts <url> --tabs 15                        # tab through 15 elements
```

### `audit.ts`

axe-core automated checks. Runs against the driver's browser via HTTP.

```bash
bun audit.ts                          # full page scan
bun audit.ts ".modal-dialog"          # scoped to selector
bun audit.ts --tags wcag2a,wcag2aa    # WCAG-only filter
bun audit.ts --no-tree                # skip accessibility tree
```

## Quick start

Pick your platform, then use the matching driver and ports throughout:

|       | `{sr-driver}`                 | CDP port | HTTP port |
| ----- | ----------------------------- | -------- | --------- |
| macOS | `drivers/voiceover/driver.ts` | 9222     | 7483      |
| Linux | `drivers/orca/driver.ts`      | 9223     | 7484      |

```bash
# Terminal 1: start a session
bun {sr-driver} start https://example.com

# Terminal 2: run baseline evidence sweep
bun collect.ts https://example.com

# Terminal 2: run automated checks only
bun audit.ts                                  # macOS (default port)
bun audit.ts --port 7484                      # Linux

# Terminal 2: interact via agent-browser
agent-browser --cdp {cdp-port} snapshot -i
agent-browser --cdp {cdp-port} screenshot

# Terminal 2: test with screen reader
bun {sr-driver} perform FIND_NEXT_HEADING
bun {sr-driver} press Tab
bun {sr-driver} transcript
```

Or just tell Claude:

```
> Audit https://example.com for WCAG 2.2 AA compliance
```

## How it works

The screen reader driver launches a headed Chromium browser and the platform's screen reader, then runs as a daemon exposing both a CLI and an HTTP API. Other tools connect to the same browser:

- **collect.ts** runs axe-core, screen reader navigation, and screenshots in one sweep
- **audit.ts** sends requests to the driver's HTTP endpoint, which runs axe-core in the browser context and returns violations + the accessibility tree
- **agent-browser** connects via Chrome DevTools Protocol (CDP) on port 9222 (macOS) or 9223 (Linux) for page interaction and screenshots

The auditor skill prompt teaches Claude the methodology — which tool to use for which WCAG criterion, how to collect evidence, and how to structure the report.

## Limitations

- **macOS and Linux only.** Windows (NVDA/JAWS) is not yet implemented — the common driver interface is designed to support future backends.
- **Single AT/browser combination per run.** Each run tests one screen reader + Chrome. A full conformance claim requires testing with multiple AT/browser pairs (NVDA + Firefox, JAWS + Chrome, etc.).
- **Automated checks catch ~30-40% of WCAG issues.** The rest require human judgment — that's what the screen reader drivers and the auditor methodology are for.
- **macOS: display must be awake.** VoiceOver requires an active display. If the machine sleeps, wake it and restart the driver. (Orca on Linux works headless with Xvfb.)

## Troubleshooting

| Problem                     | Fix                                                                      |
| --------------------------- | ------------------------------------------------------------------------ |
| VoiceOver won't start       | Run `bunx @guidepup/setup` and restart terminal                          |
| Orca won't start            | Run `bash drivers/orca/setup.sh check` to verify deps                    |
| Stuck in browser chrome     | `bun {sr-driver} enter`                                                  |
| Commands timing out         | Wake display (macOS), then `bun {sr-driver} kill` + `start`              |
| Daemon won't stop           | `bun {sr-driver} kill`                                                   |
| CDP connection refused      | Check `bun {sr-driver} status` for the port                              |
| agent-browser can't connect | Use `--cdp 9222` (macOS) or `--cdp 9223` (Linux), or check driver status |

Logs: `/tmp/vo-driver.log` (macOS), `/tmp/orca-driver.log` (Linux)

## Evaluation

Measure the auditor's detection accuracy against W3C ACT Rules test cases — standalone HTML pages with known pass/fail outcomes.

### Prerequisites

- [Sprite CLI](https://sprites.dev) installed and authenticated (`sprite login`)
- Changes pushed to GitHub (the sprite clones from the remote)

### Step 1: Collect test cases (one-time)

Run the collection prompt on claude.ai/code or Claude Code. It scrapes
the [ACT Rules](https://www.w3.org/WAI/standards-guidelines/act/rules/)
page and saves all Level A+AA test cases:

```
> Use the prompt in eval/collect-prompt.md
```

This produces `eval/act-test-cases.json`. Commit and push it.

### Step 2: Run the evaluation

Give an agent the prompt in `eval/evaluate-prompt.md`. The agent will
automatically create a sprite, bootstrap it, and run the full eval:

1. Create and bootstrap a sprite (Orca + Chromium + repo)
2. Read `eval/act-test-cases.json` and `skills/acr/criteria.json`
3. For each test case, collect evidence on the sprite (`eval/queue-collect.ts`)
4. Compare results against ground truth (`eval/queue-score.ts`)
5. Produce `eval/results.json` with precision, recall, and per-criterion breakdown

To evaluate a specific branch, tell the agent which branch to use.

### Eval tools

| File                      | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| `eval/queue-init.ts`      | Initialize eval queue from test cases              |
| `eval/queue-collect.ts`   | On-sprite evidence collector with answer redaction |
| `eval/queue-score.ts`     | Score results against ground truth                 |
| `eval/results-summary.md` | Summary of latest eval run                         |

## Development

See [AGENTS.md](AGENTS.md) for detailed development guidance for AI agents.

```bash
bun install
bun test              # run tests
bun run typecheck     # type-check without emitting
bun run lint          # run ESLint
bun run format        # run Prettier
```

## License

MIT
