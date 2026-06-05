/**
 * Per-user runtime paths for the daemon's state, PID, and log files.
 *
 * Files live in a per-user directory (`$XDG_RUNTIME_DIR/agent-orca-driver` or
 * `$HOME/.cache/agent-orca-driver`), created with mode 0700. Writes go through
 * `safeWriteSync` / `safeAppendSync` which open with `O_NOFOLLOW` — refusing
 * to traverse a symlink. The PID file is validated with `lstatSync` (NOT
 * `statSync`, which silently follows symlinks) before reading; the read
 * itself also uses `O_NOFOLLOW` to close the TOCTOU window.
 */

import {
  mkdirSync,
  openSync,
  closeSync,
  writeSync,
  readFileSync,
  lstatSync,
  constants,
} from "fs";
import { homedir } from "os";
import { join } from "path";

const PACKAGE_DIR = "agent-orca-driver";

let cachedDir: string | null = null;

export function getRuntimeDir(): string {
  if (cachedDir) return cachedDir;
  const base = process.env.XDG_RUNTIME_DIR || join(homedir(), ".cache");
  const dir = join(base, PACKAGE_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  cachedDir = dir;
  return dir;
}

export function runtimePath(name: string): string {
  return join(getRuntimeDir(), name);
}

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
