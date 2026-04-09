/**
 * Types, constants, and parsing for Orca screen reader output on Linux.
 *
 * Parallel to vo-types.ts. Reuses VoResponse/VoError/VoResult from vo-types
 * so the HTTP API and CLI are identical. Defines Orca-specific command mappings
 * (browse-mode single-key shortcuts instead of VoiceOver commander commands).
 *
 * This module has ZERO runtime dependencies.
 */

// Re-export shared response types from vo-types
export type {
  VoResponse, VoError, VoResult,
  StatusResponse, TranscriptEntry, TranscriptResponse,
  ClearTranscriptResponse, CommandsResponse, StopResponse,
} from "./vo-types.ts";
export { isVoError } from "./vo-types.ts";

// ---------------------------------------------------------------------------
// Orca command catalog — browse-mode keyboard shortcuts
//
// Orca uses single-key navigation in browse mode (similar to NVDA).
// The Orca modifier key is Insert (or CapsLock if configured).
// ---------------------------------------------------------------------------

export interface OrcaCommandEntry {
  key: string;
  modifiers?: string[];
  settle?: number;   // override settle time (ms)
}

export const ORCA_COMMANDS: Record<string, OrcaCommandEntry> = {
  // Heading navigation (H key in browse mode)
  FIND_NEXT_HEADING:             { key: "h" },
  FIND_PREVIOUS_HEADING:         { key: "h", modifiers: ["shift"] },
  FIND_NEXT_HEADING_1:           { key: "1" },
  FIND_PREVIOUS_HEADING_1:       { key: "1", modifiers: ["shift"] },
  FIND_NEXT_HEADING_2:           { key: "2" },
  FIND_PREVIOUS_HEADING_2:       { key: "2", modifiers: ["shift"] },
  FIND_NEXT_HEADING_3:           { key: "3" },
  FIND_PREVIOUS_HEADING_3:       { key: "3", modifiers: ["shift"] },
  FIND_NEXT_HEADING_4:           { key: "4" },
  FIND_PREVIOUS_HEADING_4:       { key: "4", modifiers: ["shift"] },
  FIND_NEXT_HEADING_5:           { key: "5" },
  FIND_PREVIOUS_HEADING_5:       { key: "5", modifiers: ["shift"] },
  FIND_NEXT_HEADING_6:           { key: "6" },
  FIND_PREVIOUS_HEADING_6:       { key: "6", modifiers: ["shift"] },

  // Link navigation
  FIND_NEXT_LINK:                { key: "k" },
  FIND_PREVIOUS_LINK:            { key: "k", modifiers: ["shift"] },
  FIND_NEXT_UNVISITED_LINK:      { key: "u" },
  FIND_PREVIOUS_UNVISITED_LINK:  { key: "u", modifiers: ["shift"] },
  FIND_NEXT_VISITED_LINK:        { key: "v" },
  FIND_PREVIOUS_VISITED_LINK:    { key: "v", modifiers: ["shift"] },

  // Button navigation
  FIND_NEXT_BUTTON:              { key: "b" },
  FIND_PREVIOUS_BUTTON:          { key: "b", modifiers: ["shift"] },

  // Form controls
  FIND_NEXT_CONTROL:             { key: "f" },    // form field
  FIND_PREVIOUS_CONTROL:         { key: "f", modifiers: ["shift"] },
  FIND_NEXT_ENTRY:               { key: "e" },    // text entry specifically
  FIND_PREVIOUS_ENTRY:           { key: "e", modifiers: ["shift"] },
  FIND_NEXT_CHECKBOX:            { key: "x" },
  FIND_PREVIOUS_CHECKBOX:        { key: "x", modifiers: ["shift"] },
  FIND_NEXT_COMBO_BOX:           { key: "c" },
  FIND_PREVIOUS_COMBO_BOX:       { key: "c", modifiers: ["shift"] },
  FIND_NEXT_RADIO_BUTTON:        { key: "r" },
  FIND_PREVIOUS_RADIO_BUTTON:    { key: "r", modifiers: ["shift"] },

  // Table navigation
  FIND_NEXT_TABLE:               { key: "t" },
  FIND_PREVIOUS_TABLE:           { key: "t", modifiers: ["shift"] },

  // List navigation
  FIND_NEXT_LIST:                { key: "l" },
  FIND_PREVIOUS_LIST:            { key: "l", modifiers: ["shift"] },
  FIND_NEXT_LIST_ITEM:           { key: "i" },
  FIND_PREVIOUS_LIST_ITEM:       { key: "i", modifiers: ["shift"] },

  // Landmark / region navigation
  FIND_NEXT_LANDMARK:            { key: "m" },
  FIND_PREVIOUS_LANDMARK:        { key: "m", modifiers: ["shift"] },

  // Image navigation
  FIND_NEXT_IMAGE:               { key: "g" },
  FIND_PREVIOUS_IMAGE:           { key: "g", modifiers: ["shift"] },

  // Block quote
  FIND_NEXT_BLOCKQUOTE:          { key: "q" },
  FIND_PREVIOUS_BLOCKQUOTE:      { key: "q", modifiers: ["shift"] },

  // Separator
  FIND_NEXT_SEPARATOR:           { key: "s" },
  FIND_PREVIOUS_SEPARATOR:       { key: "s", modifiers: ["shift"] },

  // Paragraph
  FIND_NEXT_PARAGRAPH:           { key: "p" },
  FIND_PREVIOUS_PARAGRAPH:       { key: "p", modifiers: ["shift"] },

  // Anchor (id target)
  FIND_NEXT_ANCHOR:              { key: "a" },
  FIND_PREVIOUS_ANCHOR:          { key: "a", modifiers: ["shift"] },

  // Position
  GO_TO_BEGINNING:               { key: "Home", modifiers: ["control"] },
  GO_TO_END:                     { key: "End", modifiers: ["control"] },

  // Orca reading commands (Insert + key)
  READ_CURRENT_LINE:             { key: "8", modifiers: ["super"], settle: 600 },   // Insert+8 (numpad)
  SAY_ALL:                       { key: "semicolon", modifiers: ["super"], settle: 1000 },

  // Toggle browse/focus mode
  TOGGLE_BROWSE_MODE:            { key: "a", modifiers: ["super"] },

  // Escape
  ESCAPE:                        { key: "Escape" },
};

// ---------------------------------------------------------------------------
// Orca response parsing
//
// AT-SPI2 returns structured data (name, role, state array) so parsing is
// simpler than VoiceOver (which mixes everything into a single string).
// We still construct a VoResponse for API compatibility.
// ---------------------------------------------------------------------------

import type { VoResponse } from "./vo-types.ts";

export function parseOrcaResponse(
  spoken: string,
  name: string,
  role: string,
  atspiState: string[],
): VoResponse {
  return {
    spoken: spoken || buildSpokenText(name, role, atspiState),
    name: name || "",
    role: role || "",
    state: atspiState || [],
  };
}

function buildSpokenText(name: string, role: string, state: string[]): string {
  const parts: string[] = [];
  if (name) parts.push(name);
  if (role) parts.push(role);
  if (state.length > 0) parts.push(...state);
  return parts.join(", ");
}
