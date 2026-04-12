/**
 * Shared types, constants, and parsing for screen reader driver output.
 *
 * This module has ZERO runtime dependencies — no guidepup, no Playwright,
 * no Node built-ins. It can be imported by tests without pulling in heavy
 * native modules.
 *
 * Both VoiceOver (macOS) and Orca (Linux) drivers produce the same
 * VoResponse/VoError shapes so the HTTP API and CLI are identical.
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
  voiceoverActive: boolean; // kept for HTTP API backward compat
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
// VoiceOver command catalog
// ---------------------------------------------------------------------------

export interface CommandEntry {
  type: "keyboard" | "commander";
  name: string;
}

export const VOICEOVER_COMMANDS: Record<string, CommandEntry> = {
  FIND_NEXT_HEADING: { type: "keyboard", name: "findNextHeading" },
  FIND_PREVIOUS_HEADING: { type: "keyboard", name: "findPreviousHeading" },
  FIND_NEXT_HEADING_SAME_LEVEL: { type: "keyboard", name: "findNextHeadingOfSameLevel" },
  FIND_PREVIOUS_HEADING_SAME_LEVEL: { type: "keyboard", name: "findPreviousHeadingOfSameLevel" },
  FIND_NEXT_LINK: { type: "keyboard", name: "findNextLink" },
  FIND_PREVIOUS_LINK: { type: "keyboard", name: "findPreviousLink" },
  FIND_NEXT_VISITED_LINK: { type: "keyboard", name: "findNextVisitedLink" },
  FIND_PREVIOUS_VISITED_LINK: { type: "keyboard", name: "findPreviousVisitedLink" },
  FIND_NEXT_BUTTON: { type: "commander", name: "FIND_NEXT_BUTTON" },
  FIND_PREVIOUS_BUTTON: { type: "commander", name: "FIND_PREVIOUS_BUTTON" },
  FIND_NEXT_CONTROL: { type: "keyboard", name: "findNextControl" },
  FIND_PREVIOUS_CONTROL: { type: "keyboard", name: "findPreviousControl" },
  FIND_NEXT_TABLE: { type: "keyboard", name: "findNextTable" },
  FIND_PREVIOUS_TABLE: { type: "keyboard", name: "findPreviousTable" },
  FIND_NEXT_LIST: { type: "keyboard", name: "findNextList" },
  FIND_PREVIOUS_LIST: { type: "keyboard", name: "findPreviousList" },
  FIND_NEXT_LANDMARK: { type: "commander", name: "FIND_NEXT_LANDMARK" },
  FIND_PREVIOUS_LANDMARK: { type: "commander", name: "FIND_PREVIOUS_LANDMARK" },
  FIND_NEXT_IMAGE: { type: "keyboard", name: "findNextGraphic" },
  FIND_PREVIOUS_IMAGE: { type: "keyboard", name: "findPreviousGraphic" },
  FIND_NEXT_FRAME: { type: "commander", name: "FIND_NEXT_FRAME" },
  FIND_PREVIOUS_FRAME: { type: "commander", name: "FIND_PREVIOUS_FRAME" },
  GO_TO_BEGINNING: { type: "commander", name: "GO_TO_BEGINNING" },
  GO_TO_END: { type: "commander", name: "GO_TO_END" },
  START_INTERACTING: { type: "commander", name: "START_INTERACTING_WITH_ITEM" },
  STOP_INTERACTING: { type: "commander", name: "STOP_INTERACTING_WITH_ITEM" },
  ESCAPE: { type: "commander", name: "ESCAPE" },
  OPEN_ROTOR: { type: "commander", name: "ROTOR" },
  OPEN_WEB_ROTOR: { type: "keyboard", name: "openWebItemRotor" },
  ROTOR_UP: { type: "commander", name: "MOVE_UP_IN_ROTOR" },
  ROTOR_DOWN: { type: "commander", name: "MOVE_DOWN_IN_ROTOR" },
  ROTATE_LEFT: { type: "commander", name: "ROTATE_LEFT" },
  ROTATE_RIGHT: { type: "commander", name: "ROTATE_RIGHT" },
  READ_CURRENT_ITEM: { type: "commander", name: "READ_CONTENTS_OF_VOICEOVER_CURSOR" },
  READ_ALL: { type: "keyboard", name: "readAllText" },
  READ_LINE: { type: "keyboard", name: "readLine" },
  READ_WORD: { type: "keyboard", name: "readWord" },
  READ_FROM_TOP: { type: "keyboard", name: "readFromBeginningToCurrent" },
  READ_LINK_URL: { type: "keyboard", name: "readLinkAddress" },
  READ_PAGE_STATS: { type: "keyboard", name: "readWebpageStatistics" },
  READ_TABLE_ROW: { type: "keyboard", name: "readTableRow" },
  READ_TABLE_COLUMN: { type: "keyboard", name: "readTableColumn" },
  READ_TABLE_HEADER: { type: "keyboard", name: "readTableColumnHeader" },
  READ_TABLE_POSITION: { type: "keyboard", name: "readTableRowAndColumnNumbers" },
  SYNC_CURSOR_TO_KEYBOARD: { type: "keyboard", name: "moveCursorToKeyboardFocus" },
  SYNC_KEYBOARD_TO_CURSOR: { type: "keyboard", name: "moveKeyboardFocusToCursor" },
  DESCRIBE_KEYBOARD_FOCUS: { type: "keyboard", name: "describeItemWithKeyboardFocus" },
  TOGGLE_DOM_GROUP_NAV: { type: "commander", name: "TOGGLE_WEB_NAVIGATION_DOM_OR_GROUP" },
  TOGGLE_QUICK_NAV: { type: "commander", name: "TOGGLE_QUICK_NAV_ON_OR_OFF" },
  TOGGLE_SINGLE_KEY_NAV: { type: "commander", name: "TOGGLE_SINGLE_KEY_QUICK_NAV_ON_OR_OFF" },
};

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
  SAY_ALL: { key: "semicolon", modifiers: ["super"], settle: 1000 },
  TOGGLE_BROWSE_MODE: { key: "a", modifiers: ["super"] },
  ESCAPE: { key: "Escape" },
};

// ---------------------------------------------------------------------------
// VoiceOver key codes and modifiers (macOS AppleScript)
// ---------------------------------------------------------------------------

export const KEY_CODES: Record<string, number> = {
  Return: 36,
  Enter: 36,
  Space: 49,
  Escape: 53,
  Tab: 48,
  Left: 123,
  Right: 124,
  Down: 125,
  Up: 126,
  Delete: 51,
  Backspace: 51,
  Home: 115,
  End: 119,
  PageUp: 116,
  PageDown: 121,
  F1: 122,
  F2: 120,
  F3: 99,
  F4: 118,
  F5: 96,
  F6: 97,
  F7: 98,
  F8: 100,
  F9: 101,
  F10: 109,
  F11: 103,
  F12: 111,
};

export const VOICEOVER_MODIFIERS: Record<string, string> = {
  control: "control down",
  option: "option down",
  command: "command down",
  shift: "shift down",
};

// ---------------------------------------------------------------------------
// VoiceOver response parsing
// ---------------------------------------------------------------------------

export const STATE_KEYWORDS: readonly string[] = [
  "not selected",
  "has popup",
  "checked",
  "unchecked",
  "expanded",
  "collapsed",
  "selected",
  "dimmed",
  "required",
  "visited",
];

const STATE_PATTERN_SRC = ",?\\s*(" + STATE_KEYWORDS.join("|") + ")(?=\\s|,|$)";

export const ROLE_PATTERN = new RegExp(
  "\\s+(" +
    [
      "heading level \\d+",
      "search text field",
      "text field",
      "edit text",
      "pop up button",
      "radio button",
      "menu item",
      "toolbar item palette",
      "selected tab, group",
      "web content",
      "link",
      "button",
      "checkbox",
      "tab",
      "image",
      "group",
      "list",
      "table",
      "dialog",
    ].join("|") +
    ")$",
  "i",
);

export function parseVoResponse(spoken: string, itemText: string): VoResponse {
  let text = itemText || "";
  const state: string[] = [];
  const statePattern = new RegExp(STATE_PATTERN_SRC, "gi");

  let match: RegExpExecArray | null;
  while ((match = statePattern.exec(text)) !== null) {
    state.push(match[1].toLowerCase());
  }
  if (state.length > 0) {
    text = text
      .replace(statePattern, "")
      .replace(/,\s*,/g, ",")
      .replace(/^\s*,\s*/, "")
      .replace(/,\s*$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  let role = "";
  let parsedName = text;
  const m = ROLE_PATTERN.exec(text);
  if (m) {
    role = m[1];
    parsedName = text.slice(0, m.index);
  }
  parsedName = parsedName.replace(/,\s*$/, "").trim();

  return { spoken, name: parsedName, role, state };
}

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
