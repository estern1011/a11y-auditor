# Accessibility Auditor — Design Document

## Architecture

Three tools sharing one browser via CDP:

```
┌──────────────────────────────────────────────────────────┐
│                  Auditor skill (persona)                  │
│                                                          │
│  "You are an accessibility auditor with three tools..."  │
└────────┬──────────────────┬──────────────────┬───────────┘
         │                  │                  │
   ┌─────▼─────┐    ┌──────▼──────┐    ┌──────▼──────┐
   │ vo-driver  │    │  audit.ts  │    │agent-browser│
   │            │    │             │    │             │
   │ Screen     │    │ Automated   │    │ Page        │
   │ reader     │    │ checks      │    │ interaction │
   │            │    │             │    │             │
   │ Owns the   │    │ axe-core +  │    │ click, type │
   │ browser +  │    │ a11y tree   │    │ screenshot  │
   │ VoiceOver  │    │             │    │ snapshot    │
   │            │    │ Connects    │    │             │
   │ CDP :9222  │◄───│ via CDP     │    │ Connects    │
   │            │◄───│             │    │ via CDP     │
   └────────────┘    └─────────────┘    └─────────────┘
```

- **vo-driver** owns the headed browser + VoiceOver, exposes CDP on port 9222
- **audit.ts** (separate tool) connects via CDP, runs axe-core + returns accessibility tree
- **agent-browser** connects via `--cdp 9222` for interaction, screenshots, DOM queries
- **One skill doc** (auditor persona) teaches the agent to orchestrate all three

## How It Works

The agent explores with agent-browser. When it encounters new states, it runs audit.ts for automated checks and uses vo-driver to verify screen reader behavior.

```bash
# 1. Agent starts vo-driver (browser + VoiceOver + CDP)
bun vo-driver.ts start https://app.com

# 2. Agent connects agent-browser to same browser
agent-browser --cdp 9222 snapshot -i

# 3. Agent runs automated checks
bun audit.ts --cdp 9222

# 4. Agent interacts via agent-browser
agent-browser --cdp 9222 click @e3        # open modal

# 5. Agent audits the modal
bun audit.ts --cdp 9222 ".modal-dialog"

# 6. Agent verifies with VoiceOver
bun vo-driver.ts enter                   # re-enter web content
bun vo-driver.ts perform FIND_NEXT_HEADING
bun vo-driver.ts press Tab               # test keyboard nav
bun vo-driver.ts transcript --since 12   # what did VO say?

# 7. Agent closes modal via agent-browser, checks focus return
agent-browser --cdp 9222 press Escape
bun vo-driver.ts item-text               # where did focus land?
```

## vo-driver Command Surface

### Session
```bash
bun vo-driver.ts start <url>           # launch browser + VoiceOver + CDP
bun vo-driver.ts start <url> --cdp-port 9333  # custom CDP port
bun vo-driver.ts stop                  # graceful shutdown
bun vo-driver.ts kill                  # force kill
bun vo-driver.ts status               # check state
bun vo-driver.ts enter                # navigate into web content (auto on start/navigate)
bun vo-driver.ts navigate <url>       # go to new URL + re-enter web content
```

### Movement
```bash
bun vo-driver.ts next                 # VO+Right
bun vo-driver.ts previous             # VO+Left
```

### Interaction
```bash
bun vo-driver.ts act                  # VO+Space (activate current item)
bun vo-driver.ts press <key> [mods]   # raw keystroke (Tab, Return, Escape, arrows, etc.)
```

### VoiceOver Commands
```bash
bun vo-driver.ts perform <COMMAND>    # any VoiceOver command
```

Uses VoiceOver-standard command names (FIND_NEXT_HEADING, START_INTERACTING, etc.) so agents with existing VoiceOver knowledge feel at home.

### Queries
```bash
bun vo-driver.ts transcript                # full session transcript
bun vo-driver.ts transcript --since 42     # entries after index 42
bun vo-driver.ts transcript --clear        # clear and return
bun vo-driver.ts item-text                 # current focused item
bun vo-driver.ts commands [filter]         # list available perform commands
```

### Flags
```bash
--json          # structured JSON output (default: human-readable)
--cdp-port N    # CDP port (default: 9222)
```

### Response Format

```
$ bun vo-driver.ts next
Spoken: "heading level 1 Example Domain"
Name: "Example Domain"
Role: "heading level 1"

$ bun vo-driver.ts next --json
{"spoken":"heading level 1 Example Domain","name":"Example Domain","role":"heading level 1"}
```

### Exit Codes
- **0** — command succeeded (including "Heading not found" — that's useful info)
- **1** — actual error (VoiceOver not running, daemon not started, timeout)

## audit.ts

Runs axe-core in vo-driver's process via the `/audit` HTTP endpoint (avoids CDP multi-connection issues with Playwright). CLI wrapper sends requests to vo-driver.

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

You have three tools:
- vo-driver: your screen reader (start it first — it owns the browser)
- audit.ts: your automated checker (axe-core + accessibility tree)
- agent-browser: your hands on the page (interaction, screenshots)

Connect agent-browser and audit.ts to vo-driver's browser via --cdp 9222.

Workflow:
1. Start vo-driver (launches browser + VoiceOver)
2. Explore with agent-browser (click, type, navigate)
3. Run audit.ts on each new state (pages, modals, error states)
4. Use vo-driver to verify findings that need screen reader confirmation
5. Collect evidence (screenshots, VO transcripts, axe results)
6. Report findings per WCAG criterion

When to use each tool:
- audit.ts: "does this page have a11y issues?" (fast, automated)
- agent-browser: "let me interact with this page" (click, type, screenshot)
- vo-driver: "what does a screen reader actually say/do here?" (targeted verification)

Use vo-driver for:
- Custom widget operation (Tab in, arrow keys, does VO announce changes?)
- Focus management (modal open/close, SPA navigation)
- Live region announcements (form submit, status updates)
- Form flows (Tab through, submit with errors, hear error messages)
- Verifying axe "incomplete" items that need human judgment
```

## Use Cases

### QA an individual piece of work

Agent explores the feature with agent-browser, runs audit.ts on the states it encounters, uses vo-driver to spot-check interactive components. Fast, focused, integrated into dev workflow.

### Conduct an accessibility audit (ACR/VPAT)

Agent systematically tests representative pages/flows. For each page:
1. audit.ts for automated baseline
2. agent-browser for screenshots and interaction testing
3. vo-driver for screen reader verification of complex components

Page auditor outputs structured findings. Separate report builder agent (future) synthesizes multi-page findings into VPAT 2.5 format.

## Screen Reader Abstraction

vo-driver is the VoiceOver/macOS implementation. The command interface (next, previous, act, press, enter, transcript, perform) is generic. Future backends:
- nvda-driver (Windows)
- orca-driver (Linux)

The auditor skill programs against the interface. Swap implementations per OS.

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
- [x] Three-tool orchestration instructions
- [x] WCAG criterion testing guide (which tool for which check)
- [x] Evidence collection guidance
- [x] QA workflow and ACR/VPAT workflow

### Phase 4: Report builder (future)
- [ ] Separate agent/skill
- [ ] Takes structured findings from page auditors
- [ ] Produces VPAT 2.5 format ACR
