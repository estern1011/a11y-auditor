import { describe, test, expect } from "bun:test";
import { createServer } from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findFreePort, findFreePortPair, spawnDaemon, waitForHttpOk } from "./driver.ts";
import { getFlag as getFlagOrca } from "../../drivers/orca/driver.ts";
import { getFlag as getFlagVO } from "../../drivers/voiceover/driver.ts";
import { DEFAULT_PORT as ORCA_DEFAULT, DEFAULT_CDP_PORT as ORCA_CDP_DEFAULT } from "../../drivers/orca/core.ts";
import { DEFAULT_PORT as VO_DEFAULT, DEFAULT_CDP_PORT as VO_CDP_DEFAULT } from "../../drivers/voiceover/core.ts";

async function writeFakeDaemon(behavior: "ok" | "never-ready"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fake-daemon-"));
  const script = join(dir, "daemon.ts");
  // Minimal Bun.serve that takes --port N. In "ok" mode it responds 200 right
  // away; in "never-ready" it parks on 503 so the poller times out.
  const body =
    behavior === "ok"
      ? `Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("ok") });\n`
      : `Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("nope", { status: 503 }) });\n`;
  await writeFile(
    script,
    `const i = Bun.argv.indexOf("--port"); const port = i >= 0 ? Number(Bun.argv[i + 1]) : 0;\n${body}`,
    "utf8",
  );
  return script;
}

// ---------------------------------------------------------------------------
// Free port picker
// ---------------------------------------------------------------------------

describe("findFreePort", () => {
  test("returns a bindable port", async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);

    // Prove it's bindable right after the picker releases it.
    await new Promise<void>((resolve, reject) => {
      const s = createServer();
      s.once("error", reject);
      s.listen(port, "127.0.0.1", () => s.close(() => resolve()));
    });
  });
});

describe("findFreePortPair", () => {
  test("returns two distinct bindable ports", async () => {
    const { driverPort, cdpPort } = await findFreePortPair();
    expect(driverPort).toBeGreaterThan(0);
    expect(cdpPort).toBeGreaterThan(0);
    expect(driverPort).not.toBe(cdpPort);

    for (const p of [driverPort, cdpPort]) {
      await new Promise<void>((resolve, reject) => {
        const s = createServer();
        s.once("error", reject);
        s.listen(p, "127.0.0.1", () => s.close(() => resolve()));
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Driver CLI flag parser — confirms --port / --cdp-port override defaults, and
// that absent flags fall back to the core defaults exported from
// drivers/{orca,voiceover}/core.ts.
// ---------------------------------------------------------------------------

describe("driver CLI flag parser (orca)", () => {
  test("honors explicit --port and --cdp-port overrides", () => {
    const args = ["start", "https://example.com", "--port", "9999", "--cdp-port", "9998"];
    expect(getFlagOrca(args, "port", ORCA_DEFAULT)).toBe(9999);
    expect(getFlagOrca(args, "cdp-port", ORCA_CDP_DEFAULT)).toBe(9998);
  });

  test("falls back to core defaults when flags absent", () => {
    const args = ["start", "https://example.com"];
    expect(getFlagOrca(args, "port", ORCA_DEFAULT)).toBe(ORCA_DEFAULT);
    expect(getFlagOrca(args, "cdp-port", ORCA_CDP_DEFAULT)).toBe(ORCA_CDP_DEFAULT);
  });
});

describe("driver CLI flag parser (voiceover)", () => {
  test("honors explicit --port and --cdp-port overrides", () => {
    const args = ["start", "https://example.com", "--port", "9999", "--cdp-port", "9998"];
    expect(getFlagVO(args, "port", VO_DEFAULT)).toBe(9999);
    expect(getFlagVO(args, "cdp-port", VO_CDP_DEFAULT)).toBe(9998);
  });

  test("falls back to core defaults when flags absent", () => {
    const args = ["start", "https://example.com"];
    expect(getFlagVO(args, "port", VO_DEFAULT)).toBe(VO_DEFAULT);
    expect(getFlagVO(args, "cdp-port", VO_CDP_DEFAULT)).toBe(VO_CDP_DEFAULT);
  });
});

// ---------------------------------------------------------------------------
// waitForHttpOk
// ---------------------------------------------------------------------------

describe("waitForHttpOk", () => {
  test("succeeds after N 503 responses followed by 200", async () => {
    const port = await findFreePort();
    let hits = 0;
    const server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      fetch() {
        hits += 1;
        if (hits < 4) return new Response("not ready", { status: 503 });
        return new Response("ok", { status: 200 });
      },
    });

    try {
      await waitForHttpOk(port, "/status", { intervalMs: 50, timeoutMs: 5_000 });
      expect(hits).toBeGreaterThanOrEqual(4);
    } finally {
      await server.stop(true);
    }
  });

  test("throws on timeout when server never returns 200", async () => {
    const port = await findFreePort();
    const server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      fetch() {
        return new Response("nope", { status: 503 });
      },
    });

    let caught: Error | undefined;
    try {
      await waitForHttpOk(port, "/status", { intervalMs: 25, timeoutMs: 200 });
    } catch (e) {
      caught = e as Error;
    } finally {
      await server.stop(true);
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toMatch(/timed out/);
  });
});

// ---------------------------------------------------------------------------
// Child reap — startDriver's stop() should kill a spawned child well within 1s.
// We can't exercise startDriver end-to-end without a real screen reader, so we
// mirror its stop() pattern against `sleep 60` — same Bun.spawn + SIGTERM path.
// ---------------------------------------------------------------------------

describe("driver stop()", () => {
  test("reaps a long-running child within 1s", async () => {
    const child = Bun.spawn(["sleep", "60"], { stdout: "ignore", stderr: "ignore" });
    const started = Date.now();

    child.kill("SIGTERM");
    const exited = await Promise.race([
      child.exited.then(() => true),
      Bun.sleep(1_000).then(() => false),
    ]);
    expect(exited).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

// ---------------------------------------------------------------------------
// spawnDaemon — the shared spawn+poll+stop helper used by startDriver.
// Exercised against a fake Bun.serve script so the failure paths
// (startup timeout, stop-on-failure) are covered without a real driver.
// ---------------------------------------------------------------------------

describe("waitForHttpOk validator", () => {
  test("keeps polling past a 2xx response the validator rejects", async () => {
    // Simulates losing the free-port race: some other service is holding the
    // port and returns 200, but its body isn't our daemon. Validator must
    // reject it so the poller keeps trying (and ultimately times out rather
    // than falsely reporting ready).
    const port = await findFreePort();
    const squatter = Bun.serve({
      port,
      hostname: "127.0.0.1",
      fetch: () => Response.json({ status: "something-else", cdpPort: 1 }),
    });

    let caught: Error | undefined;
    try {
      await waitForHttpOk(port, "/", {
        intervalMs: 25,
        timeoutMs: 200,
        validate: async (res) => {
          const body = (await res.json()) as { status?: unknown };
          return body.status === "running";
        },
      });
    } catch (e) {
      caught = e as Error;
    } finally {
      await squatter.stop(true);
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toMatch(/validator rejected|timed out/);
  });

  test("returns once the validator accepts", async () => {
    const port = await findFreePort();
    let hits = 0;
    const server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      fetch: () => {
        hits += 1;
        return hits < 3
          ? Response.json({ status: "pending" })
          : Response.json({ status: "running", cdpPort: 42 });
      },
    });
    try {
      await waitForHttpOk(port, "/", {
        intervalMs: 25,
        timeoutMs: 2_000,
        validate: async (res) => {
          const body = (await res.json()) as { status?: unknown; cdpPort?: unknown };
          return body.status === "running" && body.cdpPort === 42;
        },
      });
      expect(hits).toBeGreaterThanOrEqual(3);
    } finally {
      await server.stop(true);
    }
  });
});

describe("spawnDaemon", () => {
  test("spawns and polls a working daemon, then stop() reaps it", async () => {
    const script = await writeFakeDaemon("ok");
    const port = await findFreePort();
    const { stop } = await spawnDaemon({
      script,
      args: ["--port", String(port)],
      port,
      intervalMs: 50,
      timeoutMs: 10_000,
    });

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);

    await stop();

    // Port should be free again once the daemon is reaped.
    await new Promise<void>((resolve, reject) => {
      const s = createServer();
      s.once("error", reject);
      s.listen(port, "127.0.0.1", () => s.close(() => resolve()));
    });
  });

  test("throws on startup timeout and reaps the child so no zombie listens on the port", async () => {
    const script = await writeFakeDaemon("never-ready");
    const port = await findFreePort();

    let caught: Error | undefined;
    try {
      await spawnDaemon({
        script,
        args: ["--port", String(port)],
        port,
        intervalMs: 25,
        timeoutMs: 400,
      });
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toMatch(/daemon failed to become ready/);

    // Give SIGTERM a moment to land. If stop-on-failure leaked the child, the
    // port would still be held and this bind would EADDRINUSE.
    await Bun.sleep(100);
    await new Promise<void>((resolve, reject) => {
      const s = createServer();
      s.once("error", reject);
      s.listen(port, "127.0.0.1", () => s.close(() => resolve()));
    });
  });
});
