import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface StartDriverInput {
  sr: "voiceover" | "orca";
  url: string;
  viewport: { w: number; h: number };
}

export interface StartDriverResult {
  driverPort: number;
  cdpPort: number;
  /** Kills the spawned driver child and reaps it. Safe to call more than once. */
  stop: () => Promise<void>;
}

// Path to this module, used to resolve driver scripts relative to the repo root
// regardless of the caller's cwd.
const RUNNER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(RUNNER_DIR, "..", "..");

const DRIVER_SCRIPTS: Record<StartDriverInput["sr"], string> = {
  voiceover: resolve(REPO_ROOT, "drivers", "voiceover", "driver.ts"),
  orca: resolve(REPO_ROOT, "drivers", "orca", "driver.ts"),
};

// Poll parameters for the driver health check. ~15s total (250ms × 60 tries).
const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = 15_000;

export interface WaitForHttpOkOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** Optional abort signal; when aborted the poller rejects immediately. */
  signal?: AbortSignal;
}

// Ports are chosen by having the OS assign them via listen(0), then releasing
// the socket and handing the number to the driver child. There is an
// unavoidable race between release and re-bind; the task explicitly accepts it
// and prefers loud failure (caught by the /status poll) over fragile retry.
export async function findFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object" && typeof addr.port === "number") {
        const port = addr.port;
        server.close((err) => (err ? rejectPort(err) : resolvePort(port)));
      } else {
        server.close();
        rejectPort(new Error("Failed to obtain free port: no address"));
      }
    });
  });
}

export async function findFreePortPair(): Promise<{ driverPort: number; cdpPort: number }> {
  // Pick sequentially; two parallel listen(0) calls can collide on the same
  // port since each close happens after the other binds.
  const driverPort = await findFreePort();
  let cdpPort = await findFreePort();
  if (cdpPort === driverPort) {
    cdpPort = await findFreePort();
    if (cdpPort === driverPort) {
      throw new Error(`free-port picker returned duplicate ports: ${driverPort}`);
    }
  }
  return { driverPort, cdpPort };
}

/** Poll an HTTP endpoint until it returns a 2xx response, or throw on timeout. */
export async function waitForHttpOk(
  port: number,
  path = "/",
  opts: WaitForHttpOkOptions = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? POLL_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}${path}`;

  let lastError: unknown;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error("waitForHttpOk aborted");
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(intervalMs * 4) });
      // Consume body so the connection is freed for Bun.
      await res.arrayBuffer().catch(() => undefined);
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
    }
    await Bun.sleep(intervalMs);
  }
  const detail =
    lastError instanceof Error
      ? lastError.message
      : typeof lastError === "string"
        ? lastError
        : "unknown";
  throw new Error(`timed out after ${String(timeoutMs)}ms waiting for ${url}: ${detail}`, {
    cause: lastError,
  });
}

export interface SpawnDaemonInput {
  /** Absolute path to a bun-executable script that listens on `port`. */
  script: string;
  /** Positional + flag args appended after the script path. */
  args: readonly string[];
  /** Port the daemon will bind; `waitForHttpOk` polls it. */
  port: number;
  /** Health-check path (default `/`). */
  readyPath?: string;
  timeoutMs?: number;
  intervalMs?: number;
}

export interface SpawnDaemonResult {
  stop: StartDriverResult["stop"];
}

// Low-level helper: spawn a bun child, wait for its HTTP server to come up,
// return a stop() that reaps it. Exported so tests can exercise the
// spawn/poll/stop loop against a fake daemon without needing orca or
// VoiceOver installed.
export async function spawnDaemon(input: SpawnDaemonInput): Promise<SpawnDaemonResult> {
  const child = Bun.spawn(["bun", input.script, ...input.args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  // Tee stderr into a buffer so we can include it in the timeout error without
  // blocking the child's pipe.
  const stderrChunks: string[] = [];
  const stderrDone = (async () => {
    try {
      for await (const chunk of child.stderr as ReadableStream<Uint8Array>) {
        stderrChunks.push(new TextDecoder().decode(chunk));
      }
    } catch {
      // Pipe closed on kill — expected.
    }
  })();

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    try {
      child.kill("SIGTERM");
      // Give the daemon up to 2s to shut down gracefully; then SIGKILL.
      const exited = await Promise.race([
        child.exited.then(() => true),
        Bun.sleep(2000).then(() => false),
      ]);
      if (!exited) {
        child.kill("SIGKILL");
        await child.exited;
      }
    } catch {
      // Child already gone.
    }
    await stderrDone.catch(() => undefined);
  };

  try {
    await waitForHttpOk(input.port, input.readyPath ?? "/", {
      timeoutMs: input.timeoutMs ?? POLL_TIMEOUT_MS,
      intervalMs: input.intervalMs ?? POLL_INTERVAL_MS,
    });
  } catch (err) {
    await stop();
    const stderr = stderrChunks.join("").trim();
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `daemon failed to become ready: ${detail}${stderr ? `\n--- stderr ---\n${stderr}` : ""}`,
      { cause: err },
    );
  }

  return { stop };
}

// Wraps the screen-reader driver daemon as a child process. On success returns
// the ports it's listening on plus a stop() handle the caller must invoke (e.g.
// in a finally block) to avoid leaking daemons between runs.
export async function startDriver(input: StartDriverInput): Promise<StartDriverResult> {
  void input.viewport; // reserved for future use (viewport is applied by collect.ts navigate)

  const script = DRIVER_SCRIPTS[input.sr];
  if (!script) throw new Error(`Unknown screen reader: ${input.sr}`);

  const { driverPort, cdpPort } = await findFreePortPair();

  // Spawn `serve`, not `start`. `start` in cli.ts is a launcher that itself
  // spawns a `serve` daemon and exits; capturing the launcher's PID would
  // leave our `stop()` signaling a process that's already gone while the real
  // daemon keeps running. We poll readiness ourselves via spawnDaemon below,
  // so we don't need the launcher's polling.
  const { stop } = await spawnDaemon({
    script,
    args: [
      "serve",
      input.url,
      "--port",
      String(driverPort),
      "--cdp-port",
      String(cdpPort),
    ],
    port: driverPort,
  });

  return { driverPort, cdpPort, stop };
}
