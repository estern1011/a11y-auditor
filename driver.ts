#!/usr/bin/env bun
/**
 * Unified screen reader driver entry point.
 *
 * Auto-detects the platform (macOS → VoiceOver, Linux → Orca) and
 * dispatches to either the daemon server or the CLI client.
 *
 * Usage:
 *   bun driver.ts start <url>          # launch browser + screen reader
 *   bun driver.ts next                 # navigate forward
 *   bun driver.ts perform FIND_NEXT_HEADING
 *   bun driver.ts stop
 *
 * Override platform detection:
 *   SCREEN_READER_FORCE=orca bun driver.ts start <url>
 */

import { createDriver } from "./platform/detect.ts";
import { startServer } from "./server.ts";
import { cli, USAGE_UNIFIED } from "./cli.ts";

function getFlag(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || !args[i + 1]) return fallback;
  const val = parseInt(args[i + 1], 10);
  if (Number.isNaN(val)) {
    console.error(`Invalid --${name} value: ${args[i + 1]}`);
    process.exit(1);
  }
  return val;
}

if (import.meta.main) {
  const driver = await createDriver();
  const args = process.argv.slice(2);
  const port = getFlag(args, "port", driver.defaultPort);
  const cdpPort = getFlag(args, "cdp-port", driver.defaultCdpPort);

  if (args[0] === "serve") {
    const positional = args.slice(1).filter((a, i, arr) =>
      !a.startsWith("--") && !(i > 0 && arr[i - 1]?.startsWith("--"))
    );
    await startServer(driver, port, cdpPort, positional[0] || null);
  } else if (args.length === 0) {
    console.log(USAGE_UNIFIED);
  } else {
    await cli(args, driver, USAGE_UNIFIED);
  }
}
