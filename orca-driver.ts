#!/usr/bin/env bun
/**
 * Orca driver — backward compatibility shim.
 * Delegates to the unified driver with Orca forced.
 */

import { createOrcaDriver } from "./platform/orca.ts";
import { startServer } from "./server.ts";
import { cli, USAGE_ORCA } from "./cli.ts";

function getFlag(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || !args[i + 1]) return fallback;
  const val = parseInt(args[i + 1], 10);
  if (Number.isNaN(val)) { console.error(`Invalid --${name} value`); process.exit(1); }
  return val;
}

export { getFlag };

if (import.meta.main) {
  const driver = await createOrcaDriver();
  const args = process.argv.slice(2);
  const port = getFlag(args, "port", driver.defaultPort);
  const cdpPort = getFlag(args, "cdp-port", driver.defaultCdpPort);

  if (args[0] === "serve") {
    const positional = args.slice(1).filter((a, i, arr) =>
      !a.startsWith("--") && !(i > 0 && arr[i - 1]?.startsWith("--"))
    );
    await startServer(driver, port, cdpPort, positional[0] || null);
  } else if (args.length === 0) {
    console.log(USAGE_ORCA);
  } else {
    await cli(args, driver, USAGE_ORCA);
  }
}
