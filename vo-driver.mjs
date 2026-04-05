#!/usr/bin/env bun

/**
 * vo-driver — VoiceOver screen reader automation for accessibility testing.
 *
 * Two modes:
 *   Daemon:  bun vo-driver.mjs serve [--port 7483] [--cdp-port 9222]
 *   CLI:     bun vo-driver.mjs <command> [args]
 *
 * The daemon owns a headed Chromium browser with VoiceOver attached.
 * Other tools (agent-browser, audit.mjs) connect via CDP to the same browser.
 */

import { createServer } from "http";
import { spawn, spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { voiceOver } from "@guidepup/guidepup";
import { chromium } from "playwright";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_PORT = 7483;
const DEFAULT_CDP_PORT = 9222;
const LOG_FILE = "/tmp/vo-driver.log";
const PID_FILE = "/tmp/vo-driver.pid";

// ---------------------------------------------------------------------------
// Command catalog — VoiceOver-standard names
// ---------------------------------------------------------------------------

const COMMANDS = {
  // -- Element-type navigation --
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
  FIND_PREVIOUS_TEXT_FIELD:       { type: "commander", name: "FIND_PREVIOUS_FIELD" },
  FIND_NEXT_CHECKBOX:            { type: "commander", name: "FIND_NEXT_TICKBOX" },
  FIND_PREVIOUS_CHECKBOX:        { type: "commander", name: "FIND_PREVIOUS_TICKBOX" },
  FIND_NEXT_RADIO_GROUP:         { type: "commander", name: "FIND_NEXT_RADIO_GROUP" },
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

  // -- Position --
  GO_TO_BEGINNING:               { type: "commander", name: "GO_TO_BEGINNING" },
  GO_TO_END:                     { type: "commander", name: "GO_TO_END" },

  // -- Interaction --
  START_INTERACTING:             { type: "commander", name: "START_INTERACTING_WITH_ITEM" },
  STOP_INTERACTING:              { type: "commander", name: "STOP_INTERACTING_WITH_ITEM" },
  ESCAPE:                        { type: "commander", name: "ESCAPE" },

  // -- Rotor --
  OPEN_ROTOR:                    { type: "commander", name: "ROTOR" },
  OPEN_WEB_ROTOR:                { type: "keyboard", name: "openWebItemRotor" },
  ROTOR_UP:                      { type: "commander", name: "MOVE_UP_IN_ROTOR" },
  ROTOR_DOWN:                    { type: "commander", name: "MOVE_DOWN_IN_ROTOR" },
  ROTATE_LEFT:                   { type: "commander", name: "ROTATE_LEFT" },
  ROTATE_RIGHT:                  { type: "commander", name: "ROTATE_RIGHT" },

  // -- Reading --
  READ_CURRENT_ITEM:             { type: "commander", name: "READ_CONTENTS_OF_VOICEOVER_CURSOR" },
  READ_ALL:                      { type: "keyboard", name: "readAllText" },
  READ_LINE:                     { type: "keyboard", name: "readLine" },
  READ_WORD:                     { type: "keyboard", name: "readWord" },
  READ_FROM_TOP:                 { type: "keyboard", name: "readFromBeginningToCurrent" },
  READ_LINK_URL:                 { type: "keyboard", name: "readLinkAddress" },
  READ_PAGE_STATS:               { type: "keyboard", name: "readWebpageStatistics" },

  // -- Table reading --
  READ_TABLE_ROW:                { type: "keyboard", name: "readTableRow" },
  READ_TABLE_COLUMN:             { type: "keyboard", name: "readTableColumn" },
  READ_TABLE_HEADER:             { type: "keyboard", name: "readTableColumnHeader" },
  READ_TABLE_POSITION:           { type: "keyboard", name: "readTableRowAndColumnNumbers" },

  // -- Focus --
  SYNC_CURSOR_TO_KEYBOARD:       { type: "keyboard", name: "moveCursorToKeyboardFocus" },
  SYNC_KEYBOARD_TO_CURSOR:       { type: "keyboard", name: "moveKeyboardFocusToCursor" },
  DESCRIBE_KEYBOARD_FOCUS:       { type: "keyboard", name: "describeItemWithKeyboardFocus" },

  // -- Navigation modes --
  TOGGLE_DOM_GROUP_NAV:          { type: "commander", name: "TOGGLE_WEB_NAVIGATION_DOM_OR_GROUP" },
  TOGGLE_QUICK_NAV:              { type: "commander", name: "TOGGLE_QUICK_NAV_ON_OR_OFF" },
  TOGGLE_SINGLE_KEY_NAV:         { type: "commander", name: "TOGGLE_SINGLE_KEY_QUICK_NAV_ON_OR_OFF" },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = {
  voiceoverActive: false,
  currentUrl: null,
  browser: null,
  page: null,
  cdpPort: DEFAULT_CDP_PORT,
  transcript: [],       // { index, spoken, name, role }
  transcriptIndex: 0,
};

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg, err = false) {
  const line = `[${new Date().toISOString()}] [${err ? "ERROR" : "INFO"}] ${msg}\n`;
  try { writeFileSync(LOG_FILE, line, { flag: "a" }); } catch {}
}

// ---------------------------------------------------------------------------
// Response parsing — extract name and role from VoiceOver announcements
// ---------------------------------------------------------------------------

function parseVoResponse(spoken, itemText) {
  // itemText from guidepup is usually "Name role" e.g. "Example Domain heading level 1"
  // spoken is the full announcement including context hints
  const name = itemText || "";
  let role = "";

  // Common role patterns at the end of itemText
  const rolePatterns = [
    /\s+(heading level \d+)$/i,
    /\s+(link)$/i,
    /\s+(button)$/i,
    /\s+(text field)$/i,
    /\s+(search text field)$/i,
    /\s+(edit text)$/i,
    /\s+(checkbox)$/i,
    /\s+(radio button)$/i,
    /\s+(pop up button)$/i,
    /\s+(menu item)$/i,
    /\s+(tab)$/i,
    /\s+(image)$/i,
    /\s+(group)$/i,
    /\s+(list)$/i,
    /\s+(table)$/i,
    /\s+(dialog)$/i,
    /\s+(web content)$/i,
    /\s+(toolbar item palette)$/i,
    /\s+(selected tab, group)$/i,
  ];

  let parsedName = name;
  for (const pat of rolePatterns) {
    const m = name.match(pat);
    if (m) {
      role = m[1];
      parsedName = name.slice(0, m.index);
      break;
    }
  }

  return { spoken, name: parsedName.trim(), role };
}

function recordTranscript(entry) {
  entry.index = state.transcriptIndex++;
  state.transcript.push(entry);
  return entry;
}

// ---------------------------------------------------------------------------
// AppleScript helpers (used only for `press` and browser focus)
// ---------------------------------------------------------------------------

function runAppleScript(script, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const proc = spawn("osascript", ["-e", script]);
    let out = "", err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new Error("AppleScript timeout")); }, timeout);
    proc.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `exit ${code}`));
    });
  });
}

async function getSpokenPhraseRaw() {
  try {
    return await runAppleScript('tell application "VoiceOver" to get content of last phrase', 5000);
  } catch { return ""; }
}

// ---------------------------------------------------------------------------
// VoiceOver operations
// ---------------------------------------------------------------------------

async function voAction(action) {
  await action();
  const spoken = await voiceOver.lastSpokenPhrase();
  const itemText = await voiceOver.itemText();
  const result = parseVoResponse(spoken, itemText);
  return recordTranscript(result);
}

async function voNext() { return voAction(() => voiceOver.next()); }
async function voPrevious() { return voAction(() => voiceOver.previous()); }
async function voAct() { return voAction(() => voiceOver.act()); }

async function voPerform(commandName) {
  const entry = COMMANDS[commandName];
  let commandObj;

  if (entry) {
    const source = entry.type === "commander"
      ? voiceOver.commanderCommands
      : voiceOver.keyboardCommands;
    commandObj = source[entry.name];
    if (!commandObj) return { error: `${entry.type} command "${entry.name}" not found in guidepup` };
  } else {
    commandObj = voiceOver.commanderCommands[commandName];
    if (!commandObj) return { error: `Unknown command: ${commandName}` };
  }

  return voAction(() => voiceOver.perform(commandObj));
}

// ---------------------------------------------------------------------------
// Enter web content — auto-navigate from browser chrome into page
// ---------------------------------------------------------------------------

async function voEnter() {
  // Check if already inside web content by looking at current item
  try {
    const spoken = await voiceOver.lastSpokenPhrase();
    if (spoken.toLowerCase().includes("inside of web content") ||
        spoken.toLowerCase().includes("in ") && spoken.toLowerCase().includes("web content")) {
      const itemText = await voiceOver.itemText();
      const result = parseVoResponse(spoken, itemText);
      log(`Already in web content: ${itemText}`);
      return recordTranscript(result);
    }
  } catch {}

  // Use raw AppleScript to quickly walk to web content — much faster than guidepup's
  // next() which polls for phrase stabilization after each move
  const beginCmd = voiceOver.commanderCommands.GO_TO_BEGINNING;
  if (beginCmd) await voiceOver.perform(beginCmd);

  for (let i = 0; i < 10; i++) {
    // Quick check via raw AppleScript (no LogStore polling)
    let itemText = "";
    try {
      itemText = await runAppleScript(
        'tell application "VoiceOver" to return text under cursor of vo cursor', 3000);
    } catch {}

    if (itemText.toLowerCase().includes("web content")) {
      // Found it — interact to enter
      const interactCmd = voiceOver.commanderCommands.START_INTERACTING_WITH_ITEM;
      if (interactCmd) await voiceOver.perform(interactCmd);
      const spoken = await voiceOver.lastSpokenPhrase();
      const finalItem = await voiceOver.itemText();
      const result = parseVoResponse(spoken, finalItem);
      log(`Entered web content: ${finalItem}`);
      return recordTranscript(result);
    }

    // Move forward with raw AppleScript (fast, no polling)
    try {
      await runAppleScript(
        'tell application "VoiceOver" to tell vo cursor to move right', 5000);
      await new Promise((r) => setTimeout(r, 300));
    } catch { break; }
  }

  return { error: "Could not find web content area" };
}

// ---------------------------------------------------------------------------
// Press — raw keystrokes via AppleScript (for Tab, arrows in rotor, etc.)
// ---------------------------------------------------------------------------

const KEY_CODES = {
  Return: 36, Enter: 36, Space: 49, Escape: 53, Tab: 48,
  Left: 123, Right: 124, Down: 125, Up: 126,
  Delete: 51, Backspace: 51, Home: 115, End: 119,
  PageUp: 116, PageDown: 121,
};

const MOD_MAP = {
  control: "control down", option: "option down",
  command: "command down", shift: "shift down",
};

async function voPress(key, modifiers = []) {
  const modStr = modifiers.map((m) => MOD_MAP[m]).filter(Boolean).join(", ");
  const usingClause = modStr ? ` using {${modStr}}` : "";
  const code = KEY_CODES[key];

  const script = code !== undefined
    ? `tell application "System Events" to key code ${code}${usingClause}`
    : `tell application "System Events" to keystroke "${key}"${usingClause}`;

  await runAppleScript(script);
  await new Promise((r) => setTimeout(r, 600));
  const spoken = await getSpokenPhraseRaw();
  const result = { spoken, name: spoken, role: "" };
  return recordTranscript(result);
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

function getTranscript(since) {
  if (since !== undefined) {
    return state.transcript.filter((e) => e.index > since);
  }
  return [...state.transcript];
}

function clearTranscript() {
  const entries = [...state.transcript];
  state.transcript = [];
  return entries;
}

// ---------------------------------------------------------------------------
// Browser + VoiceOver lifecycle
// ---------------------------------------------------------------------------

async function focusBrowser() {
  try {
    spawnSync("osascript", ["-e", 'tell application "Google Chrome for Testing" to activate']);
    await new Promise((r) => setTimeout(r, 500));
    if (state.page) {
      await state.page.bringToFront();
      await new Promise((r) => setTimeout(r, 300));
      await state.page.click("body", { force: true });
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch (e) { log(`focus warning: ${e.message}`); }
}

async function initialize(url, cdpPort) {
  state.cdpPort = cdpPort;

  // Launch browser with CDP debugging port exposed
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

  // Start VoiceOver
  await voiceOver.start();
  state.voiceoverActive = true;
  log("VoiceOver started");

  // Max out speech rate
  try {
    spawnSync("defaults", ["write",
      "com.apple.VoiceOver4/default",
      "SCRCategories_SCRCategorySystemWide_SCRSpeechLanguages_default_SCRSpeechComponentSettings_SCRRateAsPercent",
      "-int", "100"]);
    log("Speech rate set to 100");
  } catch (e) { log(`speech rate warning: ${e.message}`); }

  // Focus browser
  await new Promise((r) => setTimeout(r, 1500));
  await focusBrowser();
  log("Browser focused");
}

async function navigate(url) {
  if (!state.page) return { error: "No page" };
  await state.page.goto(url, { waitUntil: "load" });
  state.currentUrl = url;
  await focusBrowser();

  // Auto-enter web content
  try {
    return await voEnter();
  } catch (e) {
    log(`navigate enter warning: ${e.message}`);
    return { spoken: "", name: "", role: "" };
  }
}

async function cleanup() {
  try { if (state.browser) { await state.browser.close(); state.browser = null; } } catch {}
  try {
    if (state.voiceoverActive) { await voiceOver.stop(); state.voiceoverActive = false; }
  } catch {
    try { spawnSync("osascript", ["-e", 'tell application "VoiceOver" to quit']); } catch {}
    state.voiceoverActive = false;
  }
  state.page = null;
  state.currentUrl = null;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}

async function handle(req, res) {
  const { method } = req;
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  try {
    if (path === "/" && method === "GET")
      return json(res, 200, {
        status: "running",
        voiceoverActive: state.voiceoverActive,
        currentUrl: state.currentUrl,
        cdpPort: state.cdpPort,
      });

    if (path === "/next" && method === "POST")
      return json(res, 200, await voNext());

    if (path === "/previous" && method === "POST")
      return json(res, 200, await voPrevious());

    if (path === "/act" && method === "POST")
      return json(res, 200, await voAct());

    if (path === "/perform" && method === "POST") {
      const { command } = JSON.parse(await readBody(req));
      return json(res, 200, await voPerform(command));
    }

    if (path === "/press" && method === "POST") {
      const { key, modifiers } = JSON.parse(await readBody(req));
      return json(res, 200, await voPress(key, modifiers));
    }

    if (path === "/enter" && method === "POST")
      return json(res, 200, await voEnter());

    if (path === "/navigate" && method === "POST") {
      const { url: navUrl } = JSON.parse(await readBody(req));
      return json(res, 200, await navigate(navUrl));
    }

    if (path === "/item-text" && method === "GET") {
      const itemText = await voiceOver.itemText();
      return json(res, 200, parseVoResponse("", itemText));
    }

    if (path === "/transcript" && method === "GET") {
      const since = url.searchParams.get("since");
      const entries = since !== null ? getTranscript(parseInt(since)) : getTranscript();
      return json(res, 200, { entries, length: state.transcript.length });
    }

    if (path === "/transcript" && method === "DELETE") {
      const entries = clearTranscript();
      return json(res, 200, { cleared: entries.length });
    }

    if (path === "/commands" && method === "GET") {
      const filter = url.searchParams.get("filter") || "";
      let cmds = Object.keys(COMMANDS);
      if (filter) cmds = cmds.filter((c) => c.toLowerCase().includes(filter.toLowerCase()));
      return json(res, 200, { commands: cmds });
    }

    if (path === "/stop" && method === "POST") {
      json(res, 200, { success: true });
      setImmediate(async () => {
        await cleanup();
        try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch {}
        process.exit(0);
      });
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    log(`HTTP error: ${e.message}`, true);
    json(res, 500, { error: e.message });
  }
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

async function startServer(port, cdpPort, url) {
  await initialize(url, cdpPort);

  const server = createServer(handle);
  await new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      log(`Server on http://127.0.0.1:${port}, CDP on port ${cdpPort}`);
      console.log(`Server ready on http://127.0.0.1:${port}`);
      console.log(`CDP available on ws://127.0.0.1:${cdpPort}`);
      try { writeFileSync(PID_FILE, process.pid.toString()); } catch {}
      resolve();
    });
  });

  // Enter web content after server is listening (so CLI can connect)
  if (url) {
    try {
      await voEnter();
    } catch (e) { log(`auto-enter warning: ${e.message}`); }
  }

  const shutdown = async () => {
    server.close();
    const timer = setTimeout(() => process.exit(1), 5000);
    await cleanup();
    clearTimeout(timer);
    try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ---------------------------------------------------------------------------
// CLI client
// ---------------------------------------------------------------------------

async function cli(args, port) {
  const [cmd, ...rest] = args;
  const base = `http://127.0.0.1:${port}`;

  // Parse --json flag from rest args
  const jsonFlag = rest.includes("--json");
  const cleanRest = rest.filter((a) => a !== "--json");

  // Helpers
  const post = async (path, body) => {
    const r = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json();
    if (!r.ok || d.error) {
      console.error(`Error: ${d.error}`);
      process.exit(1);
    }
    return d;
  };

  const get = async (path) => {
    const r = await fetch(`${base}${path}`);
    return r.json();
  };

  const printVO = (d) => {
    if (jsonFlag) {
      console.log(JSON.stringify(d));
    } else {
      if (d.spoken) console.log(`Spoken: "${d.spoken}"`);
      if (d.name) console.log(`Name: "${d.name}"`);
      if (d.role) console.log(`Role: "${d.role}"`);
    }
  };

  switch (cmd) {
    case "start": {
      const url = cleanRest[0] || "about:blank";
      console.log(`Starting vo-driver...`);

      // Already running?
      try {
        const r = await fetch(`${base}/`);
        if (r.ok) {
          const d = await r.json();
          console.log(`Already running. CDP on ws://127.0.0.1:${d.cdpPort}`);
          if (url !== "about:blank") {
            const nav = await post("/navigate", { url });
            printVO(nav);
          }
          return;
        }
      } catch {}

      // Clean stale PID
      if (existsSync(PID_FILE)) { try { unlinkSync(PID_FILE); } catch {} }

      // Parse cdp-port for the daemon
      const cdpIdx = args.indexOf("--cdp-port");
      const cdpPort = cdpIdx !== -1 ? args[cdpIdx + 1] : DEFAULT_CDP_PORT;

      // Spawn daemon with URL — it handles navigate + enter internally
      const serveArgs = [
        process.argv[1], "serve",
        "--port", port.toString(),
        "--cdp-port", cdpPort.toString(),
      ];
      if (url !== "about:blank") serveArgs.push(url);

      const child = spawn(process.argv[0], serveArgs, { detached: true, stdio: "ignore" });
      child.unref();

      // Poll until ready
      for (let i = 0; i < 200; i++) {
        try { const r = await fetch(`${base}/`); if (r.ok) break; } catch {}
        if (i === 199) { console.error("Server failed to start"); process.exit(1); }
        await new Promise((r) => setTimeout(r, 200));
      }

      const status = await get("/");
      console.log(`Ready. CDP available on ws://127.0.0.1:${status.cdpPort}`);
      break;
    }

    case "enter":    printVO(await post("/enter")); break;
    case "next":     printVO(await post("/next")); break;
    case "previous": printVO(await post("/previous")); break;
    case "act":      printVO(await post("/act")); break;

    case "press": {
      if (!cleanRest[0]) { console.error("press requires a key name"); process.exit(1); }
      const d = await post("/press", {
        key: cleanRest[0],
        modifiers: cleanRest.slice(1).flatMap((m) => m.split(",")).filter(Boolean),
      });
      printVO(d);
      break;
    }

    case "perform": {
      if (!cleanRest[0]) { console.error("perform requires a command name"); process.exit(1); }
      const d = await post("/perform", { command: cleanRest[0] });
      if (!jsonFlag) console.log(`Performed: ${cleanRest[0]}`);
      printVO(d);
      break;
    }

    case "navigate": {
      if (!cleanRest[0]) { console.error("navigate requires a URL"); process.exit(1); }
      const d = await post("/navigate", { url: cleanRest[0] });
      if (!jsonFlag) console.log(`Navigated to ${cleanRest[0]}`);
      printVO(d);
      break;
    }

    case "item-text": {
      const d = await get("/item-text");
      if (jsonFlag) console.log(JSON.stringify(d));
      else {
        if (d.name) console.log(`Name: "${d.name}"`);
        if (d.role) console.log(`Role: "${d.role}"`);
      }
      break;
    }

    case "transcript": {
      const since = cleanRest[0] === "--since" ? cleanRest[1] : null;
      const clear = cleanRest.includes("--clear");

      if (clear) {
        const d = await fetch(`${base}/transcript`, { method: "DELETE" }).then((r) => r.json());
        if (jsonFlag) console.log(JSON.stringify(d));
        else console.log(`Cleared ${d.cleared} entries`);
      } else {
        const q = since !== null ? `?since=${since}` : "";
        const d = await get(`/transcript${q}`);
        if (jsonFlag) console.log(JSON.stringify(d));
        else d.entries.forEach((e) => console.log(`[${e.index}] ${e.role ? `(${e.role}) ` : ""}${e.name || e.spoken}`));
      }
      break;
    }

    case "commands": {
      const f = cleanRest[0] || "";
      const d = await get(`/commands?filter=${encodeURIComponent(f)}`);
      if (jsonFlag) console.log(JSON.stringify(d));
      else d.commands.forEach((c) => console.log(c));
      break;
    }

    case "status": {
      const d = await get("/");
      if (jsonFlag) console.log(JSON.stringify(d));
      else console.log(`Status: ${d.status}\nVoiceOver: ${d.voiceoverActive}\nURL: ${d.currentUrl || "(none)"}\nCDP: ws://127.0.0.1:${d.cdpPort}`);
      break;
    }

    case "stop": {
      try { await fetch(`${base}/stop`, { method: "POST" }); console.log("Stopped"); return; } catch {}
      if (existsSync(PID_FILE)) {
        const pid = parseInt(readFileSync(PID_FILE, "utf-8"));
        process.kill(pid, "SIGTERM");
        console.log(`Sent SIGTERM to ${pid}`);
      } else { console.error("No running server"); process.exit(1); }
      break;
    }

    case "kill": {
      if (!existsSync(PID_FILE)) { console.error("No PID file"); process.exit(1); }
      const pid = parseInt(readFileSync(PID_FILE, "utf-8"));
      process.kill(pid, "SIGKILL");
      unlinkSync(PID_FILE);
      spawnSync("osascript", ["-e", 'tell application "VoiceOver" to quit']);
      console.log("Killed");
      break;
    }

    default:
      console.error(`Unknown: ${cmd}`);
      console.error("Commands: start stop kill status enter navigate next previous act press perform transcript item-text commands");
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main — parse flags and dispatch
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getFlag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? parseInt(args[i + 1]) || fallback : fallback;
}

const port = getFlag("port", DEFAULT_PORT);
const cdpPort = getFlag("cdp-port", DEFAULT_CDP_PORT);

if (args[0] === "serve") {
  const rest = args.slice(1).filter((a, i, arr) => !a.startsWith("--") && !(i > 0 && arr[i - 1]?.startsWith("--")));
  startServer(port, cdpPort, rest[0] || null).catch((e) => { console.error(e.message); process.exit(1); });
} else {
  cli(args, port).catch((e) => { console.error(e.message); process.exit(1); });
}
