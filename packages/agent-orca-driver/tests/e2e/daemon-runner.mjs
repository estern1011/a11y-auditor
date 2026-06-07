#!/usr/bin/env node
/**
 * Runs the daemon's startServer with a FakeScreenReaderDriver, on a port
 * supplied via E2E_PORT. Designed to be spawned by tests/e2e/harness.mjs.
 *
 * Why subprocess-launched: startServer installs SIGINT/SIGTERM handlers that
 * call process.exit on shutdown, AND its live-view module holds singleton
 * state (ffmpeg process, init segment, sinks). Running each test's daemon in
 * its own process is the clean isolation.
 */

import { startServer } from "../../dist/src/server.js";
import { createFakeDriver } from "./fake-driver.mjs";

const port = parseInt(process.env.E2E_PORT || "0", 10);
const cdpPort = parseInt(process.env.E2E_CDP_PORT || "9999", 10);

if (!port) {
  process.stderr.write("E2E_PORT is required\n");
  process.exit(2);
}

const driver = createFakeDriver();
await startServer(driver, port, cdpPort, null);
// startServer prints "Server ready on http://127.0.0.1:<port>" to stdout
// which the harness greps for. SIGTERM-based shutdown is handled by
// startServer itself.
