/**
 * Core Orca operations, state, and Chromium lifecycle for Linux.
 *
 * Uses:
 * - Orca screen reader (GNOME's built-in AT)
 * - Speech capture via orca-customizations.py hook (speech.ts)
 * - AT-SPI2 via D-Bus for accessibility tree queries (atspi.ts)
 * - AT-SPI2 GenerateKeyboardEvent for key injection (not xdotool)
 * - xdotool only for X11 window focus management
 * - Playwright for Chromium lifecycle
 *
 * Other modules (server, CLI) import from here — never from AT-SPI2 directly.
 */

import { spawn, spawnSync, execSync } from "child_process";
import { existsSync, unlinkSync } from "fs";
import { runtimePath, safeWriteSync, safeAppendSync } from "../lib/runtime-paths.js";
import { chromium } from "playwright";
import type { Page, Browser } from "playwright";
import { translateError } from "../errors.js";
import {
  type VoResponse,
  type VoError,
  type VoResult,
  type TranscriptEntry,
  isVoError,
  ORCA_COMMANDS,
} from "../types.js";
import * as speech from "./speech.js";
import * as atspi from "./atspi.js";

export type { VoResponse, VoError, VoResult, TranscriptEntry } from "../types.js";
export { isVoError, ORCA_COMMANDS } from "../types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const DEFAULT_PORT = 8001;
export const DEFAULT_CDP_PORT = 9223;
export const LOG_FILE = runtimePath("driver.log");
export const PID_FILE = runtimePath("driver.pid");
export const ORCA_STATE_FILE = runtimePath("driver-state.json");

export const CLI_TIMEOUT_MS = 30_000;
export const MAX_TRANSCRIPT_ENTRIES = 10_000;
export const MAX_REQUEST_BODY = 1_000_000;

const ORCA_SETTLE_MS = 1000;
const ORCA_QUICK_SETTLE_MS = 400;
const ORCA_PRESS_SETTLE_MS = 1000;
const ORCA_INIT_SETTLE_MS = 5000;

let xvfbProc: ReturnType<typeof spawn> | null = null;
let atSpiProc: ReturnType<typeof spawn> | null = null;
let atSpiRegistryProc: ReturnType<typeof spawn> | null = null;

// ---------------------------------------------------------------------------
// Operation lock — serializes all Orca operations
// ---------------------------------------------------------------------------

let operationLock: Promise<void> = Promise.resolve();
let shuttingDown = false;

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (shuttingDown) return Promise.reject(new Error("Driver is shutting down"));
  const prev = operationLock;
  let resolveLock!: () => void;
  const next = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });
  operationLock = next;
  return prev.then(fn).finally(resolveLock);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function errorMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function removePidFile() {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {}
  try {
    if (existsSync(ORCA_STATE_FILE)) unlinkSync(ORCA_STATE_FILE);
  } catch {}
}

/** Strip non-printable characters that leak from modifier key release events. */
function cleanSpoken(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim();
}

function deduplicateSpoken(text: string): string {
  const parts = text.split(/\s+/);
  const deduped: string[] = [];
  for (const part of parts) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== part) {
      deduped.push(part);
    }
  }
  return deduped.join(" ");
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

export function getPage(): Page | null {
  return state.page;
}

export function getStatus(): { orcaActive: boolean; currentUrl: string | null; cdpPort: number } {
  return { orcaActive: state.orcaActive, currentUrl: state.currentUrl, cdpPort: state.cdpPort };
}

export function getTranscriptLength(): number {
  return state.transcript.length;
}

// ---------------------------------------------------------------------------
// Logging & transcript
// ---------------------------------------------------------------------------

export function log(msg: string, err = false) {
  const line = `[${new Date().toISOString()}] [${err ? "ERROR" : "INFO"}] ${msg}\n`;
  try {
    safeAppendSync(LOG_FILE, line);
  } catch {}
}

function recordTranscript(entry: VoResponse): TranscriptEntry {
  const indexed: TranscriptEntry = { ...entry, index: state.transcriptIndex++ };
  state.transcript.push(indexed);
  if (state.transcript.length > MAX_TRANSCRIPT_ENTRIES) {
    state.transcript = state.transcript.slice(-MAX_TRANSCRIPT_ENTRIES);
  }
  return indexed;
}

export function getTranscript(since?: number): TranscriptEntry[] {
  if (since !== undefined) return state.transcript.filter((e) => e.index > since);
  return [...state.transcript];
}

export function clearTranscript(): TranscriptEntry[] {
  const entries = [...state.transcript];
  state.transcript = [];
  return entries;
}

// ---------------------------------------------------------------------------
// Speech + AT-SPI2 combined element reading
// ---------------------------------------------------------------------------

async function readCurrentElement(speechMarker: number): Promise<VoResponse> {
  speech.flush();
  let spoken = cleanSpoken(deduplicateSpoken(speech.spokenSince(speechMarker)));

  let name = "",
    role = "",
    elementState: string[] = [];
  try {
    const element = await atspi.getItemInfo();
    if (element) {
      name = element.name;
      role = element.role;
      elementState = element.state.filter((s) =>
        [
          "focused",
          "checked",
          "expanded",
          "collapsed",
          "selected",
          "required",
          "visited",
          "pressed",
          "has-popup",
        ].includes(s),
      );
    }
  } catch (e) {
    log(`AT-SPI2 query: ${errorMsg(e)}`, true);
  }

  if (!spoken) spoken = [name, role].filter(Boolean).join(", ");
  return { spoken, name, role, state: elementState };
}

// ---------------------------------------------------------------------------
// Key name mapping
// ---------------------------------------------------------------------------

const KEY_MAP: Record<string, string> = {
  Return: "Return",
  Enter: "Return",
  Space: "space",
  Escape: "Escape",
  Tab: "Tab",
  Left: "Left",
  Right: "Right",
  Down: "Down",
  Up: "Up",
  Delete: "Delete",
  Backspace: "BackSpace",
  Home: "Home",
  End: "End",
  PageUp: "Prior",
  PageDown: "Next",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
};

const MODIFIER_MAP: Record<string, string> = {
  control: "ctrl",
  ctrl: "ctrl",
  shift: "shift",
  alt: "alt",
  option: "alt",
  super: "super",
  meta: "super",
  command: "super",
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
    if (!resolved)
      throw new Error(`Unknown modifier: ${m}. Valid: ${Object.keys(VALID_MODIFIERS).join(", ")}`);
    return resolved;
  });
}

async function sendKey(key: string, modifiers: string[] = []) {
  await atspi.generateKeyboardEvent(key, modifiers);
}

// ---------------------------------------------------------------------------
// Virtual desktop bootstrap
// ---------------------------------------------------------------------------

function ensureDisplay(): void {
  if (process.env.DISPLAY) {
    log(`Using existing display: ${process.env.DISPLAY}`);
    return;
  }

  try {
    execSync("which Xvfb", { stdio: "pipe" });
  } catch {
    throw new Error("No DISPLAY set and Xvfb not found. Run: agent-orca-driver setup");
  }

  try {
    execSync("xdotool getdisplaygeometry", {
      stdio: "pipe",
      timeout: 3000,
      env: { ...process.env, DISPLAY: ":99" },
    });
    process.env.DISPLAY = ":99";
    log("Using existing Xvfb on :99");
    return;
  } catch {}

  try {
    execSync("rm -f /tmp/.X99-lock", { stdio: "pipe" });
  } catch {}

  log("Starting Xvfb on :99...");
  xvfbProc = spawn("Xvfb", [":99", "-screen", "0", "1280x1024x24", "-ac"], {
    stdio: "pipe",
    detached: true,
  });
  xvfbProc.unref();

  const start = Date.now();
  while (Date.now() - start < 3000) {
    try {
      execSync("xdotool getdisplaygeometry", {
        stdio: "pipe",
        timeout: 1000,
        env: { ...process.env, DISPLAY: ":99" },
      });
      process.env.DISPLAY = ":99";
      log(`Xvfb started on :99 (PID: ${xvfbProc.pid})`);
      return;
    } catch {
      spawnSync("sleep", ["0.3"]);
    }
  }
  throw new Error("Xvfb failed to start on :99");
}

function ensureWindowManager(): void {
  try {
    if (spawnSync("pgrep", ["-x", "openbox"], { stdio: "pipe" }).status === 0) {
      log("Window manager (openbox) already running");
      return;
    }
  } catch {}

  try {
    execSync("which openbox", { stdio: "pipe" });
  } catch {
    log("openbox not found — window focus may not work", true);
    return;
  }

  spawn("openbox", [], { stdio: "ignore", detached: true, env: process.env }).unref();
  spawnSync("sleep", ["0.5"]);
  log("Started openbox window manager");
}

function ensureDbus(): void {
  if (process.env.DBUS_SESSION_BUS_ADDRESS) {
    log(`Using existing D-Bus: ${process.env.DBUS_SESSION_BUS_ADDRESS}`);
    return;
  }

  const result = execSync("dbus-launch --sh-syntax", { encoding: "utf-8" });
  const match = /DBUS_SESSION_BUS_ADDRESS='([^']+)'/.exec(result);
  if (!match) throw new Error("dbus-launch output not parseable");
  process.env.DBUS_SESSION_BUS_ADDRESS = match[1];
  log(`D-Bus started: ${match[1]}`);
}

function ensureAtSpi2(): void {
  for (const [name, bins] of [
    [
      "at-spi-bus-launcher",
      ["/usr/libexec/at-spi-bus-launcher", "/usr/lib/at-spi2-core/at-spi-bus-launcher"],
    ],
    [
      "at-spi2-registryd",
      ["/usr/libexec/at-spi2-registryd", "/usr/lib/at-spi2-core/at-spi2-registryd"],
    ],
  ] as const) {
    try {
      const bin =
        bins.find((b) => {
          try {
            execSync(`test -x ${b}`, { stdio: "pipe" });
            return true;
          } catch {
            return false;
          }
        }) || bins[0];
      const proc = spawn(bin, [], { stdio: "ignore", detached: true, env: process.env });
      proc.unref();
      if (name === "at-spi-bus-launcher") atSpiProc = proc;
      else atSpiRegistryProc = proc;
      log(`${name} started`);
    } catch (e) {
      log(`${name}: ${errorMsg(e)} (may already be running)`);
    }
  }
}

function ensureAudioSink(): void {
  try {
    execSync("which pulseaudio", { stdio: "pipe" });
  } catch {
    process.env.PULSE_SERVER = "none";
    log("No PulseAudio, set PULSE_SERVER=none");
    return;
  }

  try {
    execSync("pulseaudio --check 2>/dev/null || pulseaudio --start --exit-idle-time=-1", {
      stdio: "pipe",
    });
    execSync("pactl load-module module-null-sink sink_name=dummy 2>/dev/null || true", {
      stdio: "pipe",
    });
    log("PulseAudio started with null sink");
  } catch (e) {
    process.env.PULSE_SERVER = "none";
    log(`PulseAudio failed (${errorMsg(e)}), set PULSE_SERVER=none`);
  }
}

function ensureDesktopEnv(): void {
  if (process.env.NO_AT_BRIDGE) {
    delete process.env.NO_AT_BRIDGE;
    log("Unset NO_AT_BRIDGE");
  }
  if (!process.env.GTK_MODULES?.includes("atk-bridge")) {
    process.env.GTK_MODULES = "gail:atk-bridge";
    log("Set GTK_MODULES=gail:atk-bridge");
  }
  ensureDisplay();
  ensureWindowManager();
  ensureDbus();
  ensureAtSpi2();
  ensureAudioSink();
}

// ---------------------------------------------------------------------------
// Orca process management
// ---------------------------------------------------------------------------

function isOrcaRunning(): boolean {
  try {
    return spawnSync("pgrep", ["-x", "orca"]).status === 0;
  } catch {
    return false;
  }
}

function startOrca(): boolean {
  if (isOrcaRunning()) {
    log("Orca already running");
    return false;
  }
  spawn("orca", [], { detached: true, stdio: "ignore", env: { ...process.env } }).unref();
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
// Orca operations
// ---------------------------------------------------------------------------

async function orcaAction(keyName: string, modifiers: string[] = []): Promise<TranscriptEntry> {
  const marker = speech.mark();
  await sendKey(resolveKey(keyName), resolveModifiers(modifiers));
  await sleep(ORCA_SETTLE_MS);
  return recordTranscript(await readCurrentElement(marker));
}

function lockedOrcaAction(keyName: string, modifiers: string[] = []): Promise<VoResult> {
  return withLock(async () => {
    try {
      return await orcaAction(keyName, modifiers);
    } catch (e) {
      return translateError(e);
    }
  });
}

export function orcaNext(): Promise<VoResult> {
  return lockedOrcaAction("Down");
}
export function orcaPrevious(): Promise<VoResult> {
  return lockedOrcaAction("Up");
}
export function orcaAct(): Promise<VoResult> {
  return lockedOrcaAction("Return");
}

export async function orcaPerform(commandName: string): Promise<VoResult> {
  return withLock(async () => {
    const entry = ORCA_COMMANDS[commandName];
    if (!entry) return translateError(`Unknown command: ${commandName}`, { command: commandName });
    try {
      const marker = speech.mark();
      await sendKey(resolveKey(entry.key), resolveModifiers(entry.modifiers || []));
      await sleep(entry.settle || ORCA_SETTLE_MS);
      return recordTranscript(await readCurrentElement(marker));
    } catch (e) {
      return translateError(e, { command: commandName });
    }
  });
}

export async function orcaPress(key: string, modifiers: string[] = []): Promise<VoResult> {
  return withLock(async () => {
    const unknown = modifiers.filter((m) => !MODIFIER_MAP[m.toLowerCase()]);
    if (unknown.length)
      return translateError(`Unknown modifier(s): ${unknown.join(", ")}`, { key });
    try {
      const marker = speech.mark();
      await sendKey(resolveKey(key), resolveModifiers(modifiers));
      await sleep(ORCA_PRESS_SETTLE_MS);
      return recordTranscript(await readCurrentElement(marker));
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
    const searchArgs = state.browserPid
      ? ["search", "--pid", state.browserPid.toString()]
      : ["search", "--name", "Chrome"];
    const result = spawnSync("xdotool", searchArgs, {
      encoding: "utf-8",
      timeout: 5000,
      env: process.env,
    });
    const windowId = (result.stdout || "").trim().split("\n")[0];
    if (windowId) {
      spawnSync("xdotool", ["windowfocus", "--sync", windowId], {
        timeout: 5000,
        env: process.env,
      });
      await sleep(ORCA_QUICK_SETTLE_MS);
    }
    // Click the center of the screen to focus web content (Chrome is maximized).
    // This real X11 click triggers an AT-SPI2 focus event on the web document,
    // which causes Orca to enter browse mode.
    spawnSync("xdotool", ["mousemove", "640", "600", "click", "1"], {
      timeout: 5000,
      env: process.env,
    });
    await sleep(ORCA_SETTLE_MS);
    speech.clear();
  } catch (e) {
    log(`focus warning: ${errorMsg(e)}`);
  }
}

export async function initialize(url: string | null, cdpPort: number) {
  state.cdpPort = cdpPort;
  ensureDesktopEnv();
  speech.ensureSpeechCapture(log);
  await sleep(1000);

  state.browser = await chromium.launch({
    headless: false,
    args: [
      `--remote-debugging-port=${cdpPort}`,
      "--remote-debugging-address=127.0.0.1",
      "--force-renderer-accessibility",
      "--start-maximized",
    ],
  });
  const ctx = await state.browser.newContext({ viewport: { width: 1280, height: 1024 } });
  state.page = await ctx.newPage();

  try {
    const proc = (state.browser as any)?.process?.();
    if (proc?.pid) state.browserPid = proc.pid;
  } catch {}

  if (url) {
    await state.page.goto(url, { waitUntil: "load" });
    state.currentUrl = url;
  }

  state.weStartedOrca = startOrca();
  state.orcaActive = isOrcaRunning();
  if (!state.orcaActive) {
    await sleep(1000);
    state.orcaActive = isOrcaRunning();
  }
  if (!state.orcaActive) {
    try {
      await state.browser.close();
    } catch {}
    state.browser = null;
    state.page = null;
    throw new Error("Orca failed to start. Install: sudo apt install orca");
  }
  log("Orca active");

  try {
    safeWriteSync(ORCA_STATE_FILE, JSON.stringify({ weStartedOrca: state.weStartedOrca }));
  } catch {}

  await sleep(ORCA_INIT_SETTLE_MS);
  await focusBrowser();
  log("Browser focused, browse mode active");
}

export async function navigate(url: string): Promise<VoResult> {
  return withLock(async () => {
    try {
      if (!state.page) return translateError("No page");
      const marker = speech.mark();
      await state.page.goto(url, { waitUntil: "load" });
      state.currentUrl = url;
      await focusBrowser();
      await sleep(ORCA_SETTLE_MS);
      return recordTranscript(await readCurrentElement(marker));
    } catch (e) {
      return translateError(e, { url });
    }
  });
}

export async function cleanup() {
  shuttingDown = true;
  await operationLock;
  speech.stopWatching();
  atspi.disconnect();
  try {
    if (state.browser) {
      await state.browser.close();
      state.browser = null;
    }
  } catch (e) {
    log(`browser close: ${errorMsg(e)}`, true);
  }
  if (state.orcaActive && state.weStartedOrca) stopOrca();
  state.orcaActive = false;
  state.page = null;
  state.currentUrl = null;
  for (const proc of [atSpiRegistryProc, atSpiProc, xvfbProc]) {
    if (proc?.pid) {
      try {
        process.kill(proc.pid);
      } catch {}
    }
  }
  atSpiRegistryProc = null;
  atSpiProc = null;
  xvfbProc = null;
}

export async function getItemText(): Promise<VoResult> {
  return withLock(async () => {
    try {
      return await readCurrentElement(speech.mark());
    } catch (e) {
      return translateError(e);
    }
  });
}

export async function orcaEnter(): Promise<VoResult> {
  return withLock(async () => {
    try {
      const marker = speech.mark();
      await focusBrowser();
      await sleep(ORCA_SETTLE_MS);
      return recordTranscript(await readCurrentElement(marker));
    } catch (e) {
      return translateError(e);
    }
  });
}
