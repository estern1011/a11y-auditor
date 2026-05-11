/**
 * Per-user runtime paths for driver state, PID, and log files.
 *
 * Replaces the original `/tmp/{vo,orca}-driver.{pid,log}` paths, which were
 * world-writable on shared hosts and let an unprivileged local user pre-create
 * a symlink at any of them. `writeFileSync` follows symlinks, so the link
 * target would be truncated or overwritten — and the PID file was then read
 * back and passed to `process.kill`, letting the attacker kill an arbitrary
 * process the driver user owns.
 *
 * Mitigations layered here:
 * 1. Files live in a per-user directory (`$XDG_RUNTIME_DIR/a11y-auditor` or
 *    `$HOME/.cache/a11y-auditor`), created with mode 0700.
 * 2. Writes go through `safeWriteSync` / `safeAppendSync` which open with
 *    `O_NOFOLLOW` — refusing to traverse a symlink even if one is somehow
 *    planted in the user's own directory.
 * 3. The PID file is validated with `lstatSync` (NOT `statSync`, which
 *    silently follows symlinks) before reading; the read itself also uses
 *    `O_NOFOLLOW` to close the TOCTOU window between lstat and open.
 */

import { mkdirSync, openSync, closeSync, writeSync, readFileSync, lstatSync, constants } from "fs";
import { homedir } from "os";
import { join } from "path";

let cachedDir: string | null = null;

export function getRuntimeDir(): string {
  if (cachedDir) return cachedDir;
  const base = process.env.XDG_RUNTIME_DIR || join(homedir(), ".cache");
  const dir = join(base, "a11y-auditor");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  cachedDir = dir;
  return dir;
}

export function runtimePath(name: string): string {
  return join(getRuntimeDir(), name);
}

// O_NOFOLLOW: if the path is a symlink, openSync throws ELOOP instead of
// following the link. (Node's fs always sets O_CLOEXEC internally.)
const NOFOLLOW = constants.O_NOFOLLOW;

export function safeWriteSync(path: string, data: string): void {
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | NOFOLLOW,
    0o600,
  );
  try {
    writeSync(fd, data);
  } finally {
    closeSync(fd);
  }
}

export function safeAppendSync(path: string, data: string): void {
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | NOFOLLOW,
    0o600,
  );
  try {
    writeSync(fd, data);
  } finally {
    closeSync(fd);
  }
}

/**
 * Read a PID from a file, refusing to follow symlinks or read non-regular
 * files. Returns null if the file is missing or unsafe.
 */
export function readPidFile(path: string): number | null {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return null;
  }
  if (st.isSymbolicLink() || !st.isFile()) return null;
  const euid = process.geteuid?.();
  if (euid !== undefined && st.uid !== euid) return null;

  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const pid = parseInt(readFileSync(fd, "utf-8"), 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } finally {
    closeSync(fd);
  }
}
