/**
 * Speech capture for Orca via orca-customizations.py hook.
 *
 * Orca loads ~/.local/share/orca/orca-customizations.py at startup.
 * We install a hook that monkey-patches Orca's speech.speak() to log
 * all spoken text to a file. This is the same mechanism Orca's own
 * Speech Monitor uses internally.
 *
 * The log file is tailed by this module, providing a timestamped buffer
 * with mark/since semantics matching the VoiceOver driver's transcript.
 */

import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  watchFile,
  unwatchFile,
  statSync,
} from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { runtimePath, safeWriteSync } from "../runtime-paths.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const SPEECH_LOG = runtimePath("orca-speech.log");

// ---------------------------------------------------------------------------
// Speech buffer
// ---------------------------------------------------------------------------

export interface SpeechEntry {
  text: string;
  timestamp: number;
  index: number;
}

let entries: SpeechEntry[] = [];
let nextIndex = 0;
let filePos = 0;
let watching = false;

/**
 * Mark the current position in the buffer.
 * Call this before sending a keystroke, then call since() after settling.
 */
export function mark(): number {
  return nextIndex;
}

/**
 * Get all speech entries since a given marker.
 */
export function since(marker: number): SpeechEntry[] {
  return entries.filter((e) => e.index >= marker);
}

/**
 * Get the last N entries (or all if N not specified).
 */
export function lastEntries(n?: number): SpeechEntry[] {
  if (n === undefined) return [...entries];
  return entries.slice(-n);
}

/**
 * Get the combined spoken text since a marker, joined with spaces.
 */
export function spokenSince(marker: number): string {
  return since(marker)
    .map((e) => e.text)
    .join(" ");
}

/**
 * Clear the buffer and reset the log file.
 */
export function clear(): number {
  const count = entries.length;
  entries = [];
  nextIndex = 0;
  filePos = 0;
  try {
    safeWriteSync(SPEECH_LOG, "");
  } catch {}
  return count;
}

/**
 * Read any new content from the speech log file.
 */
function readNew(): void {
  try {
    const stat = statSync(SPEECH_LOG);
    if (stat.size <= filePos) return;
    const content = readFileSync(SPEECH_LOG, "utf-8");
    const newContent = content.slice(filePos);
    filePos = content.length;

    const lines = newContent.split("\n").filter((l) => l.trim());
    const now = Date.now();
    for (const line of lines) {
      entries.push({
        text: line.trim(),
        timestamp: now,
        index: nextIndex++,
      });
    }
  } catch {
    // File may not exist yet
  }
}

/**
 * Start watching the speech log file for changes.
 */
export function startWatching(): void {
  if (watching) return;
  try {
    safeWriteSync(SPEECH_LOG, "");
  } catch {}
  filePos = 0;
  watching = true;

  // Poll-based watching (more reliable than fs.watch in containers)
  watchFile(SPEECH_LOG, { interval: 100 }, () => {
    readNew();
  });
}

/**
 * Stop watching and clean up.
 */
export function stopWatching(): void {
  if (!watching) return;
  unwatchFile(SPEECH_LOG);
  watching = false;
}

/**
 * Force a read of any pending speech data.
 * Call this after a settle delay to ensure all data is captured.
 */
export function flush(): void {
  readNew();
}

// ---------------------------------------------------------------------------
// Speech-dispatcher configuration
// ---------------------------------------------------------------------------

// Orca customizations hook: monkey-patches Orca's speech presenter to
// log all spoken text to our log file. This is the same mechanism Orca's
// own Speech Monitor uses. It hooks into speak() at the Python level,
// capturing text before it goes to speech-dispatcher.
const ORCA_CUSTOMIZATIONS = `
import orca.speechdispatcherfactory as sdf
import orca.speech as speech_mod

# Hook both module-level speech._speak AND SpeechServer._speak.
# Orca's structural navigation (h=heading, k=link) goes through
# speech_mod._speak, while Tab/focus changes go through
# SpeechServer._speak. We need both to capture all speech.

_log_path = "${SPEECH_LOG}"
_seen = set()  # deduplicate within same call

def _log(text):
    if text and isinstance(text, str) and text.strip():
        t = text.strip()
        if t not in _seen:
            _seen.add(t)
            with open(_log_path, "a") as f:
                f.write(t + "\\n")

# Hook 1: module-level _speak (catches structural navigation speech)
_orig_mod = speech_mod._speak
def _hook_mod(text, acss=None, interrupt=True):
    try: _log(text)
    except: pass
    if interrupt: _seen.clear()
    return _orig_mod(text, acss, interrupt)
speech_mod._speak = _hook_mod

# Hook 2: SpeechServer._speak (catches focus-change speech)
_orig_srv = sdf.SpeechServer._speak
def _hook_srv(self, text, acss=None, **kw):
    try: _log(text)
    except: pass
    return _orig_srv(self, text, acss, **kw)
sdf.SpeechServer._speak = _hook_srv
`;

/**
 * Install the Orca customization hook and start watching the speech log.
 * Must be called before Orca starts.
 */
export function ensureSpeechCapture(log: (msg: string) => void): void {
  // Install Orca customization that hooks into speech.speak() to capture
  // all spoken text. This is the same mechanism Orca's Speech Monitor uses.
  const orcaDir = join(homedir(), ".local", "share", "orca");
  mkdirSync(orcaDir, { recursive: true });

  const customPath = join(orcaDir, "orca-customizations.py");
  writeFileSync(customPath, ORCA_CUSTOMIZATIONS);

  // Kill any existing Orca so it restarts with our customizations
  try {
    execSync("pkill -x orca", { stdio: "pipe" });
  } catch {}

  // Clear and start watching the log file
  clear();
  startWatching();

  log("Speech capture configured (Orca customizations → " + SPEECH_LOG + ")");
}
