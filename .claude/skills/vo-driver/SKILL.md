---
name: vo-driver
description: |
  Drive VoiceOver on macOS to test web accessibility. Use this skill whenever the user asks to test a website with a screen reader, audit accessibility with VoiceOver, check what VoiceOver announces for page elements, navigate a page as a screen reader user would, or compare expected vs actual screen reader output. Also trigger when the user mentions VoiceOver, screen reader testing, a11y testing with real assistive technology, or wants to verify ARIA labels, heading structure, landmark regions, or reading order using actual VoiceOver output.
---

# VoiceOver Driver Skill

You are an expert screen reader user performing WCAG 2.2 AA accessibility audits via VoiceOver. You drive a real VoiceOver + Chrome session to test pages the way a blind or low-vision user would actually experience them.

All commands run from the `a11y-auditor` project directory.

## Prerequisites

macOS only. Before first use:

1. Enable VoiceOver AppleScript: System Settings > Accessibility > VoiceOver > Open VoiceOver Utility > General > "Allow VoiceOver to be controlled with AppleScript"
2. Run `bunx @guidepup/setup` for TCC permissions
3. Install deps: `bun install && bunx playwright install chromium`

## Session Lifecycle

```bash
bun vo-driver.ts start <url>           # launch browser + VoiceOver + CDP on :9222
bun vo-driver.ts start <url> --cdp-port 9333  # custom CDP port
bun vo-driver.ts navigate <url>        # go to new URL (auto-enters web content)
bun vo-driver.ts status                # check daemon state + CDP port
bun vo-driver.ts stop                  # graceful shutdown
bun vo-driver.ts kill                  # force kill (use if stop hangs)
```

`start` automatically enters web content. If VoiceOver pops back to browser chrome (after a page reload, SPA navigation, etc.), use `enter` to get back in:

```bash
bun vo-driver.ts enter                 # re-enter web content
```

## CDP — Sharing the Browser

vo-driver exposes a Chrome DevTools Protocol port so other tools can connect to the same browser:

```bash
bun vo-driver.ts start https://app.com
# → Ready. CDP available on ws://127.0.0.1:9222

agent-browser --cdp 9222 snapshot -i    # connect agent-browser to same browser
```

## Core Navigation

```bash
bun vo-driver.ts next              # VO+Right — next item
bun vo-driver.ts previous          # VO+Left — previous item
bun vo-driver.ts act               # VO+Space — click/press current item
bun vo-driver.ts press <key> [modifiers...]  # raw keystroke
```

### Raw Key Presses

For modal interactions (rotor, dialogs, menus) and Tab-key navigation:

```bash
bun vo-driver.ts press Tab                    # Tab key
bun vo-driver.ts press Tab shift              # Shift+Tab
bun vo-driver.ts press Return                 # Enter/Return
bun vo-driver.ts press Space                  # Space bar
bun vo-driver.ts press Escape                 # Escape
bun vo-driver.ts press Left                   # Left arrow
bun vo-driver.ts press Right                  # Right arrow
bun vo-driver.ts press Up                     # Up arrow
bun vo-driver.ts press Down                   # Down arrow
```

Valid modifiers: `control`, `option`, `command`, `shift`

## VoiceOver Commands (perform)

Use `perform` for any VoiceOver command. Names follow VoiceOver conventions.

### Element Navigation
```bash
bun vo-driver.ts perform FIND_NEXT_HEADING
bun vo-driver.ts perform FIND_PREVIOUS_HEADING
bun vo-driver.ts perform FIND_NEXT_HEADING_SAME_LEVEL
bun vo-driver.ts perform FIND_NEXT_LINK
bun vo-driver.ts perform FIND_PREVIOUS_LINK
bun vo-driver.ts perform FIND_NEXT_BUTTON
bun vo-driver.ts perform FIND_PREVIOUS_BUTTON
bun vo-driver.ts perform FIND_NEXT_CONTROL       # any form control (fields, checkboxes, radios)
bun vo-driver.ts perform FIND_NEXT_LANDMARK
bun vo-driver.ts perform FIND_PREVIOUS_LANDMARK
bun vo-driver.ts perform FIND_NEXT_IMAGE
bun vo-driver.ts perform FIND_NEXT_TABLE
bun vo-driver.ts perform FIND_NEXT_LIST
bun vo-driver.ts perform FIND_NEXT_FRAME
```

### Position & Interaction
```bash
bun vo-driver.ts perform GO_TO_BEGINNING
bun vo-driver.ts perform GO_TO_END
bun vo-driver.ts perform START_INTERACTING      # enter a group/web content
bun vo-driver.ts perform STOP_INTERACTING       # exit a group
bun vo-driver.ts perform ESCAPE
```

### Rotor
```bash
bun vo-driver.ts perform OPEN_WEB_ROTOR         # VO+U
bun vo-driver.ts press Left                      # switch category
bun vo-driver.ts press Right                     # switch category
bun vo-driver.ts press Down                      # move within category
bun vo-driver.ts press Up                        # move within category
bun vo-driver.ts press Return                    # jump to item
bun vo-driver.ts press Escape                    # close rotor
```

### Reading
```bash
bun vo-driver.ts perform READ_CURRENT_ITEM
bun vo-driver.ts perform READ_ALL
bun vo-driver.ts perform READ_LINE
bun vo-driver.ts perform READ_LINK_URL
bun vo-driver.ts perform READ_PAGE_STATS
```

### Table Reading
```bash
bun vo-driver.ts perform READ_TABLE_ROW
bun vo-driver.ts perform READ_TABLE_COLUMN
bun vo-driver.ts perform READ_TABLE_HEADER
bun vo-driver.ts perform READ_TABLE_POSITION
```

### Focus Management
```bash
bun vo-driver.ts perform SYNC_CURSOR_TO_KEYBOARD
bun vo-driver.ts perform SYNC_KEYBOARD_TO_CURSOR
bun vo-driver.ts perform DESCRIBE_KEYBOARD_FOCUS
```

### Full command list
```bash
bun vo-driver.ts commands              # list all
bun vo-driver.ts commands heading      # filter
```

## Querying State

```bash
bun vo-driver.ts item-text                      # current focused item
bun vo-driver.ts transcript                     # full session transcript
bun vo-driver.ts transcript --since 42          # entries after index 42
bun vo-driver.ts transcript --clear             # clear and return
```

## JSON Output

Add `--json` to any command for structured output:

```bash
bun vo-driver.ts next --json
# {"spoken":"heading level 1 Example Domain","name":"Example Domain","role":"heading level 1","index":0}
```

## Response Format

Every navigation command returns:
- **spoken** — full VoiceOver announcement
- **name** — the element's accessible name
- **role** — the element's role (heading, link, button, etc.)

## WCAG 2.2 AA Audit Methodology

### Phase 1: Orient
1. `start <url>` — launches browser + VoiceOver, enters web content
2. `perform READ_PAGE_STATS` — counts of headings, links, controls

### Phase 2: Document Structure (1.3.1, 2.4.1, 2.4.6)
- Loop headings with `perform FIND_NEXT_HEADING` — check hierarchy
- Loop landmarks with `perform FIND_NEXT_LANDMARK` — check regions
- Check images with `perform FIND_NEXT_IMAGE` — check alt text

### Phase 3: Forms (1.3.1, 3.3.1, 3.3.2, 4.1.2)
- Tab through fields with `press Tab` — check labels announced
- Use `perform DESCRIBE_KEYBOARD_FOCUS` to verify focus
- Submit with errors — check error announcements

### Phase 4: Interactive Components (4.1.2, 4.1.3)
- Navigate to custom widgets — is role announced?
- Operate with keyboard (arrows, Enter, Escape) — state changes announced?
- Open/close modals — focus management correct?
- Trigger actions — live region updates announced?

### Phase 5: Keyboard (2.1.1, 2.1.2)
- `press Tab` through entire page — all elements reachable?
- Look for keyboard traps
- Test custom keyboard patterns

### Phase 6: Reading Order (1.3.2)
- Walk with `next` — logical sequence?
- Use `transcript` to review the full reading order

## Troubleshooting

- **VoiceOver won't start**: Run `bunx @guidepup/setup`
- **Stuck in browser chrome**: Run `enter` to get back into web content
- **Commands timing out**: VoiceOver may need the display awake. If machine slept, wake it and restart
- **Daemon won't stop**: Use `kill` to force-terminate
- **Logs**: `/tmp/vo-driver.log`
- **Help**: `bun vo-driver.ts --help`
