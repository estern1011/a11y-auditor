# Experiment: chrome-devtools-axi as agent-browser replacement

## Summary

Tested [chrome-devtools-axi](https://github.com/kunchenguid/axi) (v0.1.12) as a
potential replacement for `agent-browser` in the auditor workflow. AXI wraps
[chrome-devtools-mcp](https://www.npmjs.com/package/chrome-devtools-mcp) with an
[AXI](https://axi.md)-compliant CLI optimized for AI agent consumption.

## What AXI does differently

| Principle | Effect on auditor |
|---|---|
| **Combined action+observation** | `fill @ref "text"` returns the updated snapshot inline. No separate `snapshot` call needed after each action. |
| **TOON output format** | ~40% fewer tokens than JSON for structured data |
| **Contextual suggestions** | Every response includes actionable next-step hints |
| **Persistent bridge** | Browser session survives across CLI invocations (no restart overhead) |
| **Accessibility snapshot with uid refs** | Parsed a11y tree with interactive element references (`uid=1_23`) |

## Test results

All tests run against a local HTML page with intentional a11y issues.

### Commands verified working

| Command | Status | Notes |
|---|---|---|
| `open <url>` | Working | Returns page metadata + full a11y snapshot |
| `snapshot` | Working | Captures current page state with uid refs |
| `screenshot <path>` | Working | Saves PNG to disk |
| `fill @uid "text"` | Working | Fills form field, returns updated snapshot |
| `press Tab` | Working | Tab navigation, shows focus movement in snapshot |
| `hover @uid` | Working | Returns updated snapshot |
| `resize W H` | Working | Viewport resize for reflow testing (WCAG 1.4.10) |
| `eval "js"` | Working | JS evaluation, simpler expressions work well |
| `console` | Working | Shows browser console messages with issue detection |
| `network` | Working | Shows network requests with status codes |
| `dialog accept/dismiss` | Available | For handling alert/confirm/prompt |
| `emulate` | Available | Device/network/viewport emulation |
| `lighthouse` | Available | Requires HTTP URL (not file://) |
| `scroll <dir>` | Available | up/down/top/bottom |

### Key observations

1. **Action+observation is the biggest win.** Currently with `agent-browser`:
   ```
   agent-browser --cdp 9222 click @e3    # → minimal confirmation
   agent-browser --cdp 9222 snapshot -i  # → need separate call to see result
   ```
   With AXI:
   ```
   chrome-devtools-axi click @1_3        # → returns full snapshot with changes
   ```
   This halves the tool calls for most interactions.

2. **Console messages flagged a11y issues automatically.** Without running
   axe-core, the console already reported missing autocomplete attributes and
   form field id/name issues.

3. **Network view catches missing resources** (e.g. broken images) which could
   indicate missing alt text situations.

4. **Resize works great for reflow testing.** `resize 320 568` + `screenshot`
   is cleaner than the current `execute` JS approach.

## Architecture fit

### Current: agent-browser connects to vo-driver's CDP

```
vo-driver (owns browser + VO on CDP :9222)
  └─ agent-browser --cdp 9222 <command>   ← connects to existing browser
```

### Proposed: chrome-devtools-axi with two modes

**Mode 1: Standalone (no VoiceOver, any OS)**
```
chrome-devtools-axi open <url>           ← manages its own headless browser
  └─ bridge → chrome-devtools-mcp → Chrome
```

**Mode 2: Attached to vo-driver (macOS with VoiceOver)**
```
vo-driver (owns browser + VO on CDP :9222)
  └─ chrome-devtools-axi <command>       ← bridge uses --browserUrl :9222
```

Mode 2 requires the bridge to pass `--browserUrl http://127.0.0.1:9222` to
chrome-devtools-mcp instead of `--headless --isolated`. This is a one-line
change in `bridge.js` (the `createTransport()` function).

### Bridge configuration needed

The bridge currently hardcodes its chrome-devtools-mcp args. For vo-driver
integration we need environment variable support:

```bash
# Standalone mode (default)
chrome-devtools-axi open https://example.com

# Attached to existing browser
CHROME_DEVTOOLS_AXI_BROWSER_URL=http://127.0.0.1:9222 chrome-devtools-axi snapshot
```

## Command mapping: agent-browser → chrome-devtools-axi

| agent-browser | chrome-devtools-axi | Notes |
|---|---|---|
| `snapshot -i` | `snapshot` | uid refs included by default |
| `click @e3` | `click @uid` | Different ref format (uid= vs @e) |
| `type @e5 "text"` | `fill @uid "text"` | `fill` targets specific element |
| `screenshot` | `screenshot <path>` | Requires explicit path |
| `press Escape` | `press Escape` | Same |
| `hover @ref` | `hover @uid` | Same concept |
| `execute "js"` | `eval "js"` | Renamed |
| N/A | `console` | New: browser console inspection |
| N/A | `network` | New: network request inspection |
| N/A | `resize W H` | New: replaces JS-based viewport changes |
| N/A | `lighthouse` | New: built-in Lighthouse audits |
| N/A | `emulate` | New: device/network emulation |

## Benchmark data (from AXI project)

490 browser automation runs, Claude Sonnet 4.6:

| Tool | Success | Cost/task | Duration | Turns |
|---|---|---|---|---|
| **chrome-devtools-axi** | **100%** | **$0.074** | **21.5s** | **4.5** |
| chrome-devtools-mcp | 100% | $0.091 | 26.0s | 6.2 |
| Playwright MCP | 99% | $0.120 | 36.5s | 7.6 |

## Risks

1. **Ref format change** — `@e3` (agent-browser) vs `@uid` (axi). The auditor
   SKILL.md has ~30 example commands that would need updating.
2. **CDP port handoff** — Not yet tested: connecting axi's bridge to vo-driver's
   browser via `--browserUrl`. Needs validation.
3. **Package maturity** — v0.1.12, relatively new.
4. **Bridge lifecycle** — The persistent bridge is clever but adds a process to
   manage. Current agent-browser is stateless per invocation.

## Recommendation

**Adopt for standalone browser interactions, defer vo-driver integration.**

Phase 1: Use `chrome-devtools-axi` for audits that don't need VoiceOver
(automated checks, visual testing, keyboard nav). Update the auditor skill to
prefer axi commands when VoiceOver isn't active.

Phase 2: Test `--browserUrl` mode for connecting to vo-driver's browser. If it
works, unify on chrome-devtools-axi as the single browser interaction tool.

## Setup

```bash
npm install -g chrome-devtools-axi

# If Chrome isn't in the default location, the bridge needs patching.
# Environment variable support should be upstreamed.
```

Add to CLAUDE.md:
```
Use chrome-devtools-axi for browser automation.
```
