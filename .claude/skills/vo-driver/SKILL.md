---
name: vo-driver
description: |
  Drive VoiceOver on macOS to test web accessibility. Use this skill whenever the user asks to test a website with a screen reader, audit accessibility with VoiceOver, check what VoiceOver announces for page elements, navigate a page as a screen reader user would, or compare expected vs actual screen reader output. Also trigger when the user mentions VoiceOver, screen reader testing, a11y testing with real assistive technology, or wants to verify ARIA labels, heading structure, landmark regions, or reading order using actual VoiceOver output. Even if the user just says "test this page with VoiceOver" or "what does a screen reader say for this", use this skill.
---

# VoiceOver Driver Skill

You are an expert screen reader user performing WCAG 2.2 AA accessibility audits via VoiceOver. You drive a real VoiceOver + Chrome session to test pages the way a blind or low-vision user would actually experience them.

All commands run from `~/Development/agent-browser-vo-fork/`.

## Prerequisites

macOS only. Before first use:

1. Enable VoiceOver AppleScript: System Settings > Accessibility > VoiceOver > Open VoiceOver Utility > General > "Allow VoiceOver to be controlled with AppleScript"
2. Run `bunx @guidepup/setup` for TCC permissions
3. Install deps: `cd ~/Development/agent-browser-vo-fork && bun install && bunx playwright install chromium`

## Session Lifecycle

```bash
bun vo-driver.mjs start <url>       # launch daemon + Chrome + VoiceOver + navigate
bun vo-driver.mjs navigate <url>    # go to new URL within session
bun vo-driver.mjs status            # check daemon state
bun vo-driver.mjs stop              # graceful shutdown
bun vo-driver.mjs kill              # force kill (use if stop hangs)
```

## Entering Web Content (do this every time after start/navigate)

VoiceOver starts at the browser chrome level. You MUST drill into the web content:

```bash
bun vo-driver.mjs perform GO_TO_BEGINNING   # top of window
bun vo-driver.mjs next                       # tab bar
bun vo-driver.mjs next                       # toolbar
bun vo-driver.mjs next                       # "...web content" -- look for this
bun vo-driver.mjs perform START_INTERACTING  # VO+Shift+Down -- enter web content
```

Without `START_INTERACTING`, you're stuck on the browser chrome.
Use `STOP_INTERACTING` (VO+Shift+Up) to exit back out.

## Core Navigation

```bash
bun vo-driver.mjs next              # VO+Right -- next item
bun vo-driver.mjs previous          # VO+Left -- previous item
bun vo-driver.mjs perform ACTIVATE  # VO+Space -- click/press current item
bun vo-driver.mjs act               # also VO+Space (alias)
bun vo-driver.mjs press <key> [modifiers]  # send raw keystrokes (see below)
```

### Raw Key Presses

For modal interactions (rotor, dialogs, menus) and Tab-key navigation, use `press`:

```bash
bun vo-driver.mjs press Tab                    # Tab key
bun vo-driver.mjs press Tab shift              # Shift+Tab
bun vo-driver.mjs press Return                 # Enter/Return
bun vo-driver.mjs press Space                  # Space bar
bun vo-driver.mjs press Escape                 # Escape
bun vo-driver.mjs press Left                   # Left arrow
bun vo-driver.mjs press Right                  # Right arrow
bun vo-driver.mjs press Up                     # Up arrow
bun vo-driver.mjs press Down                   # Down arrow
bun vo-driver.mjs press a                      # type letter 'a'
bun vo-driver.mjs press a command              # Cmd+A
```

## Jump-by-Element Commands

These are your primary tools. Each jumps to the next/previous element of that type.

### Headings
```bash
bun vo-driver.mjs perform FIND_NEXT_HEADING            # VO+Cmd+H
bun vo-driver.mjs perform FIND_PREVIOUS_HEADING         # VO+Cmd+Shift+H
bun vo-driver.mjs perform FIND_NEXT_HEADING_SAME_LEVEL  # VO+Cmd+M
bun vo-driver.mjs perform FIND_PREVIOUS_HEADING_SAME_LEVEL
```

### Links
```bash
bun vo-driver.mjs perform FIND_NEXT_LINK                # VO+Cmd+L
bun vo-driver.mjs perform FIND_PREVIOUS_LINK
bun vo-driver.mjs perform FIND_NEXT_VISITED_LINK        # VO+Cmd+V
```

### Buttons
```bash
bun vo-driver.mjs perform FIND_NEXT_BUTTON
bun vo-driver.mjs perform FIND_PREVIOUS_BUTTON
```

### Form Controls
```bash
bun vo-driver.mjs perform FIND_NEXT_CONTROL             # any interactive control
bun vo-driver.mjs perform FIND_PREVIOUS_CONTROL
bun vo-driver.mjs perform FIND_NEXT_TEXT_FIELD           # text inputs specifically
bun vo-driver.mjs perform FIND_NEXT_CHECKBOX
bun vo-driver.mjs perform FIND_NEXT_RADIO_GROUP
```

### Landmarks
```bash
bun vo-driver.mjs perform FIND_NEXT_LANDMARK
bun vo-driver.mjs perform FIND_PREVIOUS_LANDMARK
```

### Images
```bash
bun vo-driver.mjs perform FIND_NEXT_IMAGE               # VO+Cmd+G
bun vo-driver.mjs perform FIND_PREVIOUS_IMAGE
```

### Tables, Lists, Frames
```bash
bun vo-driver.mjs perform FIND_NEXT_TABLE
bun vo-driver.mjs perform FIND_NEXT_LIST
bun vo-driver.mjs perform FIND_NEXT_FRAME               # iframes
bun vo-driver.mjs perform FIND_NEXT_LIVE_REGION          # ARIA live regions
```

### Position
```bash
bun vo-driver.mjs perform GO_TO_BEGINNING
bun vo-driver.mjs perform GO_TO_END
```

## Web Item Rotor (VO+U)

The rotor is VoiceOver's most powerful navigation tool. It presents categorized lists of all elements on the page (headings, links, form controls, landmarks, tables, etc.) so you can see them all at once.

```bash
bun vo-driver.mjs perform OPEN_WEB_ROTOR  # VO+U -- opens the rotor
bun vo-driver.mjs press Left               # switch to previous category
bun vo-driver.mjs press Right              # switch to next category
bun vo-driver.mjs press Down               # move down in list
bun vo-driver.mjs press Up                 # move up in list
bun vo-driver.mjs press Return             # jump to selected item and close rotor
bun vo-driver.mjs press Escape             # close rotor without jumping
```

Use the rotor to quickly audit all headings, all landmarks, all links, etc. in one pass. Arrow keys navigate inside the rotor because it's a modal overlay.

## Reading Commands

```bash
bun vo-driver.mjs perform READ_CURRENT_ITEM  # read what's under the cursor
bun vo-driver.mjs perform READ_ALL           # read from cursor to end
bun vo-driver.mjs perform READ_LINE          # read current line
bun vo-driver.mjs perform READ_WORD          # read current word
bun vo-driver.mjs perform READ_FROM_TOP      # read from beginning to cursor
bun vo-driver.mjs perform READ_LINK_URL      # read the URL of current link
bun vo-driver.mjs perform READ_PAGE_STATS    # page summary (headings, links, etc. counts)
```

## Table Reading

When you land on a table, use `START_INTERACTING` to enter it, then:

```bash
bun vo-driver.mjs perform READ_TABLE_ROW       # read current row
bun vo-driver.mjs perform READ_TABLE_COLUMN     # read current column
bun vo-driver.mjs perform READ_TABLE_HEADER     # read column header
bun vo-driver.mjs perform READ_TABLE_POSITION   # "row 3, column 2"
```

Navigate cells with `next`/`previous` while inside the table.

## Focus Management

```bash
bun vo-driver.mjs perform SYNC_CURSOR_TO_KEYBOARD   # move VO cursor to keyboard focus
bun vo-driver.mjs perform SYNC_KEYBOARD_TO_CURSOR   # move keyboard focus to VO cursor
bun vo-driver.mjs perform DESCRIBE_KEYBOARD_FOCUS    # what has keyboard focus right now?
```

## Navigation Modes

```bash
bun vo-driver.mjs perform TOGGLE_DOM_GROUP_NAV    # switch DOM mode vs group mode
bun vo-driver.mjs perform TOGGLE_QUICK_NAV        # arrow keys navigate without VO modifier
bun vo-driver.mjs perform TOGGLE_SINGLE_KEY_NAV   # h/l/b keys jump to headings/links/buttons
```

## Querying State

```bash
bun vo-driver.mjs last-phrase       # last thing VoiceOver said
bun vo-driver.mjs item-text         # text of currently focused item
bun vo-driver.mjs phrase-log        # full log of everything said this session
```

## Snapshot (automated walk)

```bash
bun vo-driver.mjs snapshot --steps 40
```

Walks forward N steps from current position. Good for getting a quick overview, but always follow up with targeted exploration.

## Complete list of perform commands

```bash
bun vo-driver.mjs commands              # list all
bun vo-driver.mjs commands heading      # filter by keyword
```

---

# WCAG 2.2 AA Audit Methodology

When testing a page, work through these checks systematically. You are simulating an expert screen reader user -- navigate purposefully, not randomly.

## Phase 1: Page Overview

1. Enter web content (START_INTERACTING)
2. `READ_PAGE_STATS` -- get counts of headings, links, form controls, landmarks
3. Quick `snapshot --steps 30` to understand the general reading order

## Phase 2: Document Structure (WCAG 1.3.1, 2.4.1, 2.4.6, 2.4.10)

### Heading Hierarchy (1.3.1, 2.4.6, 2.4.10)
Loop through all headings with `FIND_NEXT_HEADING`. Flag:
- No `<h1>` at all
- Multiple `<h1>` (valid in HTML5 but confusing for screen readers)
- Skipped levels (h1 -> h3 with no h2)
- Headings used purely for visual styling (non-structural)
- Generic/meaningless headings ("Section 1", "Details")
- Important content sections with no heading

### Landmark Regions (1.3.1, 2.4.1)
Loop through all landmarks with `FIND_NEXT_LANDMARK`. Flag:
- No `<main>` landmark
- No `<nav>` landmark for navigation areas
- Content outside any landmark
- Multiple landmarks of the same type without distinct labels (two `<nav>` without aria-label)
- Missing `<header>`, `<footer>`, `<aside>` where appropriate

### Lists (1.3.1)
Check with `FIND_NEXT_LIST`. Flag:
- Groups of related items (nav links, features, steps) not using `<ul>`/`<ol>`

### Tables (1.3.1, 1.3.2)
Check with `FIND_NEXT_TABLE`. Enter with `START_INTERACTING` and use table reading commands. Flag:
- Data tables without `<th>` headers
- Missing `<caption>` or `aria-label` on data tables
- Layout tables (used for positioning, not data)
- Complex tables without proper scope/headers attributes

## Phase 3: Text Alternatives (WCAG 1.1.1, 1.4.5)

### Images
Loop through all images with `FIND_NEXT_IMAGE`. Flag:
- "Unlabeled image" -- missing alt text entirely
- Decorative images NOT hidden (`alt=""` missing, so screen reader reads filename)
- Alt text that's just the filename ("IMG_2034.jpg")
- Alt text that says "image of..." (redundant, screen reader already says "image")
- Informational images with vague alt text ("photo", "icon")
- Complex images (charts, diagrams) without extended description

### Links
Loop through all links with `FIND_NEXT_LINK`. Flag:
- "click here", "read more", "learn more" without context
- Links that only contain an image with no alt text ("link image")
- Adjacent links to the same destination (image + text both linking)
- Links with no text content at all ("link")

### Buttons
Loop through with `FIND_NEXT_BUTTON`. Flag:
- "button" with no label
- Vague labels ("submit", "go", "ok" without context)
- Icon buttons with no accessible name

## Phase 4: Form Accessibility (WCAG 1.3.1, 1.3.5, 2.4.6, 3.3.1, 3.3.2, 4.1.2)

Navigate form controls with `FIND_NEXT_CONTROL`, `FIND_NEXT_TEXT_FIELD`, `FIND_NEXT_CHECKBOX`, `FIND_NEXT_RADIO_GROUP`. Flag:
- Input with no label ("edit text" with no name)
- Input with label not programmatically associated (label present visually but VO doesn't read it)
- Required fields not announced as required
- Input format/constraints not communicated ("Enter date" but format not stated)
- Error messages not associated with their input
- Select/dropdown with no label
- Fieldset/legend missing for radio/checkbox groups
- Autocomplete attributes missing where appropriate (1.3.5)

Test form interaction:
1. Tab through all controls -- check if every field is reachable and labelled
2. Submit a form with errors -- does VO announce the errors? Can you find which field has the error?
3. Check that error messages are announced (via aria-live or focus management)

## Phase 5: Navigation & Wayfinding (WCAG 2.4.1, 2.4.3, 2.4.4, 2.4.5, 2.4.7)

### Skip Links (2.4.1)
- First item should be "Skip to main content" or similar
- Activating it (VO+Space) should move focus past the nav

### Focus Order (2.4.3)
- Tab through the page -- is the order logical?
- Does focus ever jump somewhere unexpected?
- After closing a modal/dialog, does focus return to the trigger?

### Focus Visible (2.4.7)
- This is visual but note if interactive elements are hard to identify via VoiceOver

### Link Purpose (2.4.4)
- Every link's purpose should be clear from its text alone, or from its text + surrounding context
- Check with `READ_LINK_URL` to verify links aren't deceptive

### Multiple Ways (2.4.5)
- Is there more than one way to reach each page? (navigation + search, or navigation + sitemap)

## Phase 6: Interactive Components (WCAG 4.1.2, 4.1.3)

### Custom Widgets
For any non-native interactive component (custom dropdown, accordion, modal, tab panel, carousel):
1. Can you find it with VoiceOver?
2. Is its role announced? ("tab", "dialog", "menu", not just "group" or "text")
3. Is its state announced? ("expanded", "collapsed", "selected", "checked")
4. Can you operate it with keyboard? (arrow keys, Enter, Escape, Space as appropriate)
5. Does it announce state changes? (opening a dropdown should announce it)

### Modals/Dialogs (4.1.2)
1. When opened, does focus move into the dialog?
2. Is it announced as "dialog"?
3. Can you tab through dialog content without escaping to the page behind?
4. Does Escape close it?
5. Does focus return to the trigger after closing?

### Status Messages (4.1.3)
- Are success/error/loading messages announced via aria-live?
- Toast notifications, form submission feedback, loading states

## Phase 7: Keyboard Accessibility (WCAG 2.1.1, 2.1.2)

Use `press Tab` to tab through the page (this tests actual keyboard focus, not just VO cursor):
```bash
bun vo-driver.mjs press Tab              # move to next focusable element
bun vo-driver.mjs press Tab shift        # move to previous focusable element
bun vo-driver.mjs press Return           # activate focused element
bun vo-driver.mjs press Space            # toggle/activate focused element
bun vo-driver.mjs press Escape           # close modal/menu
bun vo-driver.mjs press Down             # arrow navigation in menus/selects
bun vo-driver.mjs press Up               # arrow navigation in menus/selects
```

Check:
- Can every interactive element receive focus via Tab?
- Can every interactive element be activated? (Return or Space)
- Are there keyboard traps? (focus gets stuck in a component, can't Tab out)
- Do custom components support expected keyboard patterns? (arrow keys in menus, Escape to close)
- After `press Tab`, use `DESCRIBE_KEYBOARD_FOCUS` to hear what has focus

## Phase 8: Reading Order & Content (WCAG 1.3.2, 2.4.2)

### Reading Order (1.3.2)
- Walk through the page with `next` -- does the order match the visual layout?
- Is supplementary content (sidebars) read at the right point, not interrupting main content?

### Page Title (2.4.2)
- Check the browser tab text from the initial `GO_TO_BEGINNING` output
- Is it descriptive and unique?

## Reporting

After testing, produce a structured report:

```
## Accessibility Audit: [page URL]

### Critical Issues (WCAG A failures)
- [issue]: [what VoiceOver announced] -> [what it should announce]
  WCAG: [criterion number and name]

### Serious Issues (WCAG AA failures)
- [issue description]
  WCAG: [criterion]

### Moderate Issues
- [issue description]

### Observations
- [things that work well, edge cases, notes]

### Summary
- Total issues: X critical, Y serious, Z moderate
- Most impacted areas: [forms, navigation, images, etc.]
```

## Troubleshooting

- **VoiceOver won't start**: Run `bunx @guidepup/setup` for permissions
- **Daemon won't stop**: Use `bun vo-driver.mjs kill` to force-kill
- **Commands timing out**: VoiceOver can be slow. If repeated timeouts, `kill` and restart
- **Stuck in browser chrome**: Make sure you used `START_INTERACTING` on the web content
- **Logs**: `/tmp/vo-driver.log`
