/**
 * Orca screen reader driver for Linux.
 *
 * Wraps orca-core.ts functionality behind the ScreenReaderDriver interface.
 * This is a thin adapter — it delegates to the existing orca-core module.
 */

import type { ScreenReaderDriver } from "../drivers/interface.ts";
import type { VoResult, TranscriptEntry } from "../drivers/types.ts";
import { ORCA_COMMANDS } from "../drivers/types.ts";
import type { Page } from "playwright";

let core: typeof import("../drivers/orca/core.ts") | null = null;

async function getCore() {
  if (!core) core = await import("../drivers/orca/core.ts");
  return core;
}

export async function createOrcaDriver(): Promise<ScreenReaderDriver> {
  const c = await getCore();

  return {
    platform: "linux",
    name: "Orca",
    defaultPort: c.DEFAULT_PORT,
    defaultCdpPort: c.DEFAULT_CDP_PORT,
    logFile: c.LOG_FILE,
    pidFile: c.PID_FILE,
    stateFile: c.ORCA_STATE_FILE,
    cliTimeoutMs: c.CLI_TIMEOUT_MS,
    maxRequestBody: c.MAX_REQUEST_BODY,

    initialize: (url, cdpPort) => c.initialize(url, cdpPort),
    cleanup: () => c.cleanup(),
    removePidFile: () => c.removePidFile(),

    getPage: () => c.getPage(),
    getStatus: () => {
      const s = c.getStatus();
      return { screenReaderActive: s.orcaActive, currentUrl: s.currentUrl, cdpPort: s.cdpPort };
    },
    getTranscriptLength: () => c.getTranscriptLength(),

    next: () => c.orcaNext(),
    previous: () => c.orcaPrevious(),
    act: () => c.orcaAct(),
    enter: () => c.orcaEnter(),
    navigate: (url) => c.navigate(url),

    perform: (command) => c.orcaPerform(command),
    press: (key, modifiers) => c.orcaPress(key, modifiers || []),

    getItemText: () => c.getItemText(),
    getTranscript: (since) => c.getTranscript(since),
    clearTranscript: () => c.clearTranscript(),
    getCommandNames: () => Object.keys(ORCA_COMMANDS),

    log: (msg, err) => c.log(msg, err),
  };
}
