import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Finding, TranscriptLine } from "../state.ts";

export interface RunMeta {
  runId: string;
  url: string;
  sr: "voiceover" | "orca";
  wcag: "A" | "AA" | "AAA";
  viewport: { w: number; h: number };
  driverPort: number;
  cdpPort: number;
  startedAt: string;
  authProvided?: boolean;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function assertSafeRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(
      `Invalid run-id '${runId}'. Must match ${RUN_ID_PATTERN} (ASCII alnum + '-'/'_', ≤64 chars, no path separators).`,
    );
  }
}

export function resolveRunDir(runId: string): string {
  assertSafeRunId(runId);
  const root = process.env.A11Y_RUNS_DIR ?? "./runs";
  return join(root, runId);
}

export async function ensureRunDir(runDir: string): Promise<void> {
  await mkdir(join(runDir, "artifacts"), { recursive: true });
}

// Blank per-run output so retries with the same --run-id never expose stale
// data. events.ndjson gets truncated; the JSON result files get rewritten to
// empty arrays so a run that fails before reportNode doesn't leave prior
// findings/markers/transcript lying around for downstream readers to pick up.
export async function resetRunDir(runDir: string): Promise<void> {
  await writeFile(join(runDir, "events.ndjson"), "", "utf8");
  const empty = "[]\n";
  await writeFile(join(runDir, "findings.json"), empty, "utf8");
  await writeFile(join(runDir, "markers.json"), empty, "utf8");
  await writeFile(join(runDir, "transcript.json"), empty, "utf8");
}

export async function writeMeta(runDir: string, meta: RunMeta): Promise<void> {
  await writeJson(join(runDir, "meta.json"), meta);
}

export async function writeFindings(runDir: string, findings: Finding[]): Promise<void> {
  await writeJson(join(runDir, "findings.json"), findings);
}

export async function writeMarkers(runDir: string, findings: Finding[]): Promise<void> {
  const markers = findings
    .filter((f) => f.markers && f.markers.length > 0)
    .map((f) => ({ id: f.id, screenshot: f.screenshot, markers: f.markers }));
  await writeJson(join(runDir, "markers.json"), markers);
}

export async function writeTranscript(
  runDir: string,
  transcript: TranscriptLine[],
): Promise<void> {
  await writeJson(join(runDir, "transcript.json"), transcript);
}

export async function appendEvent(runDir: string, line: string): Promise<void> {
  await appendFile(join(runDir, "events.ndjson"), line.endsWith("\n") ? line : line + "\n");
}
