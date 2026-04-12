---
name: orca-driver
description: |
  Drive the Orca screen reader on Linux to test web accessibility. Use this skill whenever the user asks to test a website with a screen reader on Linux, audit accessibility with Orca, check what Orca announces for page elements, navigate a page as a screen reader user would on a Linux desktop, or compare expected vs actual screen reader output on Linux. Also trigger when the user mentions Orca, Linux screen reader testing, AT-SPI2, a11y testing with real assistive technology on Linux, or wants to verify ARIA labels, heading structure, landmark regions, or reading order using actual Orca output.
---

# Orca Driver Skill (Linux)

You are an expert screen reader user performing WCAG 2.2 AA accessibility audits via Orca on Linux. You drive a real Orca + Chromium session to test pages the way a blind or low-vision Linux user would actually experience them.

All commands run from the `a11y-auditor` project directory.

## Prerequisites

Ubuntu/Debian Linux (desktop or virtual — Codespaces, Docker, sprites.dev all work). Before first use:

```bash
sudo bash drivers/orca/setup.sh              # install all system deps
bash drivers/orca/setup.sh check             # verify everything is ready
bun install && bunx playwright install chromium
```

The driver auto-detects virtual desktop environments and starts Xvfb + openbox + D-Bus + AT-SPI2 automatically.

## Session Lifecycle

```bash
bun drivers/orca/driver.ts start <url>           # launch browser + Orca + CDP on :9223
bun drivers/orca/driver.ts start <url> --cdp-port 9333  # custom CDP port
bun drivers/orca/driver.ts navigate <url>        # go to new URL
bun drivers/orca/driver.ts status                # check daemon state + CDP port
bun drivers/orca/driver.ts stop                  # graceful shutdown
bun drivers/orca/driver.ts kill                  # force kill (use if stop hangs)
```

`start` automatically focuses the browser and enters browse mode. If Orca loses focus, use `enter` to re-focus:

```bash
bun drivers/orca/driver.ts enter                 # re-focus browser for Orca
```

## CDP — Sharing the Browser

orca-driver exposes a Chrome DevTools Protocol port so other tools can connect to the same browser:

```bash
bun drivers/orca/driver.ts start https://app.com
# → Ready. CDP available on ws://127.0.0.1:9223

agent-browser --cdp 9223 snapshot -i    # connect agent-browser to same browser
```

## Core Navigation

```bash
bun drivers/orca/driver.ts next              # Down — next item in browse mode
bun drivers/orca/driver.ts previous          # Up — previous item in browse mode
bun drivers/orca/driver.ts act               # Enter — activate current item
bun drivers/orca/driver.ts press <key> [modifiers...]  # raw keystroke
```

### Raw Key Presses

```bash
bun drivers/orca/driver.ts press Tab                    # Tab key
bun drivers/orca/driver.ts press Tab shift              # Shift+Tab
bun drivers/orca/driver.ts press Return                 # Enter/Return
bun drivers/orca/driver.ts press Space                  # Space bar
bun drivers/orca/driver.ts press Escape                 # Escape
bun drivers/orca/driver.ts press Left                   # Left arrow
bun drivers/orca/driver.ts press Right                  # Right arrow
bun drivers/orca/driver.ts press Up                     # Up arrow
bun drivers/orca/driver.ts press Down                   # Down arrow
```

Valid modifiers: `control`, `shift`, `alt`, `super`

## Orca Browse-Mode Commands (perform)

Orca uses single-key navigation in browse mode. Use `perform` with these command names.

### Heading Navigation
```bash
bun drivers/orca/driver.ts perform FIND_NEXT_HEADING           # H
bun drivers/orca/driver.ts perform FIND_PREVIOUS_HEADING       # Shift+H
bun drivers/orca/driver.ts perform FIND_NEXT_HEADING_1         # 1
bun drivers/orca/driver.ts perform FIND_NEXT_HEADING_2         # 2
bun drivers/orca/driver.ts perform FIND_NEXT_HEADING_3         # 3
# ... through FIND_NEXT_HEADING_6
```

### Link Navigation
```bash
bun drivers/orca/driver.ts perform FIND_NEXT_LINK              # K
bun drivers/orca/driver.ts perform FIND_PREVIOUS_LINK          # Shift+K
bun drivers/orca/driver.ts perform FIND_NEXT_UNVISITED_LINK    # U
bun drivers/orca/driver.ts perform FIND_NEXT_VISITED_LINK      # V
```

### Element Navigation
```bash
bun drivers/orca/driver.ts perform FIND_NEXT_BUTTON            # B
bun drivers/orca/driver.ts perform FIND_PREVIOUS_BUTTON        # Shift+B
bun drivers/orca/driver.ts perform FIND_NEXT_CONTROL           # F (form field)
bun drivers/orca/driver.ts perform FIND_NEXT_ENTRY             # E (text entry)
bun drivers/orca/driver.ts perform FIND_NEXT_CHECKBOX          # X
bun drivers/orca/driver.ts perform FIND_NEXT_COMBO_BOX         # C
bun drivers/orca/driver.ts perform FIND_NEXT_RADIO_BUTTON      # R
bun drivers/orca/driver.ts perform FIND_NEXT_TABLE             # T
bun drivers/orca/driver.ts perform FIND_NEXT_LIST              # L
bun drivers/orca/driver.ts perform FIND_NEXT_LANDMARK          # M
bun drivers/orca/driver.ts perform FIND_NEXT_IMAGE             # G
bun drivers/orca/driver.ts perform FIND_NEXT_BLOCKQUOTE        # Q
bun drivers/orca/driver.ts perform FIND_NEXT_PARAGRAPH         # P
bun drivers/orca/driver.ts perform FIND_NEXT_SEPARATOR         # S
```

### Position
```bash
bun drivers/orca/driver.ts perform GO_TO_BEGINNING             # Ctrl+Home
bun drivers/orca/driver.ts perform GO_TO_END                   # Ctrl+End
```

### Full command list
```bash
bun drivers/orca/driver.ts commands              # list all
bun drivers/orca/driver.ts commands heading      # filter
```

## Querying State

```bash
bun drivers/orca/driver.ts item-text                      # current focused item
bun drivers/orca/driver.ts transcript                     # full session transcript
bun drivers/orca/driver.ts transcript --since 42          # entries after index 42
bun drivers/orca/driver.ts transcript --clear             # clear and return
```

## JSON Output

Add `--json` to any command for structured output:

```bash
bun drivers/orca/driver.ts next --json
# {"spoken":"Introduction heading 2","name":"Introduction","role":"heading","state":["focused"],"index":5}
```

## Response Format

Every navigation command returns:
- **spoken** — what Orca announced (raw screen reader output)
- **name** — the element's accessible name (from AT-SPI2)
- **role** — the element's role (from AT-SPI2)
- **state** — interesting states (focused, checked, expanded, etc.)

The `spoken` field is Orca's actual speech output — it reflects what a real screen reader user would hear. The agent should interpret this directly rather than relying only on the structured fields.

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

The driver runs Orca on a virtual Linux desktop (Xvfb + openbox) and captures its output:

1. **Orca** — GNOME's screen reader. Manages browse mode, structural navigation, speech.
2. **AT-SPI2 D-Bus** — Queries the accessibility tree and injects keyboard events through the `DeviceEventController`. Keys go through the same AT-SPI2 pipeline that physical keyboard events use, so Orca intercepts them properly (xdotool/XTEST bypasses this pipeline and doesn't work).
3. **Speech capture** — `orca-customizations.py` hook that monkey-patches `SpeechServer._speak` to log all speech to a file. This captures what Orca would say aloud.
4. **Playwright** — Browser lifecycle and axe-core audit execution.

## Differences from VoiceOver Driver

| Feature | vo-driver (macOS) | orca-driver (Linux) |
|---------|------------------|-------------------|
| Screen reader | VoiceOver | Orca |
| A11y API | macOS Accessibility | AT-SPI2 via D-Bus |
| Key injection | AppleScript | AT-SPI2 GenerateKeyboardEvent |
| Speech capture | guidepup spokenPhraseLog | orca-customizations.py hook |
| Browse mode | VoiceOver Quick Nav | Orca structural navigation |
| Default HTTP port | 7483 | 7484 |
| Default CDP port | 9222 | 9223 |

## Virtual Desktop Environments

The driver auto-bootstraps everything in virtual environments:

1. **No DISPLAY?** → Starts Xvfb on :99
2. **No window manager?** → Starts openbox (required for X11 focus)
3. **No D-Bus?** → Runs `dbus-launch`
4. **No AT-SPI2?** → Starts `at-spi-bus-launcher` + `at-spi2-registryd`
5. **No audio?** → Starts PulseAudio with null sink
6. **Chrome window?** → Launched maximized (`--start-maximized`)

```bash
bun drivers/orca/driver.ts start https://example.com   # works in Codespaces / sprites.dev
```

## Troubleshooting

- **Orca won't start**: Check `orca` is installed: `which orca`
- **No speech output**: Ensure `~/.local/share/orca/orca-customizations.py` exists
- **No focused element**: Run `enter` to re-focus the browser
- **Keys not working**: Keys are injected via AT-SPI2 D-Bus, not xdotool
- **Daemon won't stop**: Use `kill` to force-terminate
- **Setup check**: Run `bash drivers/orca/setup.sh check`
- **Logs**: `/tmp/orca-driver.log`
