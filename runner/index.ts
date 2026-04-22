import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildGraph } from "./graph.ts";
import {
  ensureRunDir,
  resolveRunDir,
  appendEvent,
  resetRunDir,
  writeMeta,
} from "./tools/run-dir.ts";
import { serialize, now, type RunnerEvent } from "./events.ts";
import { startDriver, type StartDriverResult } from "./tools/driver.ts";

const SCAFFOLD_BANNER =
  "WARNING: runner/ is still partial. Only the baseline agent node is wired end-to-end; " +
  "keyboard + visual + auth nodes return defaults, so a clean run here does NOT mean " +
  "the page is accessible.\n";

interface CliOptions {
  url: string;
  wcag: "A" | "AA" | "AAA";
  viewport: { w: number; h: number };
  sr: "voiceover" | "orca";
  runId: string;
  authEnv?: string;
}

function parseViewport(v: string): { w: number; h: number } {
  const m = /^(\d+)x(\d+)$/.exec(v);
  if (!m) throw new Error(`Invalid --viewport '${v}'. Expected WxH e.g. 1440x900.`);
  return { w: Number(m[1]), h: Number(m[2]) };
}

function parseCli(argv: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      wcag: { type: "string", default: "AA" },
      viewport: { type: "string", default: "1440x900" },
      sr: { type: "string", default: "orca" },
      "run-id": { type: "string" },
      "auth-env": { type: "string" },
    },
  });

  const url = positionals[0];
  if (!url) {
    throw new Error("Usage: bun runner/index.ts <url> [--wcag AA] [--viewport 1440x900] [--sr voiceover|orca] [--run-id <id>] [--auth-env <path>]");
  }

  const wcag = String(values.wcag) as CliOptions["wcag"];
  if (!["A", "AA", "AAA"].includes(wcag)) throw new Error(`Invalid --wcag '${wcag}'`);

  const sr = String(values.sr) as CliOptions["sr"];
  if (!["voiceover", "orca"].includes(sr)) throw new Error(`Invalid --sr '${sr}'`);

  return {
    url,
    wcag,
    viewport: parseViewport(String(values.viewport)),
    sr,
    runId: (values["run-id"] as string | undefined) ?? randomUUID(),
    authEnv: values["auth-env"] as string | undefined,
  };
}

async function main() {
  process.stderr.write(SCAFFOLD_BANNER);

  // CLI parse and run-dir resolution happen before we can emit to events.ndjson
  // (the run dir doesn't exist yet). Anything that fails before `run.start`
  // fails loudly on stderr with a nonzero exit and no partial run dir.
  const opts = parseCli(process.argv.slice(2));
  const runDir = resolveRunDir(opts.runId);
  await ensureRunDir(runDir);
  await resetRunDir(runDir);

  // Seed meta.json with the CLI inputs so the run dir is self-consistent from
  // run.start onward, even if the graph fails before bootNode can rewrite it
  // with real driver ports. driverPort/cdpPort stay 0 until boot succeeds.
  await writeMeta(runDir, {
    runId: opts.runId,
    url: opts.url,
    sr: opts.sr,
    wcag: opts.wcag,
    viewport: opts.viewport,
    driverPort: 0,
    cdpPort: 0,
    startedAt: new Date().toISOString(),
    authProvided: Boolean(opts.authEnv),
  });

  const emit = async (ev: RunnerEvent) => {
    await appendEvent(runDir, serialize(ev));
  };

  await emit({ k: "run.start", t: now(), runId: opts.runId, url: opts.url });

  // Two guarantees we need on every exit path:
  //   1. A terminal `done` event is emitted — so consumers never see a run
  //      dir that was opened but never marked complete.
  //   2. driverHandle.stop() runs — so the spawned daemon never leaks between
  //      runs, even if emit() itself throws (e.g., ENOSPC on the run dir).
  // The emit in the catch is guarded, and cleanup lives in finally; we use
  // process.exitCode rather than process.exit() so finally actually runs on
  // the failure path.
  let driverHandle: StartDriverResult | null = null;
  try {
    if (opts.authEnv) {
      // Presence check only; the auth node (pending) is responsible for reading
      // and unlinking the file per plan § Phase B auth handling.
      await access(opts.authEnv);
    }

    driverHandle = await startDriver({
      sr: opts.sr,
      url: opts.url,
      viewport: opts.viewport,
    });

    const graph = buildGraph();
    try {
      const mermaid = await graph.getGraph().drawMermaid();
      await writeFile(join(runDir, "graph.mmd"), mermaid, "utf8");
    } catch {
      // Older LangGraph versions may expose `drawMermaidPng` only; non-fatal here.
    }

    const finalState = await graph.invoke({
      runId: opts.runId,
      url: opts.url,
      sr: opts.sr,
      wcag: opts.wcag,
      viewport: opts.viewport,
      runDir,
      authEnvPath: opts.authEnv,
      driverPort: driverHandle.driverPort,
      cdpPort: driverHandle.cdpPort,
    });
    void finalState;
    await emit({ k: "done", t: now(), ok: true });
    process.stdout.write(`${opts.runId}\n`);
  } catch (err) {
    process.exitCode = 1;
    const message = err instanceof Error ? err.message : String(err);
    try {
      await emit({ k: "done", t: now(), ok: false, error: message });
    } catch (emitErr) {
      // Run-dir unwritable (ENOSPC, permissions, etc.). Surface it on stderr
      // so the failure is diagnosable, but don't rethrow — we still need the
      // finally below to reap the driver.
      const detail = emitErr instanceof Error ? emitErr.message : String(emitErr);
      process.stderr.write(`failed to record done event: ${detail}\n`);
    }
    process.stderr.write(`audit failed: ${message}\n`);
  } finally {
    if (driverHandle) {
      try {
        await driverHandle.stop();
      } catch (stopErr) {
        const detail = stopErr instanceof Error ? stopErr.message : String(stopErr);
        process.stderr.write(`failed to stop driver: ${detail}\n`);
      }
    }
  }
}

await main();
