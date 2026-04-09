/**
 * Core Orca screen reader operations, state, and browser lifecycle for Linux.
 *
 * This is the Linux counterpart to vo-core.ts. It uses:
 * - Orca screen reader (GNOME's built-in AT)
 * - AT-SPI2 via a Python helper (orca-atspi.py) to read the a11y tree
 * - xdotool for keyboard simulation
 * - Playwright for browser management (same as VoiceOver driver)
 *
 * Other modules (server, CLI) import from here — never from AT-SPI2 directly.
 */

import { spawn, spawnSync, execSync } from "child_process";
import { writeFileSync, existsSync, unlinkSync } from "fs";
import { chromium } from "playwright";
import type { Page, Browser } from "playwright";
import { translateError, type ErrorContext } from "./orca-errors.ts";
import {
  type VoResponse, type VoError, type VoResult, type TranscriptEntry,
  isVoError, parseOrcaResponse, ORCA_COMMANDS,
} from "./orca-types.ts";

// Re-export orca-types surface so consumers can import from orca-core alone
export type { VoResponse, VoError, VoResult, TranscriptEntry } from "./vo-types.ts";
export { isVoError, parseOrcaResponse, ORCA_COMMANDS } from "./orca-types.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const DEFAULT_PORT = 7484;       // different from vo-driver to allow co-existence
export const DEFAULT_CDP_PORT = 9223;   // different from vo-driver
export const LOG_FILE = "/tmp/orca-driver.log";
export const PID_FILE = "/tmp/orca-driver.pid";
export const ORCA_STATE_FILE = "/tmp/orca-driver-state.json";

export const CLI_TIMEOUT_MS = 30_000;
export const STARTUP_POLL_MS = 200;
export const STARTUP_POLL_MAX = 200;
export const MAX_TRANSCRIPT_ENTRIES = 10_000;
export const MAX_REQUEST_BODY = 1_000_000;

// Delays for Orca to settle after actions (ms)
const ORCA_SETTLE_MS = 400;
const ORCA_QUICK_SETTLE_MS = 250;
const ORCA_PRESS_SETTLE_MS = 500;
const ORCA_INIT_SETTLE_MS = 2000;

// Path to our AT-SPI2 helper
const ATSPI_HELPER = new URL("./orca-atspi.py", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Operation lock — serializes all Orca operations
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
  try { if (existsSync(ORCA_STATE_FILE)) unlinkSync(ORCA_STATE_FILE); } catch {}
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface DriverState {
  orcaActive: boolean;
  weStartedOrca: boolean;
  currentUrl: string | null;
  browser: Browser | null;
  page: Page | null;
  cdpPort: number;
  transcript: TranscriptEntry[];
  transcriptIndex: number;
  browserPid: number | null;
}

const state: DriverState = {
  orcaActive: false,
  weStartedOrca: false,
  currentUrl: null,
  browser: null,
  page: null,
  cdpPort: DEFAULT_CDP_PORT,
  transcript: [],
  transcriptIndex: 0,
  browserPid: null,
};

// --- State accessors ---

export function getPage(): Page | null { return state.page; }
export function getStatus(): { orcaActive: boolean; currentUrl: string | null; cdpPort: number } {
  return { orcaActive: state.orcaActive, currentUrl: state.currentUrl, cdpPort: state.cdpPort };
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
// AT-SPI2 helpers — query the a11y tree via our Python helper
// ---------------------------------------------------------------------------

function runAtspiHelper(args: string[], timeout = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [ATSPI_HELPER, ...args]);
    let out = "", err = "";
    let settled = false;
    proc.stdout.on("data", (d: Buffer) => (out += d));
    proc.stderr.on("data", (d: Buffer) => (err += d));
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(new Error("AT-SPI2 query timeout"));
    }, timeout);
    proc.on("close", (code: number) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `orca-atspi.py exit ${code}`));
    });
  });
}

async function getFocusedElement(): Promise<VoResponse> {
  const raw = await runAtspiHelper(["focused"]);
  const data = JSON.parse(raw);
  if (data.error) throw new Error(data.error);
  return parseOrcaResponse(data.spoken || "", data.name || "", data.role || "", data.state || []);
}

// ---------------------------------------------------------------------------
// Keyboard simulation via xdotool
// ---------------------------------------------------------------------------

function detectKeyTool(): "xdotool" | "ydotool" | null {
  try { execSync("which xdotool", { stdio: "pipe" }); return "xdotool"; } catch {}
  try { execSync("which ydotool", { stdio: "pipe" }); return "ydotool"; } catch {}
  return null;
}

let keyTool: "xdotool" | "ydotool" | null = null;

function sendKey(key: string, modifiers: string[] = []) {
  if (!keyTool) keyTool = detectKeyTool();
  if (!keyTool) throw new Error("No keyboard tool found. Install xdotool (X11) or ydotool (Wayland).");

  if (keyTool === "xdotool") {
    // xdotool uses "key" for key presses. Modifiers are joined with "+"
    const combo = [...modifiers, key].join("+");
    spawnSync("xdotool", ["key", "--clearmodifiers", combo]);
  } else {
    // ydotool syntax
    const combo = [...modifiers, key].join("+");
    spawnSync("ydotool", ["key", combo]);
  }
}

// xdotool key name mapping
const KEY_MAP: Record<string, string> = {
  Return: "Return", Enter: "Return",
  Space: "space", Escape: "Escape", Tab: "Tab",
  Left: "Left", Right: "Right", Down: "Down", Up: "Up",
  Delete: "Delete", Backspace: "BackSpace",
  Home: "Home", End: "End",
  PageUp: "Prior", PageDown: "Next",
  F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F6",
  F7: "F7", F8: "F8", F9: "F9", F10: "F10", F11: "F11", F12: "F12",
};

const MODIFIER_MAP: Record<string, string> = {
  control: "ctrl",
  ctrl: "ctrl",
  shift: "shift",
  alt: "alt",
  option: "alt",  // macOS compat
  super: "super",
  meta: "super",
  command: "super", // macOS compat
};

export const VALID_MODIFIERS: Record<string, string> = {
  control: "ctrl",
  ctrl: "ctrl",
  shift: "shift",
  alt: "alt",
  super: "super",
};

function resolveKey(key: string): string {
  return KEY_MAP[key] || key;
}

function resolveModifiers(mods: string[]): string[] {
  return mods.map((m) => {
    const resolved = MODIFIER_MAP[m.toLowerCase()];
    if (!resolved) throw new Error(`Unknown modifier: ${m}. Valid: ${Object.keys(VALID_MODIFIERS).join(", ")}`);
    return resolved;
  });
}

// ---------------------------------------------------------------------------
// Orca process management
// ---------------------------------------------------------------------------

function isOrcaRunning(): boolean {
  try {
    const result = spawnSync("pgrep", ["-x", "orca"]);
    return result.status === 0;
  } catch {
    return false;
  }
}

function startOrca(): boolean {
  if (isOrcaRunning()) {
    log("Orca already running");
    return false; // we didn't start it
  }
  // Start Orca in the background
  const child = spawn("orca", [], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();
  log("Started Orca");
  return true;
}

function stopOrca() {
  try {
    spawnSync("pkill", ["-x", "orca"]);
    log("Stopped Orca");
  } catch (e) {
    log(`Failed to stop Orca: ${errorMsg(e)}`, true);
  }
}

// ---------------------------------------------------------------------------
// Orca operations — send keys then read AT-SPI2
// ---------------------------------------------------------------------------

async function orcaAction(keyName: string, modifiers: string[] = []): Promise<TranscriptEntry> {
  sendKey(resolveKey(keyName), resolveModifiers(modifiers));
  await sleep(ORCA_SETTLE_MS);
  const element = await getFocusedElement();
  return recordTranscript(element);
}

function lockedOrcaAction(keyName: string, modifiers: string[] = []): Promise<VoResult> {
  return withLock(async () => {
    try { return await orcaAction(keyName, modifiers); }
    catch (e) { return translateError(e); }
  });
}

/**
 * Move to next item. In Orca browse mode, Down arrow moves to the next element.
 */
export function orcaNext(): Promise<VoResult> { return lockedOrcaAction("Down"); }

/**
 * Move to previous item. In Orca browse mode, Up arrow moves to the previous element.
 */
export function orcaPrevious(): Promise<VoResult> { return lockedOrcaAction("Up"); }

/**
 * Activate current item (press Enter).
 */
export function orcaAct(): Promise<VoResult> { return lockedOrcaAction("Return"); }

/**
 * Execute an Orca browse-mode command by name.
 * Maps command names to keyboard shortcuts.
 */
export async function orcaPerform(commandName: string): Promise<VoResult> {
  return withLock(async () => {
    const entry = ORCA_COMMANDS[commandName];
    const ctx: ErrorContext = { command: commandName };

    if (!entry) {
      return translateError(`Unknown command: ${commandName}`, ctx);
    }

    try {
      sendKey(resolveKey(entry.key), resolveModifiers(entry.modifiers || []));
      await sleep(entry.settle || ORCA_SETTLE_MS);
      const element = await getFocusedElement();
      return recordTranscript(element);
    } catch (e) {
      return translateError(e, ctx);
    }
  });
}

/**
 * Send a raw keystroke.
 */
export async function orcaPress(key: string, modifiers: string[] = []): Promise<VoResult> {
  return withLock(async () => {
    const unknown = modifiers.filter((m) => !MODIFIER_MAP[m.toLowerCase()]);
    if (unknown.length > 0) {
      return translateError(`Unknown modifier(s): ${unknown.join(", ")}`, { key });
    }

    try {
      sendKey(resolveKey(key), resolveModifiers(modifiers));
      await sleep(ORCA_PRESS_SETTLE_MS);
      const element = await getFocusedElement();
      return recordTranscript(element);
    } catch (e) {
      return translateError(e, { key });
    }
  });
}

// ---------------------------------------------------------------------------
// Browser lifecycle
// ---------------------------------------------------------------------------

async function focusBrowser() {
  try {
    // Use xdotool to find and focus the browser window
    if (state.browserPid) {
      spawnSync("xdotool", ["search", "--pid", state.browserPid.toString(), "--name", "Chromium", "windowactivate"]);
    } else {
      spawnSync("xdotool", ["search", "--name", "Chromium", "windowactivate", "--sync"]);
    }
    await sleep(ORCA_QUICK_SETTLE_MS);
    if (state.page) {
      await state.page.bringToFront();
      await sleep(ORCA_QUICK_SETTLE_MS);
    }
  } catch (e) { log(`focus warning: ${errorMsg(e)}`); }
}

export async function initialize(url: string | null, cdpPort: number) {
  state.cdpPort = cdpPort;

  // Check prerequisites
  if (!detectKeyTool()) {
    throw new Error("xdotool or ydotool required. Install: sudo apt install xdotool");
  }

  state.browser = await chromium.launch({
    headless: false,
    args: [`--remote-debugging-port=${cdpPort}`],
  });
  const ctx = await state.browser.newContext();
  state.page = await ctx.newPage();

  // Track browser PID for window focusing
  try {
    const proc = (state.browser as any)?.process?.();
    if (proc?.pid) state.browserPid = proc.pid;
  } catch {}

  if (url) {
    await state.page.goto(url, { waitUntil: "load" });
    state.currentUrl = url;
  }

  // Start Orca
  state.weStartedOrca = startOrca();
  state.orcaActive = isOrcaRunning();

  if (!state.orcaActive) {
    // Give it a moment and check again
    await sleep(1000);
    state.orcaActive = isOrcaRunning();
  }

  if (!state.orcaActive) {
    try { await state.browser.close(); } catch {}
    state.browser = null;
    state.page = null;
    throw new Error("Orca failed to start. Ensure orca is installed: sudo apt install orca");
  }

  log("Orca active");

  // Persist state for kill command
  try {
    writeFileSync(ORCA_STATE_FILE, JSON.stringify({
      weStartedOrca: state.weStartedOrca,
    }));
  } catch {}

  await sleep(ORCA_INIT_SETTLE_MS);
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
      await sleep(ORCA_SETTLE_MS);
      const element = await getFocusedElement();
      return recordTranscript(element);
    } catch (e) {
      return translateError(e, { url });
    }
  });
}

export async function cleanup() {
  shuttingDown = true;
  await operationLock;

  try {
    if (state.browser) { await state.browser.close(); state.browser = null; }
  } catch (e) { log(`browser close: ${errorMsg(e)}`, true); }

  if (state.orcaActive && state.weStartedOrca) {
    stopOrca();
  }
  state.orcaActive = false;
  state.page = null;
  state.currentUrl = null;
}

/** Read the current focused item via AT-SPI2. */
export async function getItemText(): Promise<VoResult> {
  return withLock(async () => {
    try {
      return await getFocusedElement();
    } catch (e) {
      return translateError(e);
    }
  });
}

/**
 * Enter web content — focus the browser and click into the page.
 * On Linux, Orca auto-enters browse mode when a web page is focused.
 */
export async function orcaEnter(): Promise<VoResult> {
  return withLock(async () => {
    try {
      await focusBrowser();
      if (state.page) {
        await state.page.click("body", { force: true });
        await sleep(ORCA_SETTLE_MS);
      }
      const element = await getFocusedElement();
      return recordTranscript(element);
    } catch (e) {
      return translateError(e);
    }
  });
}
