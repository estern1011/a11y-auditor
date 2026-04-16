# Accessibility Auditor — Design Document

## Architecture

Four tools sharing one browser via CDP:

```
┌──────────────────────────────────────────────────────┐
│                 Auditor skill (persona)               │
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

- **sr-driver** (VoiceOver on macOS, Orca on Linux) owns the headed browser + screen reader, exposes CDP
- **collect.ts** runs a baseline evidence sweep in a single command
- **audit.ts** runs in the driver's process via the `/audit` HTTP endpoint, runs axe-core + returns accessibility tree
- **agent-browser** connects via CDP for interaction, screenshots, DOM queries
- **One skill doc** (auditor persona) teaches the agent to orchestrate all four

## How It Works

The agent explores with agent-browser. When it encounters new states, it runs audit.ts for automated checks and uses the screen reader driver to verify behavior.

```bash
# 1. Agent starts the screen reader driver
bun {sr-driver} start https://app.com

# 2. Agent runs baseline evidence sweep
bun collect.ts https://app.com

# 3. Agent connects agent-browser to same browser
agent-browser --cdp 9222 snapshot -i

# 4. Agent interacts via agent-browser
agent-browser --cdp 9222 click @e3        # open modal

# 5. Agent audits the modal
bun audit.ts ".modal-dialog"

# 6. Agent verifies with screen reader
bun {sr-driver} enter                   # re-enter web content
bun {sr-driver} perform FIND_NEXT_HEADING
bun {sr-driver} press Tab               # test keyboard nav
bun {sr-driver} transcript --since 12   # what did the SR say?

# 7. Agent closes modal via agent-browser, checks focus return
agent-browser --cdp 9222 press Escape
bun {sr-driver} item-text               # where did focus land?
```

## Screen Reader Driver Command Surface

Both drivers expose identical commands. `{sr-driver}` is a placeholder — substitute `drivers/voiceover/driver.ts` (macOS) or `drivers/orca/driver.ts` (Linux).

### Session

```bash
bun {sr-driver} start <url>           # launch browser + screen reader + CDP
bun {sr-driver} start <url> --cdp-port 9333  # custom CDP port
bun {sr-driver} stop                  # graceful shutdown
bun {sr-driver} kill                  # force kill
bun {sr-driver} status               # check state
bun {sr-driver} enter                # navigate into web content (auto on start/navigate)
bun {sr-driver} navigate <url>       # go to new URL + re-enter web content
```

### Movement

```bash
bun {sr-driver} next                 # next item
bun {sr-driver} previous             # previous item
```

### Interaction

```bash
bun {sr-driver} act                  # activate current item
bun {sr-driver} press <key> [mods]   # raw keystroke (Tab, Return, Escape, arrows, etc.)
```

### Screen Reader Commands

```bash
bun {sr-driver} perform <COMMAND>    # any screen reader command
```

Uses platform-standard command names (FIND_NEXT_HEADING, START_INTERACTING, etc.).

### Queries

```bash
bun {sr-driver} transcript                # full session transcript
bun {sr-driver} transcript --since 42     # entries after index 42
bun {sr-driver} transcript --clear        # clear and return
bun {sr-driver} item-text                 # current focused item
bun {sr-driver} commands [filter]         # list available perform commands
```

### Flags

```bash
--json          # structured JSON output (default: human-readable)
--cdp-port N    # CDP port (default: 9222 macOS, 9223 Linux)
```

### Response Format

```
$ bun {sr-driver} next
Spoken: "heading level 1 Example Domain"
Name: "Example Domain"
Role: "heading level 1"

$ bun {sr-driver} next --json
{"spoken":"heading level 1 Example Domain","name":"Example Domain","role":"heading level 1"}
```

### Exit Codes

- **0** — command succeeded (including "Heading not found" — that's useful info)
- **1** — actual error (screen reader not running, daemon not started, timeout)

## collect.ts

Baseline evidence collector. Runs axe-core, screen reader navigation, and screenshots in a single command against a running driver session.

```bash
bun collect.ts <url>                                  # full sweep
bun collect.ts <url> --tools axe,sr,screenshot        # select tools
bun collect.ts <url> --tabs 15                        # tab through 15 elements
```

## audit.ts

Runs axe-core in the driver's process via the `/audit` HTTP endpoint (avoids CDP multi-connection issues with Playwright). CLI wrapper sends requests to the driver.

```bash
bun audit.ts                               # full page
bun audit.ts ".modal-dialog"               # scoped to selector
bun audit.ts "form#checkout"               # scoped to form
bun audit.ts --tags wcag2a,wcag2aa         # filter by WCAG tags
bun audit.ts --no-tree                     # skip a11y tree snapshot
```

Output (always JSON):

```json
{
  "url": "https://app.com/page",
  "selector": ".modal-dialog",
  "axe": {
    "violations": [...],
    "incomplete": [...],
    "passes": 34,
    "inapplicable": 18
  },
  "tree": "- dialog \"Confirm\"..."
}
```

Dependencies: `@axe-core/playwright`.

## Auditor Skill Doc

The skill doc is an agent persona:

```
You are an accessibility auditor performing WCAG 2.2 AA evaluations.

You have four tools:
- sr-driver: your screen reader (start it first — it owns the browser)
- collect.ts: your baseline evidence sweep (one command)
- audit.ts: your automated checker (axe-core + accessibility tree)
- agent-browser: your hands on the page (interaction, screenshots)

Workflow:
1. Start the screen reader driver (launches browser + screen reader)
2. Run collect.ts for a baseline evidence sweep
3. Explore with agent-browser (click, type, navigate)
4. Run audit.ts on each new state (pages, modals, error states)
5. Use sr-driver to verify findings that need screen reader confirmation
6. Report findings per WCAG criterion

When to use each tool:
- collect.ts: "give me a full baseline" (axe + sr + screenshot in one command)
- audit.ts: "does this page have a11y issues?" (fast, automated)
- agent-browser: "let me interact with this page" (click, type, screenshot)
- sr-driver: "what does a screen reader actually say/do here?" (targeted verification)

Use sr-driver for:
- Custom widget operation (Tab in, arrow keys, does the SR announce changes?)
- Focus management (modal open/close, SPA navigation)
- Live region announcements (form submit, status updates)
- Form flows (Tab through, submit with errors, hear error messages)
- Verifying axe "incomplete" items that need human judgment
```

## Use Cases

### QA an individual piece of work

Agent explores the feature with agent-browser, runs audit.ts on the states it encounters, uses the screen reader driver to spot-check interactive components. Fast, focused, integrated into dev workflow.

### Conduct an accessibility audit (ACR/VPAT)

Agent systematically tests representative pages/flows. For each page:

1. collect.ts for baseline evidence sweep
2. audit.ts for targeted automated checks on specific states
3. agent-browser for screenshots and interaction testing
4. sr-driver for screen reader verification of complex components

Page auditor outputs structured findings. The `acr` skill synthesizes findings into VPAT 2.5 format.

## Screen Reader Abstraction

Both drivers implement the `ScreenReaderDriver` interface (`drivers/interface.ts`). The command surface (next, previous, act, press, enter, transcript, perform) is identical. Current backends:

- **vo-driver** — VoiceOver on macOS
- **orca-driver** — Orca on Linux (works headless with Xvfb)

Future: nvda-driver (Windows).

The auditor skill programs against the interface using `{sr-driver}` as a placeholder. Platform detection (`platform/detect.ts`) auto-selects the right driver.

## What to Build

### Phase 1: Polish vo-driver ✓

- [x] Expose CDP port on start (`--remote-debugging-port`)
- [x] `enter` command (auto-navigate into web content)
- [x] Auto-enter on `start` and `navigate`
- [x] `transcript` command (replaces phrase-log/last-phrase)
- [x] Response format: `spoken`, `name`, `role`
- [x] `--json` flag
- [x] Remove `snapshot` command
- [x] Remove `ACTIVATE` from perform catalog
- [x] Exit 0 for "not found" responses
- [x] TypeScript migration (5 typed modules, 36 tests)
- [x] AI-friendly error translation (vo-errors.ts)

### Phase 2: audit.ts ✓

- [x] Core function runs in vo-driver process (avoids CDP multi-connection issues)
- [x] CLI wrapper hits /audit HTTP endpoint
- [x] Runs axe-core scoped to CSS selector
- [x] Filter by axe tags (wcag2a, wcag2aa, best-practice)
- [x] Returns violations + incomplete + a11y tree as JSON
- [x] a11y tree uses Playwright ariaSnapshot with mode:"ai"

### Phase 3: Auditor skill doc ✓

- [x] Agent persona (expert WCAG 2.2 AA auditor)
- [x] Four-tool orchestration instructions
- [x] WCAG criterion testing guide (which tool for which check)
- [x] Evidence collection guidance
- [x] QA workflow and ACR/VPAT workflow

### Phase 4: ACR/VPAT report builder ✓

- [x] `acr` skill (generates VPAT 2.5 format ACR from audit findings)
- [x] Criteria mapping in `skills/acr/criteria.json`
- [x] Takes structured findings from auditor skill output

### Phase 5: Orca driver (Linux) ✓

- [x] AT-SPI2 D-Bus client (`drivers/orca/atspi.ts`)
- [x] Speech capture (`drivers/orca/speech.ts`)
- [x] Common `ScreenReaderDriver` interface (`drivers/interface.ts`)
- [x] Unified HTTP server (`drivers/server.ts`)
- [x] Platform auto-detection (`platform/detect.ts`)
- [x] Setup script for headless/remote environments (`drivers/orca/setup.sh`)

### Phase 6: Baseline evidence collector ✓

- [x] `collect.ts` — axe + screen reader + screenshot in one command
- [x] `eval/queue-collect.ts` — eval-specific variant with answer redaction
