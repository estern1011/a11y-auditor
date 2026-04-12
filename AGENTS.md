# Agent Development Guide

This document provides essential information for AI agents working with the a11y-auditor codebase.

## Project Overview

Accessibility auditor combining real screen readers (VoiceOver on macOS, Orca on Linux) with axe-core automated checks for WCAG 2.2 AA compliance testing.

## Prerequisites

- **macOS** for VoiceOver driver, or **Linux** for Orca driver
- **Bun** >= 1.0.0
- **Node.js** >= 18.0.0 (fallback)

## Setup

```bash
# Install dependencies
bun install

# Install Playwright Chromium browser
bunx playwright install chromium

# For macOS: Grant VoiceOver permissions
bunx @guidepup/setup
```

## Development Commands

```bash
# Type check without emitting
bun run typecheck

# Run tests
bun test

# Start VoiceOver driver
bun drivers/voiceover/driver.ts start <url>

# Start Orca driver (Linux)
bun drivers/orca/driver.ts start <url>

# Run axe-core audit
bun audit.ts

# Run with watch mode
bun --watch drivers/voiceover/driver.ts serve
```

## Project Structure

```
drivers/
  voiceover/     # macOS VoiceOver driver
    driver.ts    # CLI entry point
    core.ts      # Core driver logic
    types.ts     # Types and command catalog
    driver.test.ts
  orca/          # Linux Orca driver
    driver.ts    # CLI entry point
    core.ts      # Core driver logic
    atspi.ts     # AT-SPI2 D-Bus client
    speech.ts    # Speech capture
    driver.test.ts
  server.ts      # Shared HTTP server
  types.ts       # Shared types
  errors.ts      # Error translation
  interface.ts   # Driver interface
  driver.ts      # Platform auto-detection entry

platform/
  voiceover.ts   # macOS platform
  orca.ts        # Linux platform
  detect.ts      # Platform detection

skills/
  auditor/       # Full audit methodology skill
  vo-driver/     # VoiceOver driver skill
  orca-driver/   # Orca driver skill

audit.ts         # axe-core automated checks
cli.ts           # Shared CLI utilities
```

## Testing

Tests use Bun's built-in test framework:

```bash
# Run all tests
bun test

# Run specific test file
bun test drivers/voiceover/driver.test.ts

# List tests without running
bun test --listTests
```

## Code Style

- TypeScript with strict mode enabled
- Use explicit return types for public functions
- Prefer `const` and `let` over `var`
- Use async/await for asynchronous code
- Error handling: use `translateError()` from errors.ts for user-friendly messages

## Adding New Commands

1. Add command to `VOICEOVER_COMMANDS` or `ORCA_COMMANDS` in respective types.ts
2. Implement handler in core.ts
3. Update CLI parser in driver.ts if needed
4. Add tests in driver.test.ts
5. Update relevant SKILL.md documentation

## Common Tasks

### Adding a VoiceOver command

```typescript
// In drivers/voiceover/types.ts
FIND_NEXT_TABLE: {
  type: "commander",
  name: "FIND_NEXT_TABLE",
  description: "Navigate to next table"
}
```

### Testing a driver locally

```bash
# Terminal 1: Start the driver
bun drivers/voiceover/driver.ts start https://example.com

# Terminal 2: Test commands
bun drivers/voiceover/driver.ts next
bun drivers/voiceover/driver.ts perform FIND_NEXT_HEADING
bun drivers/voiceover/driver.ts transcript
```

## Troubleshooting

- VoiceOver not responding: `bun drivers/voiceover/driver.ts kill` then restart
- Display went to sleep: Wake machine and restart driver
- Logs: Check `/tmp/vo-driver.log` or `/tmp/orca-driver.log`

## Dependencies

Key dependencies:

- `@guidepup/guidepup` - VoiceOver automation
- `@axe-core/playwright` - Accessibility testing
- `playwright` - Browser automation
- `dbus-native` - Linux D-Bus (Orca driver)

## License

MIT
