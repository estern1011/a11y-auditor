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
import { translateError, type ErrorContext } from "./errors.ts";
import {
  type VoResponse, type VoError, type VoResult, type TranscriptEntry,
  isVoError, parseVoResponse, VOICEOVER_COMMANDS, KEY_CODES, VOICEOVER_MODIFIERS,
} from "./types.ts";

// Re-export types surface so consumers can import from vo-core alone
export type { VoResponse, VoError, VoResult, TranscriptEntry } from "./types.ts";
export {
  isVoError, parseVoResponse, STATE_KEYWORDS, ROLE_PATTERN,
  VOICEOVER_COMMANDS, KEY_CODES, VOICEOVER_MODIFIERS,
} from "./types.ts";

// Backward compat aliases
export const COMMANDS = VOICEOVER_COMMANDS;
export const VALID_MODIFIERS = VOICEOVER_MODIFIERS;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const DEFAULT_PORT = 7483;
export const DEFAULT_CDP_PORT = 9222;
export const LOG_FILE = "/tmp/vo-driver.log";
export const PID_FILE = "/tmp/vo-driver.pid";
export const VO_STATE_FILE = "/tmp/vo-driver-state.json";

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
// Operation lock — serializes all VoiceOver operations
//
// VoiceOver is a single global resource. Concurrent requests would cause
// log entries to be attributed to the wrong command. Every exported function
// that touches VoiceOver must go through withLock().
// ---------------------------------------------------------------------------

let operationLock: Promise<void> = Promise.resolve();
let shuttingDown = false;

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (shuttingDown) return Promise.reject(new Error("Driver is shutting down"));
  const prev = operationLock;
  const { promise, resolve } = Promise.withResolvers<void>();
  operationLock = promise;
  return prev.then(fn).finally(resolve);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function errorMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function removePidFile() {
  try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch {}
  try { if (existsSync(VO_STATE_FILE)) unlinkSync(VO_STATE_FILE); } catch {}
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface DriverState {
  voiceoverActive: boolean;
  weStartedVoiceOver: boolean;
  currentUrl: string | null;
  browser: Browser | null;
  page: Page | null;
  cdpPort: number;
  transcript: TranscriptEntry[];
  transcriptIndex: number;
  originalSpeechRate: string | null;
}

const state: DriverState = {
  voiceoverActive: false,
  weStartedVoiceOver: false,
  currentUrl: null,
  browser: null,
  page: null,
  cdpPort: DEFAULT_CDP_PORT,
  transcript: [],
  transcriptIndex: 0,
  originalSpeechRate: null,
};

// --- State accessors (no direct mutation from outside vo-core) ---

export function getPage(): Page | null { return state.page; }
export function getStatus(): { voiceoverActive: boolean; currentUrl: string | null; cdpPort: number } {
  return { voiceoverActive: state.voiceoverActive, currentUrl: state.currentUrl, cdpPort: state.cdpPort };
}
export function getTranscriptLength(): number { return state.transcript.length; }

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export function log(msg: string, err = false) {
  const line = `[${new Date().toISOString()}] [${err ? "ERROR" : "INFO"}] ${msg}\n`;
  try { writeFileSync(LOG_FILE, line, { flag: "a" }); } catch {}
}

function recordTranscript(entry: VoResponse): TranscriptEntry {
  const indexed: TranscriptEntry = { ...entry, index: state.transcriptIndex++ };
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
    let settled = false;
    proc.stdout.on("data", (d: Buffer) => (out += d));
    proc.stderr.on("data", (d: Buffer) => (err += d));
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(new Error("AppleScript timeout"));
    }, timeout);
    proc.on("close", (code: number) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
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

async function voAction(action: () => Promise<void>): Promise<TranscriptEntry> {
  await action();
  const { spoken, itemText } = await lastFromLog();
  return recordTranscript(parseVoResponse(spoken, itemText));
}

function lockedVoAction(action: () => Promise<void>): Promise<VoResult> {
  return withLock(async () => {
    try { return await voAction(action); }
    catch (e) { return translateError(e); }
  });
}

export function voNext(): Promise<VoResult> { return lockedVoAction(() => voiceOver.next()); }
export function voPrevious(): Promise<VoResult> { return lockedVoAction(() => voiceOver.previous()); }
export function voAct(): Promise<VoResult> { return lockedVoAction(() => voiceOver.act()); }

export async function voPerform(commandName: string): Promise<VoResult> {
  return withLock(async () => {
    const entry = COMMANDS[commandName];
    const ctx: ErrorContext = { command: commandName };
    let command: MacOSKeyboardCommand | VoiceOverCommanderCommands;

    try {
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

      return await voAction(() => voiceOver.perform(command));
    } catch (e) {
      return translateError(e, ctx);
    }
  });
}

// ---------------------------------------------------------------------------
// Enter web content — all raw AppleScript for speed
// ---------------------------------------------------------------------------

export async function voEnter(): Promise<VoResult> {
  return withLock(_voEnterInner);
}

async function _voEnterInner(): Promise<VoResult> {
  // Two strategies in sequence:
  // 1. Climb up VoiceOver's containment hierarchy to find and re-enter web content
  // 2. Tab-walk through browser chrome into the page, then sync VO cursor
  return await _tryExitReenter() ?? await _tryTabWalk() ?? translateError("Could not find web content area");
}

/** Climb VO containment levels via STOP_INTERACTING until we hit the web content container, then START_INTERACTING. */
async function _tryExitReenter(): Promise<VoResult | null> {
  for (let exit = 0; exit < 5; exit++) {
    try {
      const itemText = await voAppleScript("return text under cursor of vo cursor");
      if (itemText.toLowerCase().includes("web content")) {
        await voAppleScript('tell commander to perform command "start interacting with item"');
        await sleep(VO_SETTLE_MS);
        const spoken = await voAppleScript("return content of last phrase").catch(() => "");
        const finalItem = await voAppleScript("return text under cursor of vo cursor").catch(() => "");
        const result = parseVoResponse(spoken, finalItem);
        log(`Entered web content (via exit/re-enter): ${finalItem}`);
        return recordTranscript(result);
      }
      const spoken = await voAppleScript("return content of last phrase");
      if (spoken.toLowerCase().includes("inside of web content")) {
        const result = parseVoResponse(spoken, itemText);
        log(`Already in web content: ${itemText}`);
        return recordTranscript(result);
      }
    } catch (e) {
      log(`voEnter check ${exit}: ${errorMsg(e)}`);
    }

    try {
      await voAppleScript('tell commander to perform command "stop interacting with item"');
      await sleep(VO_QUICK_SETTLE_MS);
    } catch (e) {
      log(`voEnter exit ${exit}: ${errorMsg(e)}`);
      break;
    }
  }
  return null;
}

/** Tab through browser chrome into page content, syncing VO cursor each step. */
async function _tryTabWalk(): Promise<VoResult | null> {
  await focusBrowser();

  for (let i = 0; i < 20; i++) {
    try {
      await runAppleScript('tell application "System Events" to key code 48'); // Tab
      await sleep(VO_QUICK_SETTLE_MS);
      // Sync VO cursor to keyboard focus so we read the right element
      await voAppleScript('tell commander to perform command "move voiceover cursor to keyboard focus"');
      await sleep(VO_QUICK_SETTLE_MS);
      const itemText = await voAppleScript("return text under cursor of vo cursor");
      const lower = itemText.toLowerCase();
      if (lower.includes("link") || lower.includes("heading") ||
          lower.includes("web content") || lower.includes("banner") ||
          lower.includes("main") || lower.includes("navigation")) {
        const spoken = await voAppleScript("return content of last phrase").catch(() => "");
        const result = parseVoResponse(spoken, itemText);
        log(`Entered web content (via Tab fallback): ${itemText}`);
        return recordTranscript(result);
      }
    } catch (e) {
      log(`voEnter tab ${i}: ${errorMsg(e)}`);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Press — raw keystrokes via AppleScript
// ---------------------------------------------------------------------------

export async function voPress(key: string, modifiers: string[] = []): Promise<VoResult> {
  return withLock(async () => {
    const unknown = modifiers.filter((m) => !VALID_MODIFIERS[m]);
    if (unknown.length > 0) {
      return translateError(`Unknown modifier(s): ${unknown.join(", ")}`, { key });
    }

    const modStr = modifiers.map((m) => VALID_MODIFIERS[m]).join(", ");
    const usingClause = modStr ? ` using {${modStr}}` : "";
    const code = KEY_CODES[key];

    let script: string;
    if (code !== undefined) {
      script = `tell application "System Events" to key code ${code}${usingClause}`;
    } else if (key.length === 1) {
      const escaped = key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      script = `tell application "System Events" to keystroke "${escaped}"${usingClause}`;
    } else {
      return translateError(`Unknown key: "${key}". Use a named key (Return, Tab, etc.) or a single character.`, { key });
    }

    try {
      await runAppleScript(script);
      await sleep(VO_PRESS_SETTLE_MS);
      const spoken = await voAppleScript("return content of last phrase").catch(() => "");
      const itemText = await voAppleScript("return text under cursor of vo cursor").catch(() => "");
      return recordTranscript(parseVoResponse(spoken, itemText));
    } catch (e) {
      return translateError(e, { key });
    }
  });
}

// ---------------------------------------------------------------------------
// Browser + VoiceOver lifecycle
// ---------------------------------------------------------------------------

const PLAYWRIGHT_BROWSER_APP = "Google Chrome for Testing";

function detectBrowserApp(): string {
  // Prefer the known Playwright-bundled browser. Only fall back to process
  // scanning if it isn't running — avoids grabbing the user's personal Chrome.
  try {
    const check = spawnSync("osascript", ["-e",
      `tell application "System Events" to get name of every process whose name is "${PLAYWRIGHT_BROWSER_APP}"`]);
    const names = check.stdout.toString().trim();
    if (names.includes(PLAYWRIGHT_BROWSER_APP)) return PLAYWRIGHT_BROWSER_APP;
  } catch {}

  try {
    const result = spawnSync("osascript", ["-e",
      'tell application "System Events" to get name of every process whose name contains "Chrome"']);
    const names = result.stdout.toString().trim().split(", ");
    return names.find((n) => n.includes("Testing"))
      || names.find((n) => n.includes("Chrome") || n.includes("Chromium"))
      || PLAYWRIGHT_BROWSER_APP;
  } catch {
    return PLAYWRIGHT_BROWSER_APP;
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

export const SPEECH_RATE_KEY = "SCRCategories_SCRCategorySystemWide_SCRSpeechLanguages_default_SCRSpeechComponentSettings_SCRRateAsPercent";

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

  try {
    await voiceOver.start();
    state.weStartedVoiceOver = true;
  } catch (e) {
    // VoiceOver failed to start — close the browser we just launched
    try { await state.browser.close(); } catch {}
    state.browser = null;
    state.page = null;
    throw e;
  }
  state.voiceoverActive = true;
  log("VoiceOver started");

  // Save original speech rate before overwriting
  try {
    const current = spawnSync("defaults", ["read", "com.apple.VoiceOver4/default", SPEECH_RATE_KEY]);
    const val = current.stdout.toString().trim();
    if (val && current.status === 0) {
      state.originalSpeechRate = val;
      log(`Saved original speech rate: ${val}`);
    }
  } catch {}

  // Persist state so CLI kill command can restore speech rate and check VO ownership
  try {
    writeFileSync(VO_STATE_FILE, JSON.stringify({
      weStartedVoiceOver: true,
      originalSpeechRate: state.originalSpeechRate,
    }));
  } catch {}

  // Max out speech rate for faster phrase capture
  try {
    spawnSync("defaults", ["write", "com.apple.VoiceOver4/default", SPEECH_RATE_KEY, "-int", "100"]);
    log("Speech rate set to 100");
  } catch (e) { log(`speech rate warning: ${errorMsg(e)}`, true); }

  await sleep(VO_INIT_SETTLE_MS);
  await focusBrowser();
  log("Browser focused");
}

export async function navigate(url: string): Promise<VoResult> {
  return withLock(async () => {
    try {
      if (!state.page) return translateError("No page");
      await state.page.goto(url, { waitUntil: "load" });
      state.currentUrl = url;
      await focusBrowser();
      return await _voEnterInner();
    } catch (e) {
      return translateError(e, { url });
    }
  });
}

export async function cleanup() {
  // Reject new operations, then wait for any in-flight one to finish
  shuttingDown = true;
  await operationLock;

  // Restore original speech rate before stopping VoiceOver
  if (state.originalSpeechRate !== null) {
    try {
      spawnSync("defaults", ["write", "com.apple.VoiceOver4/default",
        SPEECH_RATE_KEY, "-int", state.originalSpeechRate]);
      log(`Restored speech rate to ${state.originalSpeechRate}`);
    } catch (e) { log(`speech rate restore: ${errorMsg(e)}`, true); }
    state.originalSpeechRate = null;
  }

  try {
    if (state.browser) { await state.browser.close(); state.browser = null; }
  } catch (e) { log(`browser close: ${errorMsg(e)}`, true); }

  try {
    if (state.voiceoverActive && state.weStartedVoiceOver) {
      await voiceOver.stop();
      state.voiceoverActive = false;
    }
  } catch (e) {
    log(`guidepup stop: ${errorMsg(e)}`, true);
    if (state.weStartedVoiceOver) {
      try { spawnSync("osascript", ["-e", 'tell application "VoiceOver" to quit']); } catch {}
    }
    state.voiceoverActive = false;
  }

  state.page = null;
  state.currentUrl = null;
}

/** Read the current VO cursor item. Does not record to transcript (read-only query, not a navigation). */
export async function getItemText(): Promise<VoResult> {
  return withLock(async () => {
    try {
      const itemText = await voiceOver.itemText();
      return parseVoResponse("", itemText);
    } catch (e) {
      return translateError(e);
    }
  });
}
