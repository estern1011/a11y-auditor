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
  existsSync,
  renameSync,
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

# The log path is encoded via JSON.stringify on the Node side. A JSON string
# literal is a valid Python string literal for our character set, so a path
# whose components contain a quote or backslash (via $XDG_RUNTIME_DIR or an
# exotic $HOME) can't break out of the literal and run arbitrary Python
# inside Orca.
_log_path = ${JSON.stringify(SPEECH_LOG)}
# Dedup window. The SAME utterance flows through BOTH _hook_mod and
# _hook_srv (the module-level _speak typically calls into SpeechServer),
# so we'd log every string twice without this. _seen suppresses the
# duplicate within one utterance.
#
# The window resets if more than DEDUP_WINDOW_MS milliseconds have
# passed since the last log call — this matters for utterances that
# bypass _hook_mod and go straight through _hook_srv (focus changes,
# Tab cycles). Without the time-based reset, a label like "Submit" or
# a role like "button" said once via SpeechServer would be suppressed
# for the rest of the session, which silently corrupted transcripts on
# any page with repeated labels.
import time
_seen = set()
_last_log_ms = 0
DEDUP_WINDOW_MS = 250  # generous: one utterance fits comfortably in this

def _log(text):
    global _last_log_ms
    if not (text and isinstance(text, str) and text.strip()):
        return
    now_ms = time.monotonic() * 1000.0
    if now_ms - _last_log_ms > DEDUP_WINDOW_MS:
        _seen.clear()
    _last_log_ms = now_ms
    t = text.strip()
    if t not in _seen:
        _seen.add(t)
        with open(_log_path, "a") as f:
            f.write(t + "\\n")

_orig_mod = speech_mod._speak
def _hook_mod(text, acss=None, interrupt=True):
    if interrupt: _seen.clear()
    try: _log(text)
    except: pass
    return _orig_mod(text, acss, interrupt)
speech_mod._speak = _hook_mod

_orig_srv = sdf.SpeechServer._speak
def _hook_srv(self, text, acss=None, **kw):
    try: _log(text)
    except: pass
    return _orig_srv(self, text, acss, **kw)
sdf.SpeechServer._speak = _hook_srv
`;

// A pre-existing orca-customizations.py belongs to the user — keybinding
// rebinds, alternative speech config, third-party scripts. Silently
// overwriting it would lose data and the cleanup path can't restore from
// memory either. Move the original to `.bak-<timestamp>` and log the path
// so the user can find + restore (or merge) after they're done with us.
function backupExistingCustomizations(customPath: string, log: (msg: string, err?: boolean) => void): void {
  if (!existsSync(customPath)) return;
  let existing: string;
  try { existing = readFileSync(customPath, "utf-8"); } catch { return; }
  if (existing === ORCA_CUSTOMIZATIONS) return; // already ours — idempotent
  // Don't churn backups on every daemon restart if the user-content hasn't
  // changed since the first backup. Only back up the FIRST time we see a
  // non-empty, non-ours file.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${customPath}.bak-${stamp}`;
  try {
    renameSync(customPath, backupPath);
    log(`existing orca-customizations.py backed up to ${backupPath} — restore manually after the daemon exits`, true);
  } catch (e) {
    log(`failed to back up existing orca-customizations.py: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

export function ensureSpeechCapture(log: (msg: string, err?: boolean) => void): void {
  const orcaDir = join(homedir(), ".local", "share", "orca");
  mkdirSync(orcaDir, { recursive: true });

  const customPath = join(orcaDir, "orca-customizations.py");
  backupExistingCustomizations(customPath, log);
  writeFileSync(customPath, ORCA_CUSTOMIZATIONS);

  // NOTE: this function used to `pkill -x orca` here unconditionally so
  // an already-running Orca would pick up the customizations on restart.
  // That silently destroyed the user's existing accessibility session on
  // a real Linux desktop AND defeated the weStartedOrca cleanup guard
  // in core.ts (by the time startOrca() checked isOrcaRunning(), the kill
  // had already happened — daemon then thought it had a clean-start
  // ownership and shut Orca down on exit). The Orca lifecycle is now
  // the caller's responsibility (see core.ts initialize).

  clear();
  startWatching();

  log("Speech capture configured (Orca customizations → " + SPEECH_LOG + ")");
}
