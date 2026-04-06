#!/usr/bin/env bun
/**
 * VoiceOver driver entry point.
 *
 * Parses flags and dispatches to either the daemon (serve) or the CLI client.
 */

import { DEFAULT_PORT, DEFAULT_CDP_PORT } from "./vo-core.ts";
import { startServer } from "./vo-server.ts";
import { cli, USAGE } from "./vo-cli.ts";

// ---------------------------------------------------------------------------
// Flag parsing — pure function, no side effects beyond printing + exiting
// ---------------------------------------------------------------------------

export function getFlag(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || !args[i + 1]) return fallback;
  const val = parseInt(args[i + 1], 10);
  if (Number.isNaN(val)) {
    console.error(`Invalid --${name} value: ${args[i + 1]} (expected integer)`);
    process.exit(1);
  }
  return val;
}

// ---------------------------------------------------------------------------
// Main — only runs when executed directly, not when imported by tests
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);
  const port = getFlag(args, "port", DEFAULT_PORT);
  const cdpPort = getFlag(args, "cdp-port", DEFAULT_CDP_PORT);

  if (args[0] === "serve") {
    const positional = args.slice(1).filter((a, i, arr) =>
      !a.startsWith("--") && !(i > 0 && arr[i - 1]?.startsWith("--"))
    );
    startServer(port, cdpPort, positional[0] || null).catch((e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    });
  } else if (args.length === 0) {
    console.log(USAGE);
  } else {
    cli(args, port, cdpPort).catch((e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    });
  }
}
