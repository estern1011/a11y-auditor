/**
 * HTTP server for the VoiceOver driver daemon.
 *
 * Exposes all VoiceOver operations as JSON endpoints. The CLI client
 * and any other HTTP consumer (e.g. agent-browser) connect here.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { writeFileSync } from "fs";
import {
  state, log, voNext, voPrevious, voAct, voPerform, voPress, voEnter,
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
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_REQUEST_BODY) { reject(new Error("Request body too large")); return; }
      b += c;
    });
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
}

function parseBody(body: string): Record<string, string | string[]> | null {
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
      return json(res, 200, {
        status: "running",
        voiceoverActive: state.voiceoverActive,
        currentUrl: state.currentUrl,
        cdpPort: state.cdpPort,
      });

    if (path === "/next" && method === "POST")
      return json(res, 200, await voNext());

    if (path === "/previous" && method === "POST")
      return json(res, 200, await voPrevious());

    if (path === "/act" && method === "POST")
      return json(res, 200, await voAct());

    if (path === "/perform" && method === "POST") {
      const body = parseBody(await readBody(req));
      if (!body || !body.command) return json(res, 400, { error: "command required" });
      return json(res, 200, await voPerform(body.command as string));
    }

    if (path === "/press" && method === "POST") {
      const body = parseBody(await readBody(req));
      if (!body || !body.key) return json(res, 400, { error: "key required" });
      const mods = Array.isArray(body.modifiers) ? body.modifiers as string[]
        : body.modifiers ? [body.modifiers as string] : [];
      return json(res, 200, await voPress(body.key as string, mods));
    }

    if (path === "/enter" && method === "POST")
      return json(res, 200, await voEnter());

    if (path === "/navigate" && method === "POST") {
      const body = parseBody(await readBody(req));
      if (!body || !body.url) return json(res, 400, { error: "url required" });
      return json(res, 200, await navigate(body.url as string));
    }

    if (path === "/item-text" && method === "GET") {
      return json(res, 200, await getItemText());
    }

    if (path === "/transcript" && method === "GET") {
      const since = url.searchParams.get("since");
      const entries = since !== null ? getTranscript(parseInt(since, 10)) : getTranscript();
      return json(res, 200, { entries, length: state.transcript.length });
    }

    if (path === "/transcript" && method === "DELETE") {
      const entries = clearTranscript();
      return json(res, 200, { cleared: entries.length });
    }

    if (path === "/audit" && method === "POST") {
      if (!state.page) return json(res, 400, { error: "No page open. Run: start <url>" });
      const body = parseBody(await readBody(req));
      const options = body || {};
      const result = await runAxeAudit(state.page, options as Parameters<typeof runAxeAudit>[1]);
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
    const msg = e instanceof Error ? e.message : String(e);
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
  await new Promise<void>((resolve) => {
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
    try { await voEnter(); } catch (e) { log(`auto-enter: ${e instanceof Error ? e.message : String(e)}`, true); }
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
