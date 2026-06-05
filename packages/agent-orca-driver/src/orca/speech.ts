/**
 * Speech capture for Orca via orca-customizations.py hook.
 *
 * Orca loads ~/.local/share/orca/orca-customizations.py at startup. We install
 * a hook that monkey-patches Orca's speech.speak() to log all spoken text to
 * a file — the same mechanism Orca's own Speech Monitor uses internally.
 *
 * The log file is tailed by this module, providing a timestamped buffer with
 * mark/since semantics so callers can pair a keystroke with the speech it
 * produced.
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
import { runtimePath, safeWriteSync } from "../lib/runtime-paths.js";

export const SPEECH_LOG = runtimePath("orca-speech.log");

export interface SpeechEntry {
  text: string;
  timestamp: number;
  index: number;
}

let entries: SpeechEntry[] = [];
let nextIndex = 0;
let filePos = 0;
let watching = false;

export function mark(): number {
  return nextIndex;
}

export function since(marker: number): SpeechEntry[] {
  return entries.filter((e) => e.index >= marker);
}

export function lastEntries(n?: number): SpeechEntry[] {
  if (n === undefined) return [...entries];
  return entries.slice(-n);
}

export function spokenSince(marker: number): string {
  return since(marker)
    .map((e) => e.text)
    .join(" ");
}

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

export function stopWatching(): void {
  if (!watching) return;
  unwatchFile(SPEECH_LOG);
  watching = false;
}

export function flush(): void {
  readNew();
}

// ---------------------------------------------------------------------------
// Orca customizations hook
// ---------------------------------------------------------------------------

// Hooks both module-level speech._speak AND SpeechServer._speak. Orca's
// structural navigation (h=heading, k=link) goes through speech_mod._speak,
// while Tab/focus changes go through SpeechServer._speak. We need both to
// capture all speech.
const ORCA_CUSTOMIZATIONS = `
import orca.speechdispatcherfactory as sdf
import orca.speech as speech_mod

_log_path = "${SPEECH_LOG}"
_seen = set()  # deduplicate within same call

def _log(text):
    if text and isinstance(text, str) and text.strip():
        t = text.strip()
        if t not in _seen:
            _seen.add(t)
            with open(_log_path, "a") as f:
                f.write(t + "\\n")

_orig_mod = speech_mod._speak
def _hook_mod(text, acss=None, interrupt=True):
    try: _log(text)
    except: pass
    if interrupt: _seen.clear()
    return _orig_mod(text, acss, interrupt)
speech_mod._speak = _hook_mod

_orig_srv = sdf.SpeechServer._speak
def _hook_srv(self, text, acss=None, **kw):
    try: _log(text)
    except: pass
    return _orig_srv(self, text, acss, **kw)
sdf.SpeechServer._speak = _hook_srv
`;

export function ensureSpeechCapture(log: (msg: string) => void): void {
  const orcaDir = join(homedir(), ".local", "share", "orca");
  mkdirSync(orcaDir, { recursive: true });

  const customPath = join(orcaDir, "orca-customizations.py");
  writeFileSync(customPath, ORCA_CUSTOMIZATIONS);

  // Kill any existing Orca so it restarts with our customizations
  try {
    execSync("pkill -x orca", { stdio: "pipe" });
  } catch {}

  clear();
  startWatching();

  log("Speech capture configured (Orca customizations → " + SPEECH_LOG + ")");
}
