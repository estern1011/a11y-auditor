/**
 * Shared types, constants, and parsing for the Orca driver.
 *
 * Zero runtime dependencies — no Playwright, no Node built-ins. Importable
 * by tests without pulling in heavy native modules.
 */

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface VoResponse {
  spoken: string;
  name: string;
  role: string;
  state: string[];
  index?: number;
}

export interface VoError {
  error: string;
  suggestion?: string;
}

export type VoResult = VoResponse | VoError;

export function isVoError(r: VoResult): r is VoError {
  return "error" in r;
}

// ---------------------------------------------------------------------------
// Server/CLI shared endpoint types
// ---------------------------------------------------------------------------

export interface StatusResponse {
  status: string;
  screenReaderActive: boolean;
  currentUrl: string | null;
  cdpPort: number;
}

export interface TranscriptEntry extends VoResponse {
  index: number;
}

export interface TranscriptResponse {
  entries: TranscriptEntry[];
  length: number;
}

export interface ClearTranscriptResponse {
  cleared: number;
}

export interface CommandsResponse {
  commands: string[];
}

export interface StopResponse {
  success: boolean;
}

// ---------------------------------------------------------------------------
// Orca command catalog — browse-mode keyboard shortcuts
// ---------------------------------------------------------------------------

export interface OrcaCommandEntry {
  key: string;
  modifiers?: string[];
  settle?: number;
}

export const ORCA_COMMANDS: Record<string, OrcaCommandEntry> = {
  FIND_NEXT_HEADING: { key: "h" },
  FIND_PREVIOUS_HEADING: { key: "h", modifiers: ["shift"] },
  FIND_NEXT_HEADING_1: { key: "1" },
  FIND_PREVIOUS_HEADING_1: { key: "1", modifiers: ["shift"] },
  FIND_NEXT_HEADING_2: { key: "2" },
  FIND_PREVIOUS_HEADING_2: { key: "2", modifiers: ["shift"] },
  FIND_NEXT_HEADING_3: { key: "3" },
  FIND_PREVIOUS_HEADING_3: { key: "3", modifiers: ["shift"] },
  FIND_NEXT_HEADING_4: { key: "4" },
  FIND_PREVIOUS_HEADING_4: { key: "4", modifiers: ["shift"] },
  FIND_NEXT_HEADING_5: { key: "5" },
  FIND_PREVIOUS_HEADING_5: { key: "5", modifiers: ["shift"] },
  FIND_NEXT_HEADING_6: { key: "6" },
  FIND_PREVIOUS_HEADING_6: { key: "6", modifiers: ["shift"] },
  FIND_NEXT_LINK: { key: "k" },
  FIND_PREVIOUS_LINK: { key: "k", modifiers: ["shift"] },
  FIND_NEXT_UNVISITED_LINK: { key: "u" },
  FIND_PREVIOUS_UNVISITED_LINK: { key: "u", modifiers: ["shift"] },
  FIND_NEXT_VISITED_LINK: { key: "v" },
  FIND_PREVIOUS_VISITED_LINK: { key: "v", modifiers: ["shift"] },
  FIND_NEXT_BUTTON: { key: "b" },
  FIND_PREVIOUS_BUTTON: { key: "b", modifiers: ["shift"] },
  FIND_NEXT_CONTROL: { key: "f" },
  FIND_PREVIOUS_CONTROL: { key: "f", modifiers: ["shift"] },
  FIND_NEXT_ENTRY: { key: "e" },
  FIND_PREVIOUS_ENTRY: { key: "e", modifiers: ["shift"] },
  FIND_NEXT_CHECKBOX: { key: "x" },
  FIND_PREVIOUS_CHECKBOX: { key: "x", modifiers: ["shift"] },
  FIND_NEXT_COMBO_BOX: { key: "c" },
  FIND_PREVIOUS_COMBO_BOX: { key: "c", modifiers: ["shift"] },
  FIND_NEXT_RADIO_BUTTON: { key: "r" },
  FIND_PREVIOUS_RADIO_BUTTON: { key: "r", modifiers: ["shift"] },
  FIND_NEXT_TABLE: { key: "t" },
  FIND_PREVIOUS_TABLE: { key: "t", modifiers: ["shift"] },
  FIND_NEXT_LIST: { key: "l" },
  FIND_PREVIOUS_LIST: { key: "l", modifiers: ["shift"] },
  FIND_NEXT_LIST_ITEM: { key: "i" },
  FIND_PREVIOUS_LIST_ITEM: { key: "i", modifiers: ["shift"] },
  FIND_NEXT_LANDMARK: { key: "m" },
  FIND_PREVIOUS_LANDMARK: { key: "m", modifiers: ["shift"] },
  FIND_NEXT_IMAGE: { key: "g" },
  FIND_PREVIOUS_IMAGE: { key: "g", modifiers: ["shift"] },
  FIND_NEXT_BLOCKQUOTE: { key: "q" },
  FIND_PREVIOUS_BLOCKQUOTE: { key: "q", modifiers: ["shift"] },
  FIND_NEXT_SEPARATOR: { key: "s" },
  FIND_PREVIOUS_SEPARATOR: { key: "s", modifiers: ["shift"] },
  FIND_NEXT_PARAGRAPH: { key: "p" },
  FIND_PREVIOUS_PARAGRAPH: { key: "p", modifiers: ["shift"] },
  FIND_NEXT_ANCHOR: { key: "a" },
  FIND_PREVIOUS_ANCHOR: { key: "a", modifiers: ["shift"] },
  GO_TO_BEGINNING: { key: "Home", modifiers: ["control"] },
  GO_TO_END: { key: "End", modifiers: ["control"] },
  READ_CURRENT_LINE: { key: "8", modifiers: ["super"], settle: 600 },
  // Single-char ";" (keysym 0x3b via charCodeAt) — the AT-SPI key injector
  // only accepts KEYSYM_MAP entries or single characters, so the literal
  // "semicolon" string would throw "Unknown key".
  SAY_ALL: { key: ";", modifiers: ["super"], settle: 1000 },
  TOGGLE_BROWSE_MODE: { key: "a", modifiers: ["super"] },
  ESCAPE: { key: "Escape" },
};

// ---------------------------------------------------------------------------
// Orca response parsing (AT-SPI2 returns structured data)
// ---------------------------------------------------------------------------

export function parseOrcaResponse(
  spoken: string,
  name: string,
  role: string,
  atspiState: string[],
): VoResponse {
  return {
    spoken: spoken || [name, role, ...atspiState].filter(Boolean).join(", "),
    name: name || "",
    role: role || "",
    state: atspiState || [],
  };
}
