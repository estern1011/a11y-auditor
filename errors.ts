/**
 * AI-friendly error translation for screen reader operations.
 *
 * Raw errors from guidepup, AppleScript, AT-SPI2, and Orca are technical
 * and unhelpful to an agent. This module translates them into actionable
 * messages with concrete suggestions for recovery.
 */

import type { VoError } from "./types.ts";

interface ErrorPattern {
  pattern: RegExp;
  message: string | ((ctx: ErrorContext) => string);
  suggestion: string;
  platform?: "macos" | "linux";
}

export interface ErrorContext {
  command?: string;
  key?: string;
  url?: string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  // --- Shared ---
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
    suggestion: "Valid modifiers: control, shift, alt/option, super/command",
  },

  // --- macOS / VoiceOver ---
  {
    pattern: /unable to move|could not move/i,
    message: "VoiceOver cursor could not move.",
    suggestion: "Try: enter",
    platform: "macos",
  },
  {
    pattern: /AppleScript timeout|timed out waiting/i,
    message: "VoiceOver is not responding. The display may have gone to sleep.",
    suggestion: "Wake the machine and try: kill then start",
    platform: "macos",
  },
  {
    pattern: /not found in guidepup/i,
    message: (ctx) => `Command '${ctx.command || "unknown"}' is not available in guidepup.`,
    suggestion: "Run: commands [filter] to see available commands",
    platform: "macos",
  },
  {
    pattern: /Could not find web content/i,
    message: "Could not locate a web content area.",
    suggestion: "Try: enter",
    platform: "macos",
  },
  {
    pattern: /Failed to enter web content/i,
    message: "VoiceOver found web content but could not enter it.",
    suggestion: "Try: perform STOP_INTERACTING then enter",
    platform: "macos",
  },
  {
    pattern: /VoiceOver not running|ERR_VOICE_OVER_NOT_RUNNING/i,
    message: "VoiceOver is not running.",
    suggestion: "Try: kill then start <url>",
    platform: "macos",
  },

  // --- Linux / Orca ---
  {
    pattern: /AT-SPI2.*not found|gir1\.2-atspi/i,
    message: "AT-SPI2 bindings are not installed.",
    suggestion: "Install: sudo apt install at-spi2-core",
    platform: "linux",
  },
  {
    pattern: /Cannot connect to AT-SPI2|at-spi2-core/i,
    message: "Cannot connect to the AT-SPI2 accessibility bus.",
    suggestion: "Ensure at-spi2-core is running",
    platform: "linux",
  },
  {
    pattern: /No focused element/i,
    message: "No focused element found via AT-SPI2.",
    suggestion: "Try: enter",
    platform: "linux",
  },
  {
    pattern: /AT-SPI2 query timeout/i,
    message: "AT-SPI2 query timed out.",
    suggestion: "Try: kill then start <url>",
    platform: "linux",
  },
  {
    pattern: /xdotool|ydotool|keyboard tool/i,
    message: "No keyboard simulation tool available.",
    suggestion: "Install xdotool: sudo apt install xdotool",
    platform: "linux",
  },
  {
    pattern: /orca.*not.*install|orca.*failed.*start/i,
    message: "Orca screen reader is not installed or failed to start.",
    suggestion: "Install: sudo apt install orca",
    platform: "linux",
  },
  {
    pattern: /Orca not running|ERR_ORCA_NOT_RUNNING/i,
    message: "Orca screen reader is not running.",
    suggestion: "Try: kill then start <url>",
    platform: "linux",
  },
];

export function translateError(
  err: unknown,
  context: ErrorContext = {},
  platform?: "macos" | "linux",
): VoError {
  const raw = err instanceof Error ? err.message : String(err);

  for (const { pattern, message, suggestion, platform: p } of ERROR_PATTERNS) {
    if (p && platform && p !== platform) continue;
    if (pattern.test(raw)) {
      const msg = typeof message === "function" ? message(context) : message;
      return { error: msg, suggestion };
    }
  }

  const screenReader = platform === "linux" ? "Orca" : "the screen reader";
  return {
    error: raw,
    suggestion: `If ${screenReader} is unresponsive, try: kill then start <url>`,
  };
}
