/**
 * A complete ScreenReaderDriver implementation backed by an in-memory state
 * machine. The real Orca driver depends on D-Bus + AT-SPI2 + Orca + Xvfb +
 * speech-dispatcher; for the e2e harness those pieces aren't available, but
 * the SERVER's contract is just the ScreenReaderDriver interface. A faithful
 * fake lets us exercise every documented HTTP route, the security gates, the
 * /events fan-out, and the /stream ref-count without any of the Linux-only
 * bits.
 *
 * What we DON'T cover with the fake:
 *   - Real Orca speech capture (speech.ts)
 *   - Real AT-SPI2 tree walks (atspi.ts)
 *   - The Orca-customizations.py hook
 *
 * Those require a real Linux desktop with Orca installed — a sprite session.
 * The fake's contract-level behavior covers everything OUTSIDE that path.
 */

import { liveEvents } from "../../dist/src/live/events.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

let counter = 0;
function tmpPath(name) {
  counter++;
  return join(tmpdir(), `agent-orca-driver-e2e-${process.pid}-${counter}-${name}`);
}

export function createFakeDriver(opts = {}) {
  const log = opts.log || (() => {});

  const state = {
    transcript: [],
    nextIndex: 0,
    currentUrl: null,
    cdpPort: 0,
    screenReaderActive: true,
    keystrokes: [], // recorded for test inspection
    performed: [],
  };

  function record(entry) {
    state.nextIndex++;
    const indexed = { ...entry, index: state.nextIndex };
    state.transcript.push(indexed);
    try {
      liveEvents.emitTranscript({ source: "orca", text: entry.spoken });
      if (entry.bbox) {
        liveEvents.emitFocus({ role: entry.role, name: entry.name, bbox: entry.bbox });
      }
    } catch { /* never let liveEvents break the driver */ }
    return indexed;
  }

  return {
    platform: "linux",
    name: "Fake",
    defaultPort: 8001,
    defaultCdpPort: 9223,
    logFile: tmpPath("driver.log"),
    pidFile: tmpPath("driver.pid"),
    stateFile: tmpPath("driver.state"),
    cliTimeoutMs: 5_000,
    maxRequestBody: 1_000_000,

    initialize: async (url, cdpPort) => {
      state.currentUrl = url;
      state.cdpPort = cdpPort;
    },
    cleanup: async () => {},
    removePidFile: () => {},

    getPage: () => null,
    getStatus: () => ({
      screenReaderActive: state.screenReaderActive,
      currentUrl: state.currentUrl,
      cdpPort: state.cdpPort,
    }),
    getTranscriptLength: () => state.transcript.length,
    // Cursor contract (see interface.ts): the value a client passes back as
    // `since=` to get only newer entries. This fake uses PRE-increment
    // indexing (first entry = 1), so the highest assigned index IS
    // nextIndex, and 0 when empty (since=0 → everything).
    getTranscriptCursor: () => state.nextIndex,

    next: async () => record({
      spoken: "Main, navigation",
      name: "Main",
      role: "navigation",
      state: ["focused"],
      bbox: { x: 100, y: 100, w: 50, h: 20 },
    }),
    previous: async () => record({
      spoken: "Skip to content, link",
      name: "Skip to content",
      role: "link",
      state: ["focused"],
    }),
    act: async () => record({ spoken: "Activated", name: "", role: "", state: [] }),
    enter: async () => record({
      spoken: "Web content",
      name: "Web content",
      role: "document web",
      state: [],
    }),
    navigate: async (url) => {
      state.currentUrl = url;
      return record({
        spoken: `Loaded ${url}`,
        name: url,
        role: "document web",
        state: [],
      });
    },

    perform: async (command) => {
      state.performed.push(command);
      return record({
        spoken: `performed ${command}`,
        name: command,
        role: "",
        state: [],
      });
    },
    press: async (key, modifiers) => {
      state.keystrokes.push({ key, modifiers: modifiers || [] });
      return record({
        spoken: `pressed ${key}`,
        name: key,
        role: "",
        state: [],
      });
    },

    getItemText: async () => ({ spoken: "current item", name: "current", role: "text", state: [] }),
    getTranscript: (since) =>
      since !== undefined ? state.transcript.filter((e) => e.index > since) : [...state.transcript],
    clearTranscript: () => {
      const entries = [...state.transcript];
      state.transcript = [];
      return entries;
    },
    getCommandNames: () => [
      "FIND_NEXT_HEADING",
      "FIND_NEXT_LANDMARK",
      "READ_CURRENT_LINE",
      "SAY_ALL",
      "FIND_NEXT_BUTTON",
    ],

    log,

    // Expose internal state for test inspection (not part of the interface).
    _state: state,
  };
}
