/**
 * Unified HTTP server for the screen reader driver daemon.
 *
 * Exposes the same JSON API regardless of which screen reader (VoiceOver
 * or Orca) is running. The server receives a ScreenReaderDriver instance
 * and delegates all operations to it.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { writeFileSync } from "fs";
import type { ScreenReaderDriver } from "./interface.ts";
import { runAxeAudit } from "../audit.ts";

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
      if (size > maxSize) { settled = true; req.destroy(); reject(new Error("Request body too large")); return; }
      b += c;
    });
    req.on("end", () => { if (!settled) { settled = true; resolve(b); } });
    req.on("error", (e) => { if (!settled) { settled = true; reject(e); } });
  });
}

function parseBody(body: string): Record<string, unknown> | null {
  try { return JSON.parse(body || "{}"); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

export function createHandler(driver: ScreenReaderDriver) {
  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const { method } = req;
    const url = new URL(req.url || "/", "http://localhost");
    const path = url.pathname;

    try {
      if (path === "/" && method === "GET") {
        const s = driver.getStatus();
        return json(res, 200, {
          status: "running",
          voiceoverActive: s.screenReaderActive,  // keep field name for API compat
          currentUrl: s.currentUrl,
          cdpPort: s.cdpPort,
        });
      }

      if (path === "/next" && method === "POST")
        return json(res, 200, await driver.next());

      if (path === "/previous" && method === "POST")
        return json(res, 200, await driver.previous());

      if (path === "/act" && method === "POST")
        return json(res, 200, await driver.act());

      if (path === "/perform" && method === "POST") {
        const body = parseBody(await readBody(req, driver.maxRequestBody));
        if (!body?.command || typeof body.command !== "string")
          return json(res, 400, { error: "Missing 'command' in request body" });
        return json(res, 200, await driver.perform(body.command));
      }

      if (path === "/press" && method === "POST") {
        const body = parseBody(await readBody(req, driver.maxRequestBody));
        if (!body?.key || typeof body.key !== "string")
          return json(res, 400, { error: "Missing 'key' in request body" });
        const mods = Array.isArray(body.modifiers) ? body.modifiers as string[]
          : typeof body.modifiers === "string" ? [body.modifiers] : [];
        return json(res, 200, await driver.press(body.key, mods));
      }

      if (path === "/enter" && method === "POST")
        return json(res, 200, await driver.enter());

      if (path === "/navigate" && method === "POST") {
        const body = parseBody(await readBody(req, driver.maxRequestBody));
        if (!body?.url || typeof body.url !== "string")
          return json(res, 400, { error: "Missing 'url' in request body" });
        return json(res, 200, await driver.navigate(body.url));
      }

      if (path === "/item-text" && method === "GET")
        return json(res, 200, await driver.getItemText());

      if (path === "/transcript" && method === "GET") {
        const since = url.searchParams.get("since");
        const entries = since !== null ? driver.getTranscript(parseInt(since, 10)) : driver.getTranscript();
        return json(res, 200, { entries, length: driver.getTranscriptLength() });
      }

      if (path === "/transcript" && method === "DELETE") {
        const cleared = driver.clearTranscript();
        return json(res, 200, { cleared: cleared.length });
      }

      if (path === "/audit" && method === "POST") {
        const page = driver.getPage();
        if (!page) return json(res, 400, { error: "No browser page open" });
        const body = parseBody(await readBody(req, driver.maxRequestBody));
        const result = await runAxeAudit(page, body || {});
        return json(res, 200, result);
      }

      if (path === "/commands" && method === "GET") {
        let commands = driver.getCommandNames();
        const filter = url.searchParams.get("filter");
        if (filter) {
          const lower = filter.toLowerCase();
          commands = commands.filter(c => c.toLowerCase().includes(lower));
        }
        return json(res, 200, { commands });
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
  try { writeFileSync(driver.logFile, ""); } catch {}

  await driver.initialize(url, cdpPort);

  const server = createServer(createHandler(driver));
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
      try { writeFileSync(driver.pidFile, process.pid.toString()); } catch {}
      resolve();
    });
  });

  if (url) {
    try { await driver.enter(); } catch (e) {
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
