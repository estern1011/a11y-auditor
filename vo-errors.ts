/**
 * AI-friendly error translation for VoiceOver operations.
 *
 * Raw errors from guidepup and AppleScript are technical and unhelpful to an
 * agent. This module translates them into actionable messages with concrete
 * suggestions for recovery.
 *
 * Returns VoError (from vo-types.ts) so translated errors slot directly into
 * VoResult without a separate type.
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
    pattern: /unable to move|could not move/i,
    message: "VoiceOver cursor could not move. The display may be asleep, or VoiceOver may not be focused on the browser.",
    suggestion: "Try: enter",
  },
  {
    pattern: /AppleScript timeout|timed out waiting/i,
    message: "VoiceOver is not responding. The display may have gone to sleep.",
    suggestion: "Wake the machine and try: kill then start",
  },
  {
    pattern: /not found in guidepup/i,
    message: (ctx) => `Command '${ctx.command || "unknown"}' is not available in this version of guidepup.`,
    suggestion: "Run: commands [filter] to see available commands",
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
    pattern: /Could not find web content/i,
    message: "Could not locate a web content area. The page may still be loading, or VoiceOver may not be focused on the browser window.",
    suggestion: "Try: enter",
  },
  {
    pattern: /Failed to enter web content/i,
    message: "VoiceOver found web content but could not enter it.",
    suggestion: "Try: perform STOP_INTERACTING then enter",
  },
  {
    pattern: /VoiceOver not running|ERR_VOICE_OVER_NOT_RUNNING/i,
    message: "VoiceOver is not running.",
    suggestion: "Try: kill then start <url>",
  },
  {
    pattern: /Unknown modifier/i,
    message: (ctx) => ctx.key ? `Invalid modifier for key '${ctx.key}'.` : "Invalid key modifier.",
    suggestion: "Valid modifiers: control, option, command, shift",
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
    suggestion: "If VoiceOver is unresponsive, try: kill then start <url>",
  };
}
