/**
 * HTTP server for the VoiceOver driver daemon.
 *
 * Exposes all VoiceOver operations as JSON endpoints. The CLI client
 * and any other HTTP consumer (e.g. agent-browser) connect here.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { writeFileSync } from "fs";
import {
  getPage, getStatus, getTranscriptLength, errorMsg,
  log, voNext, voPrevious, voAct, voPerform, voPress, voEnter,
  navigate, initialize, cleanup, getTranscript, clearTranscript,
  getItemText, removePidFile, COMMANDS,
  LOG_FILE, PID_FILE, MAX_REQUEST_BODY,
} from "./vo-core.ts";
import { runAxeAudit } from "./audit.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res: ServerResponse, code: number, data: object) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let b = "";
    let size = 0;
    let settled = false;
    req.on("data", (c: Buffer) => {
      if (settled) return;
      size += c.length;
      if (size > MAX_REQUEST_BODY) { settled = true; req.destroy(); reject(new Error("Request body too large")); return; }
      b += c;
    });
    req.on("end", () => { if (!settled) { settled = true; resolve(b); } });
    req.on("error", (e) => { if (!settled) { settled = true; reject(e); } });
  });
}

function parseBody(body: string): Record<string, unknown> | null {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Request handler — exported for testing
// ---------------------------------------------------------------------------

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const { method } = req;
  const url = new URL(req.url || "/", "http://localhost");
  const path = url.pathname;

  try {
    if (path === "/" && method === "GET")
      return json(res, 200, { status: "running", ...getStatus() });

    if (path === "/next" && method === "POST")
      return json(res, 200, await voNext());

    if (path === "/previous" && method === "POST")
      return json(res, 200, await voPrevious());

    if (path === "/act" && method === "POST")
      return json(res, 200, await voAct());

    if (path === "/perform" && method === "POST") {
      const body = parseBody(await readBody(req));
      if (!body || typeof body.command !== "string") return json(res, 400, { error: "command required (string)" });
      return json(res, 200, await voPerform(body.command));
    }

    if (path === "/press" && method === "POST") {
      const body = parseBody(await readBody(req));
      if (!body || typeof body.key !== "string") return json(res, 400, { error: "key required (string)" });
      const mods = Array.isArray(body.modifiers)
        ? body.modifiers.filter((m): m is string => typeof m === "string")
        : typeof body.modifiers === "string" ? [body.modifiers] : [];
      return json(res, 200, await voPress(body.key, mods));
    }

    if (path === "/enter" && method === "POST")
      return json(res, 200, await voEnter());

    if (path === "/navigate" && method === "POST") {
      const body = parseBody(await readBody(req));
      if (!body || typeof body.url !== "string") return json(res, 400, { error: "url required (string)" });
      return json(res, 200, await navigate(body.url));
    }

    if (path === "/item-text" && method === "GET") {
      return json(res, 200, await getItemText());
    }

    if (path === "/transcript" && method === "GET") {
      const sinceParam = url.searchParams.get("since");
      if (sinceParam !== null) {
        const since = parseInt(sinceParam, 10);
        if (Number.isNaN(since)) return json(res, 400, { error: "since must be an integer" });
        return json(res, 200, { entries: getTranscript(since), length: getTranscriptLength() });
      }
      return json(res, 200, { entries: getTranscript(), length: getTranscriptLength() });
    }

    if (path === "/transcript" && method === "DELETE") {
      const entries = clearTranscript();
      return json(res, 200, { cleared: entries.length });
    }

    if (path === "/audit" && method === "POST") {
      const page = getPage();
      if (!page) return json(res, 400, { error: "No page open. Run: start <url>" });
      const body = parseBody(await readBody(req));
      const options: Parameters<typeof runAxeAudit>[1] = {};
      if (body) {
        if (typeof body.selector === "string") options.selector = body.selector;
        if (Array.isArray(body.tags)) options.tags = body.tags.filter((t): t is string => typeof t === "string");
        if (Array.isArray(body.rules)) options.rules = body.rules.filter((r): r is string => typeof r === "string");
        if (Array.isArray(body.disableRules)) options.disableRules = body.disableRules.filter((r): r is string => typeof r === "string");
        if (typeof body.includeTree === "boolean") options.includeTree = body.includeTree;
      }
      const result = await runAxeAudit(page, options);
      return json(res, 200, result);
    }

    if (path === "/commands" && method === "GET") {
      const filter = url.searchParams.get("filter") || "";
      let cmds = Object.keys(COMMANDS);
      if (filter) cmds = cmds.filter((c) => c.toLowerCase().includes(filter.toLowerCase()));
      return json(res, 200, { commands: cmds });
    }

    if (path === "/stop" && method === "POST") {
      json(res, 200, { success: true });
      setImmediate(async () => {
        await cleanup();
        removePidFile();
        process.exit(0);
      });
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    const msg = errorMsg(e);
    log(`HTTP error: ${msg}`, true);
    json(res, 500, { error: msg });
  }
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

export async function startServer(port: number, cdpPort: number, url: string | null) {
  // Truncate log file on daemon startup
  try { writeFileSync(LOG_FILE, ""); } catch {}

  await initialize(url, cdpPort);

  const server = createServer(handle);
  await new Promise<void>((resolve, reject) => {
    server.on("error", async (e) => {
      log(`Server listen failed: ${e.message}`, true);
      await cleanup();
      removePidFile();
      reject(e);
    });
    server.listen(port, "127.0.0.1", () => {
      log(`Server on http://127.0.0.1:${port}, CDP on port ${cdpPort}`);
      console.log(`Server ready on http://127.0.0.1:${port}`);
      console.log(`CDP available on ws://127.0.0.1:${cdpPort}`);
      try { writeFileSync(PID_FILE, process.pid.toString()); } catch {}
      resolve();
    });
  });

  // Enter web content after server is listening (so CLI can connect even if enter is slow)
  if (url) {
    try { await voEnter(); } catch (e) { log(`auto-enter: ${errorMsg(e)}`, true); }
  }

  const shutdown = async () => {
    server.close();
    const timer = setTimeout(() => process.exit(1), 5000);
    await cleanup();
    clearTimeout(timer);
    removePidFile();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
