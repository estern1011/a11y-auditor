#!/usr/bin/env node
/**
 * Real-Orca version of daemon-runner. Uses the actual createOrcaDriver()
 * (D-Bus + AT-SPI2 + Orca + Chromium + Xvfb) instead of the fake.
 * Designed to be spawned by tests/e2e/orca-sprite.test.mjs.
 *
 * Requires apt: orca, xdotool, at-spi2-core, dbus-x11, libatk-adaptor,
 * espeak-ng, speech-dispatcher, speech-dispatcher-espeak-ng, pulseaudio,
 * openbox. Plus the Playwright Chromium browser. The test skips itself
 * if any of those are missing.
 */

import { startServer } from "../../dist/src/server.js";
import { createOrcaDriver } from "../../dist/src/orca/driver.js";

const port = parseInt(process.env.E2E_PORT || "0", 10);
const cdpPort = parseInt(process.env.E2E_CDP_PORT || "9999", 10);
const url = process.env.E2E_URL || null;

if (!port) {
  process.stderr.write("E2E_PORT is required\n");
  process.exit(2);
}

const driver = createOrcaDriver();
await startServer(driver, port, cdpPort, url);
