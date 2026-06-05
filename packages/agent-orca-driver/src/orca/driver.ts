/**
 * Orca screen reader driver — thin adapter that wraps core.ts in the
 * ScreenReaderDriver interface so the HTTP server can stay driver-agnostic.
 */

import type { ScreenReaderDriver } from "../interface.js";
import { ORCA_COMMANDS } from "../types.js";
import * as core from "./core.js";

export function createOrcaDriver(): ScreenReaderDriver {
  return {
    platform: "linux",
    name: "Orca",
    defaultPort: core.DEFAULT_PORT,
    defaultCdpPort: core.DEFAULT_CDP_PORT,
    logFile: core.LOG_FILE,
    pidFile: core.PID_FILE,
    stateFile: core.ORCA_STATE_FILE,
    cliTimeoutMs: core.CLI_TIMEOUT_MS,
    maxRequestBody: core.MAX_REQUEST_BODY,

    initialize: (url, cdpPort) => core.initialize(url, cdpPort),
    cleanup: () => core.cleanup(),
    removePidFile: () => {
      core.removePidFile();
    },

    getPage: () => core.getPage(),
    getStatus: () => {
      const s = core.getStatus();
      return { screenReaderActive: s.orcaActive, currentUrl: s.currentUrl, cdpPort: s.cdpPort };
    },
    getTranscriptLength: () => core.getTranscriptLength(),

    next: () => core.orcaNext(),
    previous: () => core.orcaPrevious(),
    act: () => core.orcaAct(),
    enter: () => core.orcaEnter(),
    navigate: (url) => core.navigate(url),

    perform: (command) => core.orcaPerform(command),
    press: (key, modifiers) => core.orcaPress(key, modifiers || []),

    getItemText: () => core.getItemText(),
    getTranscript: (since) => core.getTranscript(since),
    clearTranscript: () => core.clearTranscript(),
    getCommandNames: () => Object.keys(ORCA_COMMANDS),

    log: (msg, err) => {
      core.log(msg, err);
    },
  };
}
