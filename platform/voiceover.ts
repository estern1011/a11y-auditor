/**
 * VoiceOver screen reader driver for macOS.
 *
 * Wraps vo-core.ts functionality behind the ScreenReaderDriver interface.
 * This is a thin adapter — it delegates to the existing vo-core module
 * rather than duplicating its logic.
 */

import type { ScreenReaderDriver } from "../driver-interface.ts";
import type { VoResult, TranscriptEntry } from "../types.ts";
import { VOICEOVER_COMMANDS } from "../types.ts";
import type { Page } from "playwright";

// Lazy-import vo-core to avoid loading guidepup on Linux
let core: typeof import("../vo-core.ts") | null = null;

async function getCore() {
  if (!core) core = await import("../vo-core.ts");
  return core;
}

export async function createVoiceOverDriver(): Promise<ScreenReaderDriver> {
  const c = await getCore();

  return {
    platform: "macos",
    name: "VoiceOver",
    defaultPort: c.DEFAULT_PORT,
    defaultCdpPort: c.DEFAULT_CDP_PORT,
    logFile: c.LOG_FILE,
    pidFile: c.PID_FILE,
    stateFile: c.VO_STATE_FILE,
    cliTimeoutMs: c.CLI_TIMEOUT_MS,
    maxRequestBody: c.MAX_REQUEST_BODY,

    initialize: (url, cdpPort) => c.initialize(url, cdpPort),
    cleanup: () => c.cleanup(),
    removePidFile: () => c.removePidFile(),

    getPage: () => c.getPage(),
    getStatus: () => {
      const s = c.getStatus();
      return { screenReaderActive: s.voiceoverActive, currentUrl: s.currentUrl, cdpPort: s.cdpPort };
    },
    getTranscriptLength: () => c.getTranscriptLength(),

    next: () => c.voNext(),
    previous: () => c.voPrevious(),
    act: () => c.voAct(),
    enter: () => c.voEnter(),
    navigate: (url) => c.navigate(url),

    perform: (command) => c.voPerform(command),
    press: (key, modifiers) => c.voPress(key, modifiers || []),

    getItemText: () => c.getItemText(),
    getTranscript: (since) => c.getTranscript(since),
    clearTranscript: () => c.clearTranscript(),
    getCommandNames: () => Object.keys(VOICEOVER_COMMANDS),

    log: (msg, err) => c.log(msg, err),
  };
}
