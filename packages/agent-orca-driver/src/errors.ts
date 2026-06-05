/**
 * AI-friendly error translation for Orca operations.
 *
 * Raw errors from AT-SPI2 / Orca / xdotool are unhelpful to an agent. This
 * translates them into actionable messages with concrete recovery hints.
 */

import type { VoError } from "./types.js";

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
    pattern: /Unknown command/i,
    message: (ctx) => `Unknown command: ${ctx.command || "unknown"}.`,
    suggestion: "Hit GET /commands to see available commands",
  },
  {
    pattern: /No page/i,
    message: "No browser page is open.",
    suggestion: "Start the daemon with: agent-orca-driver start <url>",
  },
  {
    pattern: /Unknown modifier/i,
    message: (ctx) =>
      ctx.key ? `Invalid modifier for key '${ctx.key}'.` : "Invalid key modifier.",
    suggestion: "Valid modifiers: control, shift, alt, super",
  },
  {
    pattern: /AT-SPI2.*not found|gir1\.2-atspi/i,
    message: "AT-SPI2 bindings are not installed.",
    suggestion: "Run: agent-orca-driver setup",
  },
  {
    pattern: /Cannot connect to AT-SPI2|at-spi2-core/i,
    message: "Cannot connect to the AT-SPI2 accessibility bus.",
    suggestion: "Ensure at-spi2-core is running (agent-orca-driver doctor)",
  },
  {
    pattern: /No focused element/i,
    message: "No focused element found via AT-SPI2.",
    suggestion: "Try POST /enter to refocus into the web area",
  },
  {
    pattern: /AT-SPI2 query timeout/i,
    message: "AT-SPI2 query timed out.",
    suggestion: "Stop and restart the daemon: agent-orca-driver stop && start <url>",
  },
  {
    pattern: /xdotool|ydotool|keyboard tool/i,
    message: "No keyboard simulation tool available.",
    suggestion: "Install xdotool (agent-orca-driver setup)",
  },
  {
    pattern: /orca.*not.*install|orca.*failed.*start/i,
    message: "Orca screen reader is not installed or failed to start.",
    suggestion: "Run: agent-orca-driver setup",
  },
  {
    pattern: /Orca not running|ERR_ORCA_NOT_RUNNING/i,
    message: "Orca screen reader is not running.",
    suggestion: "Stop and restart the daemon: agent-orca-driver stop && start <url>",
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
    suggestion: "If Orca is unresponsive, run: agent-orca-driver stop && start <url>",
  };
}
