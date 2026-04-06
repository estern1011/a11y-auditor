/**
 * Core VoiceOver operations, state, and browser lifecycle.
 *
 * This module owns the guidepup and Playwright imports. All VoiceOver
 * interactions flow through here. Other modules (server, CLI) import
 * from this module — never from guidepup directly.
 */

import { spawn, spawnSync } from "child_process";
import { writeFileSync, existsSync, unlinkSync } from "fs";
import { voiceOver, VoiceOverCommanderCommands } from "@guidepup/guidepup";
import type { MacOSKeyboardCommand } from "@guidepup/guidepup";
import { chromium } from "playwright";
import type { Page, Browser } from "playwright";
import { translateError, type ErrorContext } from "./vo-errors.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const DEFAULT_PORT = 7483;
export const DEFAULT_CDP_PORT = 9222;
export const LOG_FILE = "/tmp/vo-driver.log";
export const PID_FILE = "/tmp/vo-driver.pid";

export const CLI_TIMEOUT_MS = 30_000;
export const STARTUP_POLL_MS = 200;
export const STARTUP_POLL_MAX = 200;
export const MAX_TRANSCRIPT_ENTRIES = 10_000;
export const MAX_REQUEST_BODY = 1_000_000;

// Delays for VoiceOver to settle after actions (ms)
const VO_SETTLE_MS = 500;
const VO_QUICK_SETTLE_MS = 300;
const VO_PRESS_SETTLE_MS = 600;
const VO_INIT_SETTLE_MS = 1500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function removePidFile() {
  try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch {}
}

// ---------------------------------------------------------------------------
// Command catalog — VoiceOver-standard names
// ---------------------------------------------------------------------------

interface CommandEntry {
  type: "keyboard" | "commander";
  name: string;
}

export const COMMANDS: Record<string, CommandEntry> = {
  FIND_NEXT_HEADING:             { type: "keyboard", name: "findNextHeading" },
  FIND_PREVIOUS_HEADING:         { type: "keyboard", name: "findPreviousHeading" },
  FIND_NEXT_HEADING_SAME_LEVEL:  { type: "keyboard", name: "findNextHeadingOfSameLevel" },
  FIND_PREVIOUS_HEADING_SAME_LEVEL: { type: "keyboard", name: "findPreviousHeadingOfSameLevel" },
  FIND_NEXT_LINK:                { type: "keyboard", name: "findNextLink" },
  FIND_PREVIOUS_LINK:            { type: "keyboard", name: "findPreviousLink" },
  FIND_NEXT_VISITED_LINK:        { type: "keyboard", name: "findNextVisitedLink" },
  FIND_PREVIOUS_VISITED_LINK:    { type: "keyboard", name: "findPreviousVisitedLink" },
  FIND_NEXT_BUTTON:              { type: "commander", name: "FIND_NEXT_BUTTON" },
  FIND_PREVIOUS_BUTTON:          { type: "commander", name: "FIND_PREVIOUS_BUTTON" },
  FIND_NEXT_CONTROL:             { type: "keyboard", name: "findNextControl" },
  FIND_PREVIOUS_CONTROL:         { type: "keyboard", name: "findPreviousControl" },
  FIND_NEXT_TEXT_FIELD:           { type: "commander", name: "FIND_NEXT_TEXT_FIELD" },
  // Note: guidepup has no FIND_PREVIOUS_TEXT_FIELD; FIND_PREVIOUS_FIELD finds any field type
  FIND_PREVIOUS_TEXT_FIELD:       { type: "commander", name: "FIND_PREVIOUS_FIELD" },
  FIND_NEXT_CHECKBOX:            { type: "commander", name: "FIND_NEXT_TICKBOX" },
  FIND_PREVIOUS_CHECKBOX:        { type: "commander", name: "FIND_PREVIOUS_TICKBOX" },
  FIND_NEXT_RADIO_GROUP:         { type: "commander", name: "FIND_NEXT_RADIO_GROUP" },
  // Note: guidepup has no FIND_PREVIOUS_RADIO_GROUP; FIND_PREVIOUS_GROUP finds any group type
  FIND_PREVIOUS_RADIO_GROUP:     { type: "commander", name: "FIND_PREVIOUS_GROUP" },
  FIND_NEXT_TABLE:               { type: "keyboard", name: "findNextTable" },
  FIND_PREVIOUS_TABLE:           { type: "keyboard", name: "findPreviousTable" },
  FIND_NEXT_LIST:                { type: "keyboard", name: "findNextList" },
  FIND_PREVIOUS_LIST:            { type: "keyboard", name: "findPreviousList" },
  FIND_NEXT_LANDMARK:            { type: "commander", name: "FIND_NEXT_LANDMARK" },
  FIND_PREVIOUS_LANDMARK:        { type: "commander", name: "FIND_PREVIOUS_LANDMARK" },
  FIND_NEXT_IMAGE:               { type: "keyboard", name: "findNextGraphic" },
  FIND_PREVIOUS_IMAGE:           { type: "keyboard", name: "findPreviousGraphic" },
  FIND_NEXT_FRAME:               { type: "commander", name: "FIND_NEXT_FRAME" },
  FIND_PREVIOUS_FRAME:           { type: "commander", name: "FIND_PREVIOUS_FRAME" },
  FIND_NEXT_LIVE_REGION:         { type: "commander", name: "FIND_NEXT_LIVE_REGION" },

  GO_TO_BEGINNING:               { type: "commander", name: "GO_TO_BEGINNING" },
  GO_TO_END:                     { type: "commander", name: "GO_TO_END" },

  START_INTERACTING:             { type: "commander", name: "START_INTERACTING_WITH_ITEM" },
  STOP_INTERACTING:              { type: "commander", name: "STOP_INTERACTING_WITH_ITEM" },
  ESCAPE:                        { type: "commander", name: "ESCAPE" },

  OPEN_ROTOR:                    { type: "commander", name: "ROTOR" },
  OPEN_WEB_ROTOR:                { type: "keyboard", name: "openWebItemRotor" },
  ROTOR_UP:                      { type: "commander", name: "MOVE_UP_IN_ROTOR" },
  ROTOR_DOWN:                    { type: "commander", name: "MOVE_DOWN_IN_ROTOR" },
  ROTATE_LEFT:                   { type: "commander", name: "ROTATE_LEFT" },
  ROTATE_RIGHT:                  { type: "commander", name: "ROTATE_RIGHT" },

  READ_CURRENT_ITEM:             { type: "commander", name: "READ_CONTENTS_OF_VOICEOVER_CURSOR" },
  READ_ALL:                      { type: "keyboard", name: "readAllText" },
  READ_LINE:                     { type: "keyboard", name: "readLine" },
  READ_WORD:                     { type: "keyboard", name: "readWord" },
  READ_FROM_TOP:                 { type: "keyboard", name: "readFromBeginningToCurrent" },
  READ_LINK_URL:                 { type: "keyboard", name: "readLinkAddress" },
  READ_PAGE_STATS:               { type: "keyboard", name: "readWebpageStatistics" },

  READ_TABLE_ROW:                { type: "keyboard", name: "readTableRow" },
  READ_TABLE_COLUMN:             { type: "keyboard", name: "readTableColumn" },
  READ_TABLE_HEADER:             { type: "keyboard", name: "readTableColumnHeader" },
  READ_TABLE_POSITION:           { type: "keyboard", name: "readTableRowAndColumnNumbers" },

  SYNC_CURSOR_TO_KEYBOARD:       { type: "keyboard", name: "moveCursorToKeyboardFocus" },
  SYNC_KEYBOARD_TO_CURSOR:       { type: "keyboard", name: "moveKeyboardFocusToCursor" },
  DESCRIBE_KEYBOARD_FOCUS:       { type: "keyboard", name: "describeItemWithKeyboardFocus" },

  TOGGLE_DOM_GROUP_NAV:          { type: "commander", name: "TOGGLE_WEB_NAVIGATION_DOM_OR_GROUP" },
  TOGGLE_QUICK_NAV:              { type: "commander", name: "TOGGLE_QUICK_NAV_ON_OR_OFF" },
  TOGGLE_SINGLE_KEY_NAV:         { type: "commander", name: "TOGGLE_SINGLE_KEY_QUICK_NAV_ON_OR_OFF" },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface VoResponse {
  spoken: string;
  name: string;
  role: string;
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

interface TranscriptEntry extends VoResponse {
  index: number;
}

export const state = {
  voiceoverActive: false,
  currentUrl: null as string | null,
  browser: null as Browser | null,
  page: null as Page | null,
  cdpPort: DEFAULT_CDP_PORT,
  transcript: [] as TranscriptEntry[],
  transcriptIndex: 0,
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export function log(msg: string, err = false) {
  const line = `[${new Date().toISOString()}] [${err ? "ERROR" : "INFO"}] ${msg}\n`;
  try { writeFileSync(LOG_FILE, line, { flag: "a" }); } catch {}
}

// ---------------------------------------------------------------------------
// Response parsing
//
// VoiceOver's itemText is "Name role", e.g. "Example Domain heading level 1".
// We split on known role suffixes. This is heuristic — names containing role
// words (e.g. "Link to button factory") could misparse. For precise role info,
// use the accessibility tree via Playwright instead.
// ---------------------------------------------------------------------------

export const ROLE_PATTERN = new RegExp(
  "\\s+(" + [
    "heading level \\d+",
    "search text field", "text field", "edit text",
    "pop up button", "radio button", "menu item",
    "toolbar item palette", "selected tab, group",
    "web content",
    "link", "button", "checkbox", "tab", "image",
    "group", "list", "table", "dialog",
  ].join("|") + ")$",
  "i"
);

export function parseVoResponse(spoken: string, itemText: string): VoResponse {
  const name = itemText || "";
  let role = "";
  let parsedName = name;

  const m = name.match(ROLE_PATTERN);
  if (m) {
    role = m[1];
    parsedName = name.slice(0, m.index);
  }

  return { spoken, name: parsedName.trim(), role };
}

function recordTranscript(entry: VoResponse): VoResponse {
  const indexed = { ...entry, index: state.transcriptIndex++ };
  state.transcript.push(indexed);
  if (state.transcript.length > MAX_TRANSCRIPT_ENTRIES) {
    state.transcript = state.transcript.slice(-MAX_TRANSCRIPT_ENTRIES);
  }
  return indexed;
}

// ---------------------------------------------------------------------------
// Transcript access
// ---------------------------------------------------------------------------

export function getTranscript(since?: number): TranscriptEntry[] {
  if (since !== undefined) {
    return state.transcript.filter((e) => e.index > since);
  }
  return [...state.transcript];
}

export function clearTranscript(): TranscriptEntry[] {
  const entries = [...state.transcript];
  state.transcript = [];
  return entries;
}

// ---------------------------------------------------------------------------
// AppleScript helpers
// ---------------------------------------------------------------------------

export function runAppleScript(script: string, timeout = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("osascript", ["-e", script]);
    let out = "", err = "";
    proc.stdout.on("data", (d: Buffer) => (out += d));
    proc.stderr.on("data", (d: Buffer) => (err += d));
    const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new Error("AppleScript timeout")); }, timeout);
    proc.on("close", (code: number) => {
      clearTimeout(timer);
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `exit ${code}`));
    });
  });
}

function voAppleScript(voCommand: string, timeout = 5000): Promise<string> {
  return runAppleScript(`tell application "VoiceOver" to ${voCommand}`, timeout);
}

// ---------------------------------------------------------------------------
// VoiceOver operations — read from LogStore (no extra round-trips)
// ---------------------------------------------------------------------------

async function lastFromLog(): Promise<{ spoken: string; itemText: string }> {
  const phrases = await voiceOver.spokenPhraseLog();
  const items = await voiceOver.itemTextLog();
  return {
    spoken: phrases.at(-1) || "",
    itemText: items.at(-1) || "",
  };
}

async function voAction(action: () => Promise<void>): Promise<VoResponse> {
  await action();
  const { spoken, itemText } = await lastFromLog();
  return recordTranscript(parseVoResponse(spoken, itemText));
}

export async function voNext(): Promise<VoResponse> { return voAction(() => voiceOver.next()); }
export async function voPrevious(): Promise<VoResponse> { return voAction(() => voiceOver.previous()); }
export async function voAct(): Promise<VoResponse> { return voAction(() => voiceOver.act()); }

export async function voPerform(commandName: string): Promise<VoResult> {
  const entry = COMMANDS[commandName];
  const ctx: ErrorContext = { command: commandName };
  let command: MacOSKeyboardCommand | VoiceOverCommanderCommands;

  if (entry) {
    if (entry.type === "commander") {
      const cmd = voiceOver.commanderCommands[entry.name as keyof typeof voiceOver.commanderCommands];
      if (!cmd) return translateError(`commander command "${entry.name}" not found in guidepup`, ctx);
      command = cmd;
    } else {
      const cmd = voiceOver.keyboardCommands[entry.name as keyof typeof voiceOver.keyboardCommands];
      if (!cmd) return translateError(`keyboard command "${entry.name}" not found in guidepup`, ctx);
      command = cmd;
    }
  } else {
    const cmd = voiceOver.commanderCommands[commandName as keyof typeof voiceOver.commanderCommands];
    if (!cmd) return translateError(`Unknown command: ${commandName}`, ctx);
    command = cmd;
  }

  try {
    return await voAction(() => voiceOver.perform(command));
  } catch (e) {
    return translateError(e, ctx);
  }
}

// ---------------------------------------------------------------------------
// Enter web content — all raw AppleScript for speed
// ---------------------------------------------------------------------------

export async function voEnter(): Promise<VoResult> {
  // Strategy: exit web content one level at a time until we land on the
  // "web content" container, then re-enter. If that doesn't work, go to
  // the browser window top and walk forward to find it.

  // Step 1: Try exiting up to find the "web content" container.
  // STOP_INTERACTING moves up one containment level each time.
  for (let exit = 0; exit < 5; exit++) {
    try {
      const itemText = await voAppleScript("return text under cursor of vo cursor");
      if (itemText.toLowerCase().includes("web content")) {
        // We're on the web content container — enter it
        await voAppleScript('tell commander to perform command "start interacting with item"');
        await sleep(VO_SETTLE_MS);
        const spoken = await voAppleScript("return content of last phrase").catch(() => "");
        const finalItem = await voAppleScript("return text under cursor of vo cursor").catch(() => "");
        const result = parseVoResponse(spoken, finalItem);
        log(`Entered web content (via exit/re-enter): ${finalItem}`);
        return recordTranscript(result);
      }
      // Check spoken phrase — if it mentions "inside of web content" we're already in
      const spoken = await voAppleScript("return content of last phrase");
      if (spoken.toLowerCase().includes("inside of web content")) {
        const result = parseVoResponse(spoken, itemText);
        log(`Already in web content: ${itemText}`);
        return recordTranscript(result);
      }
    } catch (e) {
      log(`voEnter check ${exit}: ${errorMsg(e)}`);
    }

    // Only exit on iterations 1+ (first iteration just checks current position)
    if (exit > 0) {
      try {
        await voAppleScript('tell commander to perform command "stop interacting with item"');
        await sleep(VO_QUICK_SETTLE_MS);
      } catch (e) {
        log(`voEnter exit ${exit}: ${errorMsg(e)}`);
        break;
      }
    } else {
      // On first iteration, try exiting once to start climbing up
      try {
        await voAppleScript('tell commander to perform command "stop interacting with item"');
        await sleep(VO_QUICK_SETTLE_MS);
      } catch (e) {
        log(`voEnter initial exit: ${errorMsg(e)}`);
        break;
      }
    }
  }

  // Step 2: Climb didn't find it. Go to the very beginning of the window
  // and walk forward. We may need to START_INTERACTING into the window group.
  try {
    await voAppleScript('tell commander to perform command "go to beginning"');
    await sleep(VO_SETTLE_MS);
  } catch (e) {
    log(`voEnter go to beginning: ${errorMsg(e)}`, true);
  }

  // If GO_TO_BEGINNING landed on the window group, enter it
  try {
    const itemText = await voAppleScript("return text under cursor of vo cursor");
    if (itemText.toLowerCase().includes("group") || itemText.toLowerCase().includes("chrome")) {
      await voAppleScript('tell commander to perform command "start interacting with item"');
      await sleep(VO_QUICK_SETTLE_MS);
    }
  } catch (e) {
    log(`voEnter interact-window: ${errorMsg(e)}`);
  }

  for (let i = 0; i < 15; i++) {
    let itemText = "";
    try {
      itemText = await voAppleScript("return text under cursor of vo cursor", 3000);
    } catch (e) {
      log(`voEnter read item ${i}: ${errorMsg(e)}`);
    }

    if (itemText.toLowerCase().includes("web content")) {
      try {
        await voAppleScript('tell commander to perform command "start interacting with item"');
        await sleep(VO_SETTLE_MS);
      } catch (e) {
        log(`voEnter interact: ${errorMsg(e)}`, true);
        return translateError("Failed to enter web content: " + errorMsg(e));
      }
      const spoken = await voAppleScript("return content of last phrase").catch(() => "");
      const finalItem = await voAppleScript("return text under cursor of vo cursor").catch(() => "");
      const result = parseVoResponse(spoken, finalItem);
      log(`Entered web content: ${finalItem}`);
      return recordTranscript(result);
    }

    try {
      await voAppleScript("tell vo cursor to move right");
      await sleep(VO_QUICK_SETTLE_MS);
    } catch (e) {
      log(`voEnter move ${i}: ${errorMsg(e)}`, true);
      break;
    }
  }

  return translateError("Could not find web content area");
}

// ---------------------------------------------------------------------------
// Press — raw keystrokes via AppleScript
// ---------------------------------------------------------------------------

export const KEY_CODES: Record<string, number> = {
  Return: 36, Enter: 36, Space: 49, Escape: 53, Tab: 48,
  Left: 123, Right: 124, Down: 125, Up: 126,
  Delete: 51, Backspace: 51, Home: 115, End: 119,
  PageUp: 116, PageDown: 121,
};

export const VALID_MODIFIERS: Record<string, string> = {
  control: "control down",
  option: "option down",
  command: "command down",
  shift: "shift down",
};

export async function voPress(key: string, modifiers: string[] = []): Promise<VoResult> {
  const unknown = modifiers.filter((m) => !VALID_MODIFIERS[m]);
  if (unknown.length > 0) {
    return {
      error: `Unknown modifier(s): ${unknown.join(", ")}. Valid: ${Object.keys(VALID_MODIFIERS).join(", ")}`,
    };
  }

  const modStr = modifiers.map((m) => VALID_MODIFIERS[m]).join(", ");
  const usingClause = modStr ? ` using {${modStr}}` : "";
  const code = KEY_CODES[key];

  const script = code !== undefined
    ? `tell application "System Events" to key code ${code}${usingClause}`
    : `tell application "System Events" to keystroke "${key}"${usingClause}`;

  try {
    await runAppleScript(script);
    await sleep(VO_PRESS_SETTLE_MS);
    const spoken = await voAppleScript("return content of last phrase").catch(() => "");
    return recordTranscript({ spoken, name: spoken, role: "" });
  } catch (e) {
    return translateError(e, { key });
  }
}

// ---------------------------------------------------------------------------
// Browser + VoiceOver lifecycle
// ---------------------------------------------------------------------------

function detectBrowserApp(): string {
  try {
    const result = spawnSync("osascript", ["-e",
      'tell application "System Events" to get name of every process whose name contains "Chrome"']);
    const names = result.stdout.toString().trim().split(", ");
    return names.find((n) => n.includes("Testing"))
      || names.find((n) => n.includes("Chrome") || n.includes("Chromium"))
      || "Google Chrome for Testing";
  } catch {
    return "Google Chrome for Testing";
  }
}

let browserAppName: string | null = null;

async function focusBrowser() {
  if (!browserAppName) browserAppName = detectBrowserApp();
  try {
    spawnSync("osascript", ["-e", `tell application "${browserAppName}" to activate`]);
    await sleep(VO_SETTLE_MS);
    if (state.page) {
      await state.page.bringToFront();
      await sleep(VO_QUICK_SETTLE_MS);
      await state.page.click("body", { force: true });
      await sleep(VO_QUICK_SETTLE_MS);
    }
  } catch (e) { log(`focus warning: ${errorMsg(e)}`); }
}

export async function initialize(url: string | null, cdpPort: number) {
  state.cdpPort = cdpPort;

  state.browser = await chromium.launch({
    headless: false,
    args: [`--remote-debugging-port=${cdpPort}`],
  });
  const ctx = await state.browser.newContext();
  state.page = await ctx.newPage();

  if (url) {
    await state.page.goto(url, { waitUntil: "load" });
    state.currentUrl = url;
  }

  await voiceOver.start();
  state.voiceoverActive = true;
  log("VoiceOver started");

  // Max out speech rate for faster phrase capture
  try {
    spawnSync("defaults", ["write",
      "com.apple.VoiceOver4/default",
      "SCRCategories_SCRCategorySystemWide_SCRSpeechLanguages_default_SCRSpeechComponentSettings_SCRRateAsPercent",
      "-int", "100"]);
    log("Speech rate set to 100");
  } catch (e) { log(`speech rate warning: ${errorMsg(e)}`, true); }

  await sleep(VO_INIT_SETTLE_MS);
  await focusBrowser();
  log("Browser focused");
}

export async function navigate(url: string): Promise<VoResult> {
  if (!state.page) return translateError("No page");
  await state.page.goto(url, { waitUntil: "load" });
  state.currentUrl = url;
  await focusBrowser();

  try {
    return await voEnter();
  } catch (e) {
    log(`navigate enter: ${errorMsg(e)}`, true);
    return { spoken: "", name: "", role: "" };
  }
}

export async function cleanup() {
  try {
    if (state.browser) { await state.browser.close(); state.browser = null; }
  } catch (e) { log(`browser close: ${errorMsg(e)}`, true); }

  try {
    if (state.voiceoverActive) { await voiceOver.stop(); state.voiceoverActive = false; }
  } catch (e) {
    log(`guidepup stop: ${errorMsg(e)}`, true);
    try { spawnSync("osascript", ["-e", 'tell application "VoiceOver" to quit']); } catch {}
    state.voiceoverActive = false;
  }

  state.page = null;
  state.currentUrl = null;
}

export async function getItemText(): Promise<VoResponse> {
  const itemText = await voiceOver.itemText();
  return parseVoResponse("", itemText);
}
