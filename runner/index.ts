import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildGraph } from "./graph.ts";
import { ensureRunDir, resolveRunDir, appendEvent } from "./tools/run-dir.ts";
import { serialize, now, type RunnerEvent } from "./events.ts";

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
    throw new Error("Usage: bun run audit <url> [--wcag AA] [--viewport 1440x900] [--sr voiceover|orca] [--run-id <id>] [--auth-env <path>]");
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
  const opts = parseCli(process.argv.slice(2));
  const runDir = resolveRunDir(opts.runId);
  await ensureRunDir(runDir);

  const graph = buildGraph();
  // Save the declared graph shape so the UI can render it (plan § LangGraph graph).
  try {
    const mermaid = await graph.getGraph().drawMermaid();
    await writeFile(join(runDir, "graph.mmd"), mermaid, "utf8");
  } catch {
    // Older LangGraph versions may expose `drawMermaidPng` only; non-fatal here.
  }

  const emit = async (ev: RunnerEvent) => {
    await appendEvent(runDir, serialize(ev));
  };

  await emit({ k: "run.start", t: now(), runId: opts.runId, url: opts.url });

  try {
    const finalState = await graph.invoke({
      runId: opts.runId,
      url: opts.url,
      sr: opts.sr,
      wcag: opts.wcag,
      viewport: opts.viewport,
      runDir,
    });
    void finalState;
    await emit({ k: "done", t: now(), ok: true });
    process.stdout.write(`${opts.runId}\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await emit({ k: "done", t: now(), ok: false });
    process.stderr.write(`audit failed: ${message}\n`);
    process.exit(1);
  }
}

await main();
