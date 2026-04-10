---
name: orca-driver
description: |
  Drive the Orca screen reader on Linux to test web accessibility. Use this skill whenever the user asks to test a website with a screen reader on Linux, audit accessibility with Orca, check what Orca announces for page elements, navigate a page as a screen reader user would on a Linux desktop, or compare expected vs actual screen reader output on Linux. Also trigger when the user mentions Orca, Linux screen reader testing, AT-SPI2, a11y testing with real assistive technology on Linux, or wants to verify ARIA labels, heading structure, landmark regions, or reading order using actual Orca output.
---

# Orca Driver Skill (Linux)

You are an expert screen reader user performing WCAG 2.2 AA accessibility audits via Orca on Linux. You drive a real Orca + Chromium session to test pages the way a blind or low-vision Linux user would actually experience them.

All commands run from the `a11y-auditor` project directory.

## Prerequisites

Linux (desktop or headless — Codespaces, Docker, CI all work). Before first use:

### Quick setup (headless/remote — Codespaces, Docker, CI)
```bash
sudo bash orca-setup.sh              # install all system deps
bash orca-setup.sh check             # verify everything is ready
bun install && bunx playwright install chromium
```

The driver auto-detects headless environments and starts Xvfb + D-Bus + AT-SPI2 automatically — no manual setup needed after installing packages.

### Manual setup (desktop)
1. Install Orca: `sudo apt install orca`
2. Install AT-SPI2 Python bindings: `sudo apt install python3-gi gir1.2-atspi-2.0`
3. Install keyboard tool: `sudo apt install xdotool` (X11) or `sudo apt install ydotool` (Wayland)
4. Ensure AT-SPI2 bus is running: `systemctl --user start at-spi-dbus-bus`
5. Install deps: `bun install && bunx playwright install chromium`

## Session Lifecycle

```bash
bun orca-driver.ts start <url>           # launch browser + Orca + CDP on :9223
bun orca-driver.ts start <url> --cdp-port 9333  # custom CDP port
bun orca-driver.ts navigate <url>        # go to new URL
bun orca-driver.ts status                # check daemon state + CDP port
bun orca-driver.ts stop                  # graceful shutdown
bun orca-driver.ts kill                  # force kill (use if stop hangs)
```

`start` automatically focuses the browser for Orca. If Orca loses focus, use `enter` to re-focus:

```bash
bun orca-driver.ts enter                 # re-focus browser for Orca
```

## CDP — Sharing the Browser

orca-driver exposes a Chrome DevTools Protocol port so other tools can connect to the same browser:

```bash
bun orca-driver.ts start https://app.com
# → Ready. CDP available on ws://127.0.0.1:9223

agent-browser --cdp 9223 snapshot -i    # connect agent-browser to same browser
```

## Core Navigation

```bash
bun orca-driver.ts next              # Down — next item in browse mode
bun orca-driver.ts previous          # Up — previous item in browse mode
bun orca-driver.ts act               # Enter — activate current item
bun orca-driver.ts press <key> [modifiers...]  # raw keystroke
```

### Raw Key Presses

```bash
bun orca-driver.ts press Tab                    # Tab key
bun orca-driver.ts press Tab shift              # Shift+Tab
bun orca-driver.ts press Return                 # Enter/Return
bun orca-driver.ts press Space                  # Space bar
bun orca-driver.ts press Escape                 # Escape
bun orca-driver.ts press Left                   # Left arrow
bun orca-driver.ts press Right                  # Right arrow
bun orca-driver.ts press Up                     # Up arrow
bun orca-driver.ts press Down                   # Down arrow
```

Valid modifiers: `control`, `shift`, `alt`, `super`

## Orca Browse-Mode Commands (perform)

Orca uses single-key navigation in browse mode. Use `perform` with these command names.

### Heading Navigation
```bash
bun orca-driver.ts perform FIND_NEXT_HEADING           # H
bun orca-driver.ts perform FIND_PREVIOUS_HEADING       # Shift+H
bun orca-driver.ts perform FIND_NEXT_HEADING_1         # 1
bun orca-driver.ts perform FIND_NEXT_HEADING_2         # 2
bun orca-driver.ts perform FIND_NEXT_HEADING_3         # 3
# ... through FIND_NEXT_HEADING_6
```

### Link Navigation
```bash
bun orca-driver.ts perform FIND_NEXT_LINK              # K
bun orca-driver.ts perform FIND_PREVIOUS_LINK          # Shift+K
bun orca-driver.ts perform FIND_NEXT_UNVISITED_LINK    # U
bun orca-driver.ts perform FIND_NEXT_VISITED_LINK      # V
```

### Element Navigation
```bash
bun orca-driver.ts perform FIND_NEXT_BUTTON            # B
bun orca-driver.ts perform FIND_PREVIOUS_BUTTON        # Shift+B
bun orca-driver.ts perform FIND_NEXT_CONTROL           # F (form field)
bun orca-driver.ts perform FIND_NEXT_ENTRY             # E (text entry)
bun orca-driver.ts perform FIND_NEXT_CHECKBOX          # X
bun orca-driver.ts perform FIND_NEXT_COMBO_BOX         # C
bun orca-driver.ts perform FIND_NEXT_RADIO_BUTTON      # R
bun orca-driver.ts perform FIND_NEXT_TABLE             # T
bun orca-driver.ts perform FIND_NEXT_LIST              # L
bun orca-driver.ts perform FIND_NEXT_LANDMARK          # M
bun orca-driver.ts perform FIND_NEXT_IMAGE             # G
bun orca-driver.ts perform FIND_NEXT_BLOCKQUOTE        # Q
bun orca-driver.ts perform FIND_NEXT_PARAGRAPH         # P
bun orca-driver.ts perform FIND_NEXT_SEPARATOR         # S
```

### Position
```bash
bun orca-driver.ts perform GO_TO_BEGINNING             # Ctrl+Home
bun orca-driver.ts perform GO_TO_END                   # Ctrl+End
```

### Mode Switching
```bash
bun orca-driver.ts perform TOGGLE_BROWSE_MODE          # Insert+A
```

### Full command list
```bash
bun orca-driver.ts commands              # list all
bun orca-driver.ts commands heading      # filter
```

## Querying State

```bash
bun orca-driver.ts item-text                      # current focused item (via AT-SPI2)
bun orca-driver.ts transcript                     # full session transcript
bun orca-driver.ts transcript --since 42          # entries after index 42
bun orca-driver.ts transcript --clear             # clear and return
```

## JSON Output

Add `--json` to any command for structured output:

```bash
bun orca-driver.ts next --json
# {"spoken":"Example Domain, heading","name":"Example Domain","role":"heading","state":[],"index":0}
```

## Response Format

Every navigation command returns:
- **spoken** — the text Orca would announce (constructed from AT-SPI2 properties)
- **name** — the element's accessible name
- **role** — the element's role (heading, link, button, etc.)
- **state** — array of states (checked, expanded, etc.)

## WCAG 2.2 AA Audit Methodology

### Phase 1: Orient
1. `start <url>` — launches browser + Orca
2. Walk headings with `perform FIND_NEXT_HEADING`

### Phase 2: Document Structure (1.3.1, 2.4.1, 2.4.6)
- Loop headings with `perform FIND_NEXT_HEADING` — check hierarchy
- Loop landmarks with `perform FIND_NEXT_LANDMARK` — check regions
- Check images with `perform FIND_NEXT_IMAGE` — check alt text

### Phase 3: Forms (1.3.1, 3.3.1, 3.3.2, 4.1.2)
- Tab through fields with `press Tab` — check labels announced
- Use `item-text` to verify focus
- Submit with errors — check error announcements

### Phase 4: Interactive Components (4.1.2, 4.1.3)
- Navigate to custom widgets — is role announced?
- Operate with keyboard (arrows, Enter, Escape)
- Open/close modals — focus management correct?

### Phase 5: Keyboard (2.1.1, 2.1.2)
- `press Tab` through entire page — all elements reachable?
- Look for keyboard traps

### Phase 6: Reading Order (1.3.2)
- Walk with `next` — logical sequence?
- Use `transcript` to review the full reading order

## Architecture

This driver uses three Linux components:

1. **Orca** — GNOME's screen reader, manages browse mode and speech
2. **AT-SPI2** — Linux accessibility API, queried via `orca-atspi.py` Python helper
3. **xdotool/ydotool** — Keyboard simulation (X11/Wayland)

The driver starts Orca, launches a Chromium browser via Playwright, then uses xdotool to send keystrokes (which Orca intercepts in browse mode) and AT-SPI2 to read what element is focused after each action.

## Differences from VoiceOver Driver

| Feature | vo-driver (macOS) | orca-driver (Linux) |
|---------|------------------|-------------------|
| Screen reader | VoiceOver | Orca |
| A11y API | macOS Accessibility | AT-SPI2 via D-Bus |
| Key simulation | AppleScript | xdotool / ydotool |
| Browse mode | VoiceOver Quick Nav | Orca browse mode |
| Default HTTP port | 7483 | 7484 |
| Default CDP port | 9222 | 9223 |

## Headless / Remote Environments

The driver auto-bootstraps in headless environments (Codespaces, Docker, CI):

1. **No DISPLAY?** → Starts Xvfb (virtual X11 framebuffer) automatically
2. **No D-Bus?** → Runs `dbus-launch` automatically
3. **No AT-SPI2?** → Starts `at-spi-bus-launcher` + `at-spi2-registryd` automatically

Just install the packages (`sudo bash orca-setup.sh`) and run normally:
```bash
bun orca-driver.ts start https://example.com   # works in Codespaces
```

All child processes (Xvfb, D-Bus, AT-SPI2) are cleaned up on `stop` or `kill`.

## Troubleshooting

- **Orca won't start**: Check `orca` is installed: `which orca`
- **AT-SPI2 errors**: Ensure bus is running: `systemctl --user status at-spi-dbus-bus`
- **No focused element**: Run `enter` to re-focus the browser
- **xdotool not working**: On Wayland, install `ydotool` instead
- **Daemon won't stop**: Use `kill` to force-terminate
- **Headless check**: Run `bash orca-setup.sh check` to verify all prerequisites
- **Logs**: `/tmp/orca-driver.log`
- **Help**: `bun orca-driver.ts --help`
