/**
 * AI-friendly error translation for Orca/Linux screen reader operations.
 *
 * Parallel to vo-errors.ts — translates raw errors from AT-SPI2, xdotool,
 * and Orca into actionable messages with recovery suggestions.
 */

import type { VoError } from "./vo-types.ts";

interface ErrorPattern {
  pattern: RegExp;
  message: string | ((ctx: ErrorContext) => string);
  suggestion: string;
}

export interface ErrorContext {
  command?: string;
  key?: string;
  url?: string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    pattern: /AT-SPI2.*not found|gir1\.2-atspi/i,
    message: "AT-SPI2 Python bindings are not installed.",
    suggestion: "Install: sudo apt install python3-gi gir1.2-atspi-2.0",
  },
  {
    pattern: /Cannot connect to AT-SPI2|at-spi2-core/i,
    message: "Cannot connect to the AT-SPI2 accessibility bus.",
    suggestion: "Ensure at-spi2-core is running. Try: systemctl --user start at-spi-dbus-bus",
  },
  {
    pattern: /No focused element/i,
    message: "No focused element found via AT-SPI2. The browser may not have focus.",
    suggestion: "Try: enter",
  },
  {
    pattern: /AT-SPI2 query timeout/i,
    message: "AT-SPI2 query timed out. The accessibility bus may be unresponsive.",
    suggestion: "Try: kill then start <url>",
  },
  {
    pattern: /xdotool|ydotool|keyboard tool/i,
    message: "No keyboard simulation tool available.",
    suggestion: "Install xdotool (X11): sudo apt install xdotool — or ydotool (Wayland): sudo apt install ydotool",
  },
  {
    pattern: /orca.*not.*install|orca.*failed.*start/i,
    message: "Orca screen reader is not installed or failed to start.",
    suggestion: "Install: sudo apt install orca — then try: start <url>",
  },
  {
    pattern: /Unknown command/i,
    message: (ctx) => `Unknown command: ${ctx.command || "unknown"}.`,
    suggestion: "Run: commands [filter] to see available commands",
  },
  {
    pattern: /No page/i,
    message: "No browser page is open.",
    suggestion: "Run: start <url> to launch a browser session",
  },
  {
    pattern: /Unknown modifier/i,
    message: (ctx) => ctx.key ? `Invalid modifier for key '${ctx.key}'.` : "Invalid key modifier.",
    suggestion: "Valid modifiers: control, shift, alt, super",
  },
  {
    pattern: /Orca not running|ERR_ORCA_NOT_RUNNING/i,
    message: "Orca screen reader is not running.",
    suggestion: "Try: kill then start <url>",
  },
];

export function translateError(err: unknown, context: ErrorContext = {}): VoError {
  const raw = err instanceof Error ? err.message : String(err);

  for (const { pattern, message, suggestion } of ERROR_PATTERNS) {
    if (pattern.test(raw)) {
      const msg = typeof message === "function" ? message(context) : message;
      return { error: msg, suggestion };
    }
  }

  return {
    error: raw,
    suggestion: "If Orca is unresponsive, try: kill then start <url>",
  };
}
