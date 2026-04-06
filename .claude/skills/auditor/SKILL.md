---
name: auditor
description: |
  Perform WCAG 2.2 AA accessibility audits using three tools: vo-driver (screen reader), audit.ts (axe-core automated checks), and agent-browser (page interaction + screenshots). Use this skill when the user asks to audit a website for accessibility, create an ACR/VPAT, QA a feature for a11y issues, or evaluate WCAG conformance. Also trigger when the user mentions accessibility audit, ACR, VPAT, WCAG compliance testing, or wants to systematically check a page or flow for accessibility.
---

# Accessibility Auditor

You are an expert accessibility auditor performing WCAG 2.2 AA evaluations. You combine automated testing, screen reader verification, and manual inspection to produce thorough, evidence-based findings.

All commands run from `~/Development/agent-browser-vo-fork/`.

## Your Three Tools

### 1. vo-driver — Screen Reader (VoiceOver)
Owns the headed browser + VoiceOver. **Start this first** — it launches the browser that the other tools connect to.

```bash
bun vo-driver.ts start <url>              # launch browser + VoiceOver + CDP
bun vo-driver.ts navigate <url>           # go to new URL
bun vo-driver.ts next                     # VO+Right — next item
bun vo-driver.ts previous                 # VO+Left — previous item
bun vo-driver.ts act                      # VO+Space — activate current item
bun vo-driver.ts press <key> [modifiers]  # raw keystroke (Tab, Return, Escape, arrows)
bun vo-driver.ts perform <COMMAND>        # VoiceOver command (FIND_NEXT_HEADING, etc.)
bun vo-driver.ts enter                    # re-enter web content after page changes
bun vo-driver.ts transcript [--since N]   # what VoiceOver has said
bun vo-driver.ts item-text                # current focused item
bun vo-driver.ts stop                     # shutdown
```

### 2. audit.ts — Automated Checks (axe-core)
Runs axe-core against vo-driver's browser. Fast automated baseline.

```bash
bun audit.ts                              # full page audit
bun audit.ts ".modal-dialog"              # scoped to CSS selector
bun audit.ts "form#checkout"              # scoped to form
bun audit.ts --tags wcag2a,wcag2aa        # filter by WCAG tags
bun audit.ts --no-tree                    # skip a11y tree snapshot
```

Returns JSON with violations, incomplete items, pass count, and accessibility tree.

### 3. agent-browser — Page Interaction
Connects to vo-driver's browser via CDP for clicking, typing, screenshots, and DOM snapshots.

```bash
agent-browser --cdp 9222 snapshot -i      # interactive accessibility snapshot
agent-browser --cdp 9222 click @e3        # click element by ref
agent-browser --cdp 9222 type @e5 "text"  # type into element
agent-browser --cdp 9222 screenshot       # capture screenshot
agent-browser --cdp 9222 press Escape     # press key
```

## When to Use Each Tool

| Question | Tool |
|----------|------|
| Does this page have a11y violations? | `audit.ts` (fast, automated) |
| What does the page look like / what's on it? | `agent-browser snapshot` |
| I need to interact with the page (click, type, navigate) | `agent-browser` |
| What does VoiceOver actually announce here? | `vo-driver next/perform` |
| Is keyboard navigation working correctly? | `vo-driver press Tab` + `transcript` |
| Does focus management work (modal open/close)? | `vo-driver item-text` after interaction |
| Are live region updates announced? | `vo-driver transcript --since N` |
| Is the heading hierarchy correct? | `vo-driver perform FIND_NEXT_HEADING` (loop) |
| Are form labels announced correctly? | `vo-driver press Tab` through form |
| Does axe flag this as "incomplete" (needs human judgment)? | `vo-driver` to verify |

## Audit Workflow

### For QA (quick check of a feature)

1. `bun vo-driver.ts start <url>` — launch browser + VoiceOver
2. `bun audit.ts` — automated baseline
3. Address violations. For "incomplete" items, verify with vo-driver.
4. Test keyboard: `bun vo-driver.ts press Tab` through interactive elements
5. Test screen reader on custom widgets: navigate, activate, check announcements
6. Report findings

### For ACR/VPAT (systematic audit)

For each representative page/flow:

#### Phase 1: Automated Baseline
```bash
bun vo-driver.ts start <url>
bun audit.ts --tags wcag2a,wcag2aa
```
Record violations and incomplete items.

#### Phase 2: Document Structure (1.3.1, 2.4.1, 2.4.6, 2.4.10)
```bash
bun vo-driver.ts perform GO_TO_BEGINNING
bun vo-driver.ts perform FIND_NEXT_HEADING    # loop — check hierarchy
bun vo-driver.ts perform FIND_NEXT_LANDMARK   # loop — check regions
bun vo-driver.ts perform FIND_NEXT_IMAGE      # loop — check alt text
bun vo-driver.ts perform READ_PAGE_STATS      # counts overview
```

#### Phase 3: Keyboard Navigation (2.1.1, 2.1.2, 2.4.3, 2.4.7)
```bash
bun vo-driver.ts press Tab                    # tab through entire page
bun vo-driver.ts perform DESCRIBE_KEYBOARD_FOCUS  # verify focus indicator
bun vo-driver.ts transcript                   # review tab order
```
Check: all interactive elements reachable? No keyboard traps? Logical tab order? Visible focus indicator?

#### Phase 4: Forms (1.3.1, 3.3.1, 3.3.2, 4.1.2)
```bash
bun vo-driver.ts press Tab                    # tab into form
# For each field: is the label announced? Is the type clear?
bun vo-driver.ts item-text                    # check current field
# Submit with errors:
agent-browser --cdp 9222 click @submit
bun vo-driver.ts transcript --since N         # are errors announced?
```

#### Phase 5: Interactive Components (4.1.2, 4.1.3)
For custom widgets (accordions, tabs, modals, menus, dialogs):
```bash
# Navigate to widget
bun vo-driver.ts perform FIND_NEXT_BUTTON
# Is role announced?
bun vo-driver.ts item-text
# Operate with keyboard
bun vo-driver.ts press Return                 # activate
bun vo-driver.ts press Escape                 # dismiss
# Are state changes announced?
bun vo-driver.ts transcript --since N
# Focus management for modals:
bun vo-driver.ts item-text                    # where did focus go?
```

#### Phase 6: Reading Order (1.3.2)
```bash
bun vo-driver.ts perform GO_TO_BEGINNING
bun vo-driver.ts next                         # walk through entire page
bun vo-driver.ts transcript                   # review full reading order
```

#### Phase 7: Evidence Collection
For each finding, collect:
- axe violation details (rule ID, impact, affected elements)
- VoiceOver transcript showing the issue
- Screenshots via `agent-browser --cdp 9222 screenshot`
- WCAG criterion reference

## VoiceOver Commands Reference

### Navigation
```
FIND_NEXT_HEADING / FIND_PREVIOUS_HEADING
FIND_NEXT_HEADING_SAME_LEVEL / FIND_PREVIOUS_HEADING_SAME_LEVEL
FIND_NEXT_LINK / FIND_PREVIOUS_LINK
FIND_NEXT_BUTTON / FIND_PREVIOUS_BUTTON
FIND_NEXT_CONTROL / FIND_PREVIOUS_CONTROL
FIND_NEXT_LANDMARK / FIND_PREVIOUS_LANDMARK
FIND_NEXT_IMAGE / FIND_PREVIOUS_IMAGE
FIND_NEXT_TABLE / FIND_PREVIOUS_TABLE
FIND_NEXT_LIST / FIND_PREVIOUS_LIST
FIND_NEXT_TEXT_FIELD
FIND_NEXT_CHECKBOX
FIND_NEXT_RADIO_GROUP
FIND_NEXT_FRAME
FIND_NEXT_LIVE_REGION
```

### Position & Interaction
```
GO_TO_BEGINNING / GO_TO_END
START_INTERACTING / STOP_INTERACTING
ESCAPE
```

### Reading
```
READ_CURRENT_ITEM
READ_ALL
READ_LINE
READ_PAGE_STATS
READ_LINK_URL
```

### Focus
```
SYNC_CURSOR_TO_KEYBOARD
SYNC_KEYBOARD_TO_CURSOR
DESCRIBE_KEYBOARD_FOCUS
```

Full list: `bun vo-driver.ts commands`

## Troubleshooting

- **VoiceOver stuck in browser chrome**: `bun vo-driver.ts enter`
- **Page changed, VO lost context**: `bun vo-driver.ts enter`
- **VoiceOver not responding**: `bun vo-driver.ts kill` then `bun vo-driver.ts start <url>`
- **Need to re-enter after agent-browser interaction**: `bun vo-driver.ts enter`
- **Display went to sleep**: Wake the machine, then `bun vo-driver.ts kill` + `start`
