/**
 * HTTP daemon for the screen reader driver.
 *
 * Exposes the JSON API any orchestration layer (work-skill, v1, future v2)
 * can consume. The driver instance is injected so the same surface could
 * back a future `agent-voiceover` sibling on macOS.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "http";
import type { Socket } from "net";
import { WebSocketServer, WebSocket } from "ws";
import type { ScreenReaderDriver } from "./interface.js";
import { safeWriteSync } from "./lib/runtime-paths.js";
import { runAxeAudit } from "./audit.js";
import {
  checkLoadingState,
  startObserver,
  waitForSelector,
  type ObserverHandle,
} from "./wait.js";
import { viewerHtml } from "./live/viewer.js";
import {
  addStreamClient,
  configureStreamLogger,
  getCaptureSize,
  streamStatus,
  stopStream,
} from "./live/stream.js";
import { liveEvents, type LiveEvent } from "./live/events.js";

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

// GitHub Codespaces port-forwarding rewrites neither Host nor Origin — the
// browser sees a hostname like `<port>-<codespace>.app.github.dev` and uses
// it for both. The daemon is still bound to 127.0.0.1, so external traffic
// can only arrive via GitHub's authenticated proxy; admitting the forwarded
// hostname here matches the plan's design intent ("loopback + Codespaces
// auto-forwarding works without a token", §6) without widening the attack
// surface — a page on evil.com still can't satisfy this hostname pattern,
// and Codespaces auth gates who can reach the proxy in the first place.
// Recognized patterns (Codespaces historical + current):
//   - <name>.app.github.dev
//   - <name>.preview.app.github.dev
//   - <name>.githubpreview.dev
const CODESPACES_HOST_RE =
  /^[a-z0-9-]+(?:\.preview)?\.app\.github\.dev(?::\d+)?$/i;
const CODESPACES_PREVIEW_RE = /^[a-z0-9-]+\.githubpreview\.dev(?::\d+)?$/i;

function isCodespacesForwardedHost(host: string): boolean {
  return CODESPACES_HOST_RE.test(host) || CODESPACES_PREVIEW_RE.test(host);
}

// One policy, one decision. Earlier rounds split this into `isHostAllowed` +
// `isOriginAllowed` and AND-ed them at every call site, which is what let a
// cross-Codespace WS hijack through (the two checks were correct in isolation
// but admitted attacker pairs together). Routing everything through one
// function — and returning a tagged reason instead of a bare boolean — keeps
// the policy expressible in one place and makes the per-case behavior
// testable from a single table.
//
// Rule (Host drives, Origin must match):
//   - Host is 127.0.0.1:<port> or localhost:<port>
//        Origin must be the same loopback URL (or absent — non-browser caller).
//   - Host is a Codespaces forwarded URL (`<name>.app.github.dev`, etc.)
//        Origin's host must EQUAL that same forwarded URL (or be absent).
//   - Anything else → reject.
export type RequestDecision =
  | { ok: true }
  | { ok: false; status: 403; reason: "bad host" | "bad origin" };

export function decideRequest(
  host: string | undefined,
  origin: string | undefined,
  port: number,
): RequestDecision {
  if (!host) return { ok: false, status: 403, reason: "bad host" };
  const hostLower = host.toLowerCase();

  const isLoopback =
    hostLower === `127.0.0.1:${port}` || hostLower === `localhost:${port}`;
  const isCodespaces = isCodespacesForwardedHost(hostLower);
  if (!isLoopback && !isCodespaces) return { ok: false, status: 403, reason: "bad host" };

  if (origin === undefined) return { ok: true }; // non-browser caller (curl, agent CLI)
  const originLower = origin.toLowerCase();

  if (isLoopback) {
    if (
      originLower === `http://127.0.0.1:${port}` ||
      originLower === `http://localhost:${port}`
    ) {
      return { ok: true };
    }
    return { ok: false, status: 403, reason: "bad origin" };
  }

  // isCodespaces — origin must point at the SAME forwarded host.
  try {
    const u = new URL(originLower);
    if (
      (u.protocol === "https:" || u.protocol === "http:") &&
      u.host === hostLower
    ) {
      return { ok: true };
    }
  } catch {
    /* fall through to reject */
  }
  return { ok: false, status: 403, reason: "bad origin" };
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

    // DNS-rebinding + cross-origin gate, applied before any route runs.
    const decision = decideRequest(req.headers.host, req.headers.origin, port);
    if (!decision.ok) {
      json(res, decision.status, { error: decision.reason });
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
        // `cursor` is what the client should pass as `since=` next time —
        // NOT `length`. They differ after DELETE /transcript or after the
        // buffer rolls past MAX_TRANSCRIPT_ENTRIES, and clients that used
        // `since=length` (or `since=length+1`) silently skipped entries.
        json(res, 200, {
          entries,
          length: driver.getTranscriptLength(),
          cursor: driver.getTranscriptCursor(),
        });
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

      if (path === "/live" && method === "GET") {
        // Query the active display's geometry so the viewer's focus-overlay
        // scaling matches whatever size ffmpeg is actually capturing.
        const display = process.env.DISPLAY || ":99";
        const { width, height } = getCaptureSize(display);
        const html = viewerHtml(width, height);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          // Anti-framing: a hostile page that iframes /live runs JS at the
          // daemon origin and could open /stream + /events from inside the
          // frame, then clickjack the user into forwarding keystrokes to
          // /press. The navigation request for an iframe load often has no
          // Origin header so the request gate alone won't stop it; the
          // browser-enforced framing headers do.
          "X-Frame-Options": "DENY",
          "Content-Security-Policy": "frame-ancestors 'none'",
        });
        res.end(html);
        return;
      }

      if (path === "/live-status" && method === "GET") {
        json(res, 200, streamStatus());
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
          stopStream();
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
// Live-view WebSockets (/stream binary fMP4, /events JSON)
// ---------------------------------------------------------------------------

function attachLiveView(server: Server, port: number, driver: ScreenReaderDriver) {
  configureStreamLogger((msg, err) => driver.log(msg, err));

  // noServer mode: we route upgrades ourselves so the host allow-list (the
  // same DNS-rebinding defense the HTTP routes use) applies before any
  // WebSocket handshake completes.
  const streamWss = new WebSocketServer({ noServer: true });
  const eventsWss = new WebSocketServer({ noServer: true });

  // Backpressure caps. A slow/stalled WS would otherwise grow the daemon's
  // own send queue without bound — ffmpeg keeps producing ~MB/s of video and
  // events keep firing. When a client falls this far behind, close them; the
  // viewer's auto-reconnect will pick back up if/when the bottleneck clears.
  const STREAM_MAX_BUFFERED = 5_000_000; // ~5 MB ≈ a few seconds of video
  const EVENTS_MAX_BUFFERED = 1_000_000; // ~1 MB ≈ thousands of pending events

  streamWss.on("connection", (ws: WebSocket) => {
    const display = process.env.DISPLAY || ":99";
    const send = (chunk: Buffer) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > STREAM_MAX_BUFFERED) {
        driver.log(`/stream viewer too slow (bufferedAmount=${ws.bufferedAmount}) — closing`, true);
        try { ws.close(); } catch { /* already torn down */ }
        return;
      }
      ws.send(chunk);
    };
    // If ffmpeg dies mid-session, the encoder uses this to boot the WS so the
    // viewer's client-side auto-reconnect kicks in against a fresh encoder.
    const forceClose = () => {
      try { ws.close(); } catch { /* already closed */ }
    };
    const dispose = addStreamClient(send, display, forceClose);
    ws.on("close", dispose);
    ws.on("error", dispose);
  });

  eventsWss.on("connection", (ws: WebSocket) => {
    const unsubscribe = liveEvents.subscribe((e: LiveEvent) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > EVENTS_MAX_BUFFERED) {
        driver.log(`/events viewer too slow (bufferedAmount=${ws.bufferedAmount}) — closing`, true);
        try { ws.close(); } catch { /* already torn down */ }
        return;
      }
      ws.send(JSON.stringify(e));
    });
    ws.on("close", unsubscribe);
    ws.on("error", unsubscribe);
  });

  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    // SAME policy the HTTP routes use — one decision for the whole request.
    // Without the Origin half, any page the user visits could open
    // ws://127.0.0.1:<port>/events or /stream and read the live transcript
    // + framebuffer (the Host header is satisfiable cross-origin; Origin
    // is what gives the attacker away).
    if (!decideRequest(req.headers.host, req.headers.origin, port).ok) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    const { pathname } = new URL(req.url || "/", "http://localhost");
    if (pathname === "/stream") {
      streamWss.handleUpgrade(req, socket, head, (ws) => streamWss.emit("connection", ws, req));
    } else if (pathname === "/events") {
      eventsWss.handleUpgrade(req, socket, head, (ws) => eventsWss.emit("connection", ws, req));
    } else {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
    }
  });
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

  // Server is created here but not yet listening — that happens after
  // initialize() succeeds. We install the SIGINT/SIGTERM handler BEFORE
  // initialize() so a Ctrl-C or process-manager timeout during the
  // multi-second bootstrap (Xvfb, openbox, dbus, at-spi2, Chromium, Orca)
  // still runs cleanup() instead of taking Node's default signal exit and
  // leaving the helper processes behind.
  const server = createServer(createHandler(driver, port));
  attachLiveView(server, port, driver);
  let listening = false;

  const shutdown = async () => {
    if (listening) server.close();
    stopStream();
    const timer = setTimeout(() => process.exit(1), 5000);
    try {
      await driver.cleanup();
    } catch (e) {
      driver.log(`shutdown cleanup: ${e instanceof Error ? e.message : e}`, true);
    }
    clearTimeout(timer);
    driver.removePidFile();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await driver.initialize(url, cdpPort);

  await new Promise<void>((resolve, reject) => {
    server.on("error", async (e) => {
      driver.log(`Server listen failed: ${e.message}`, true);
      await driver.cleanup();
      driver.removePidFile();
      reject(e);
    });
    server.listen(port, "127.0.0.1", () => {
      listening = true;
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
}
