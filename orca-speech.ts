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

import { writeFileSync, readFileSync, mkdirSync, existsSync, watchFile, unwatchFile, statSync } from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const SPEECH_LOG = "/tmp/orca-speech.log";

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
  return entries.filter(e => e.index >= marker);
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
  return since(marker).map(e => e.text).join(" ");
}

/**
 * Clear the buffer and reset the log file.
 */
export function clear(): number {
  const count = entries.length;
  entries = [];
  nextIndex = 0;
  filePos = 0;
  try { writeFileSync(SPEECH_LOG, ""); } catch {}
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

    const lines = newContent.split("\n").filter(l => l.trim());
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
  try { writeFileSync(SPEECH_LOG, ""); } catch {}
  filePos = 0;
  watching = true;

  // Poll-based watching (more reliable than fs.watch in containers)
  watchFile(SPEECH_LOG, { interval: 100 }, () => readNew());
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

# Hook SpeechServer._speak — the method that actually sends text to
# speech-dispatcher. This is the lowest level before SSIP, capturing
# ALL spoken text from Orca regardless of the speech path used.
_original_server_speak = sdf.SpeechServer._speak

def _capturing_server_speak(self, text, acss=None, **kwargs):
    try:
        if text and isinstance(text, str) and text.strip():
            with open("${SPEECH_LOG}", "a") as f:
                f.write(text.strip() + "\\n")
    except:
        pass
    return _original_server_speak(self, text, acss, **kwargs)

sdf.SpeechServer._speak = _capturing_server_speak
`;

const ORCA_CUSTOMIZATIONS_PATH = "~/.local/share/orca/orca-customizations.py";

/**
 * Set up speech-dispatcher to capture speech via our custom sd_generic module.
 * This must be called before Orca starts (Orca auto-starts speech-dispatcher).
 */
export function ensureSpeechCapture(log: (msg: string) => void): void {
  // Install Orca customization that hooks into speech.speak() to capture
  // all spoken text. This is the same mechanism Orca's Speech Monitor uses.
  const orcaDir = join(homedir(), ".local", "share", "orca");
  mkdirSync(orcaDir, { recursive: true });

  const customPath = join(orcaDir, "orca-customizations.py");
  writeFileSync(customPath, ORCA_CUSTOMIZATIONS);

  // Kill any existing Orca so it restarts with our customizations
  try { execSync("pkill -x orca", { stdio: "pipe" }); } catch {}

  // Clear and start watching the log file
  clear();
  startWatching();

  log("Speech capture configured (Orca customizations → " + SPEECH_LOG + ")");
}
