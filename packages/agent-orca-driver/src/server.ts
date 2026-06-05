/**
 * HTTP daemon for the screen reader driver.
 *
 * Exposes the JSON API any orchestration layer (work-skill, v1, future v2)
 * can consume. The driver instance is injected so the same surface could
 * back a future `agent-voiceover` sibling on macOS.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { ScreenReaderDriver } from "./interface.js";
import { safeWriteSync } from "./lib/runtime-paths.js";
import { runAxeAudit } from "./audit.js";
import {
  checkLoadingState,
  startObserver,
  waitForSelector,
  type ObserverHandle,
} from "./wait.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res: ServerResponse, code: number, data: object) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let b = "";
    let size = 0;
    let settled = false;
    req.on("data", (c: Buffer) => {
      if (settled) return;
      size += c.length;
      if (size > maxSize) {
        settled = true;
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      b += c;
    });
    req.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(b);
      }
    });
    req.on("error", (e) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    });
  });
}

function parseBody(body: string): Record<string, unknown> | null {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return null;
  }
}

// Schemes the driver is willing to load. file:// and chrome:// are excluded
// so a compromised endpoint can't be used as a local-file-read primitive.
const ALLOWED_URL_SCHEMES = new Set(["http:", "https:", "data:"]);

export function isAllowedNavigationUrl(value: string): boolean {
  try {
    return ALLOWED_URL_SCHEMES.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

// Reject the literal string "null" (sent by sandboxed iframes / data: /
// file: documents) and any origin that isn't this exact daemon port.
function isOriginAllowed(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  const lower = origin.toLowerCase();
  return lower === `http://127.0.0.1:${port}` || lower === `http://localhost:${port}`;
}

function isHostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const lower = host.toLowerCase();
  return lower === `127.0.0.1:${port}` || lower === `localhost:${port}`;
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

export function createHandler(driver: ScreenReaderDriver, port: number) {
  let observer: ObserverHandle | null = null;

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const { method } = req;
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname;

    // Reject DNS-rebinding and cross-origin browser callers before any
    // route runs.
    if (!isHostAllowed(req.headers.host, port)) {
      json(res, 403, { error: "bad host" });
      return;
    }
    if (!isOriginAllowed(req.headers.origin, port)) {
      json(res, 403, { error: "bad origin" });
      return;
    }

    try {
      if (path === "/" && method === "GET") {
        const s = driver.getStatus();
        json(res, 200, {
          status: "running",
          voiceoverActive: s.screenReaderActive, // keep field name for API compat
          currentUrl: s.currentUrl,
          cdpPort: s.cdpPort,
        });
        return;
      }

      if (path === "/next" && method === "POST") {
        json(res, 200, await driver.next());
        return;
      }

      if (path === "/previous" && method === "POST") {
        json(res, 200, await driver.previous());
        return;
      }

      if (path === "/act" && method === "POST") {
        json(res, 200, await driver.act());
        return;
      }

      if (path === "/perform" && method === "POST") {
        const body = parseBody(await readBody(req, driver.maxRequestBody));
        if (!body?.command || typeof body.command !== "string") {
          json(res, 400, { error: "Missing 'command' in request body" });
          return;
        }
        json(res, 200, await driver.perform(body.command));
        return;
      }

      if (path === "/press" && method === "POST") {
        const body = parseBody(await readBody(req, driver.maxRequestBody));
        if (!body?.key || typeof body.key !== "string") {
          json(res, 400, { error: "Missing 'key' in request body" });
          return;
        }
        const mods = Array.isArray(body.modifiers)
          ? (body.modifiers as string[])
          : typeof body.modifiers === "string"
            ? [body.modifiers]
            : [];
        json(res, 200, await driver.press(body.key, mods));
        return;
      }

      if (path === "/enter" && method === "POST") {
        json(res, 200, await driver.enter());
        return;
      }

      if (path === "/navigate" && method === "POST") {
        const body = parseBody(await readBody(req, driver.maxRequestBody));
        if (!body?.url || typeof body.url !== "string") {
          json(res, 400, { error: "Missing 'url' in request body" });
          return;
        }
        if (!isAllowedNavigationUrl(body.url)) {
          json(res, 400, { error: "URL scheme not allowed (http/https/data only)" });
          return;
        }
        json(res, 200, await driver.navigate(body.url));
        return;
      }

      if (path === "/item-text" && method === "GET") {
        json(res, 200, await driver.getItemText());
        return;
      }

      if (path === "/transcript" && method === "GET") {
        const since = url.searchParams.get("since");
        const entries =
          since !== null ? driver.getTranscript(parseInt(since, 10)) : driver.getTranscript();
        json(res, 200, { entries, length: driver.getTranscriptLength() });
        return;
      }

      if (path === "/transcript" && method === "DELETE") {
        const cleared = driver.clearTranscript();
        json(res, 200, { cleared: cleared.length });
        return;
      }

      if (path === "/audit" && method === "POST") {
        const page = driver.getPage();
        if (!page) {
          json(res, 400, { error: "No browser page open" });
          return;
        }
        const body = parseBody(await readBody(req, driver.maxRequestBody));
        const result = await runAxeAudit(page, body || {});
        json(res, 200, result);
        return;
      }

      if (path === "/loading-state" && method === "GET") {
        const page = driver.getPage();
        if (!page) {
          json(res, 400, { error: "No browser page open" });
          return;
        }
        const result = await checkLoadingState(page);
        json(res, 200, result);
        return;
      }

      if (path === "/observe" && method === "POST") {
        const page = driver.getPage();
        if (!page) {
          json(res, 400, { error: "No browser page open" });
          return;
        }
        if (observer) {
          await observer.stop();
        }
        const body = parseBody(await readBody(req, driver.maxRequestBody));
        const settleMs = typeof body?.settleMs === "number" ? body.settleMs : undefined;
        observer = await startObserver(page, { settleMs });
        json(res, 200, { started: true, settleMs: settleMs ?? 2000 });
        return;
      }

      if (path === "/observe" && method === "GET") {
        if (!observer) {
          json(res, 400, { error: "No observer running. POST /observe to start." });
          return;
        }
        const status = await observer.status();
        json(res, 200, status);
        return;
      }

      if (path === "/observe" && method === "DELETE") {
        if (!observer) {
          json(res, 400, { error: "No observer running" });
          return;
        }
        const status = await observer.stop();
        observer = null;
        json(res, 200, status);
        return;
      }

      if (path === "/wait-for-selector" && method === "POST") {
        const page = driver.getPage();
        if (!page) {
          json(res, 400, { error: "No browser page open" });
          return;
        }
        const body = parseBody(await readBody(req, driver.maxRequestBody));
        if (!body?.selector || typeof body.selector !== "string") {
          json(res, 400, { error: "Missing 'selector' in request body" });
          return;
        }
        const result = await waitForSelector(page, {
          selector: body.selector,
          state: typeof body.state === "string" ? (body.state as any) : undefined,
          timeout: typeof body.timeout === "number" ? body.timeout : undefined,
        });
        json(res, result.success ? 200 : 408, result);
        return;
      }

      if (path === "/commands" && method === "GET") {
        let commands = driver.getCommandNames();
        const filter = url.searchParams.get("filter");
        if (filter) {
          const lower = filter.toLowerCase();
          commands = commands.filter((c) => c.toLowerCase().includes(lower));
        }
        json(res, 200, { commands });
        return;
      }

      if (path === "/stop" && method === "POST") {
        json(res, 200, { success: true });
        setTimeout(async () => {
          await driver.cleanup();
          driver.removePidFile();
          process.exit(0);
        }, 100);
        return;
      }

      json(res, 404, { error: `Unknown route: ${method} ${path}` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      driver.log(`Request error ${path}: ${msg}`, true);
      json(res, 500, { error: msg });
    }
  };
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

export async function startServer(
  driver: ScreenReaderDriver,
  port: number,
  cdpPort: number,
  url: string | null,
) {
  try {
    safeWriteSync(driver.logFile, "");
  } catch {}

  await driver.initialize(url, cdpPort);

  const server = createServer(createHandler(driver, port));
  await new Promise<void>((resolve, reject) => {
    server.on("error", async (e) => {
      driver.log(`Server listen failed: ${e.message}`, true);
      await driver.cleanup();
      driver.removePidFile();
      reject(e);
    });
    server.listen(port, "127.0.0.1", () => {
      driver.log(`Server on http://127.0.0.1:${port}, CDP on port ${cdpPort}`);
      console.log(`Server ready on http://127.0.0.1:${port}`);
      console.log(`CDP available on ws://127.0.0.1:${cdpPort}`);
      try {
        safeWriteSync(driver.pidFile, process.pid.toString());
      } catch {}
      resolve();
    });
  });

  if (url) {
    try {
      await driver.enter();
    } catch (e) {
      driver.log(`auto-enter: ${e instanceof Error ? e.message : e}`, true);
    }
  }

  const shutdown = async () => {
    server.close();
    const timer = setTimeout(() => process.exit(1), 5000);
    await driver.cleanup();
    clearTimeout(timer);
    driver.removePidFile();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
