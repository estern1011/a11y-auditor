import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PhaseId, TranscriptLine } from "../state.ts";

// Absolute path to collect.ts at the repo root. Derived from this module's URL
// so the runner works regardless of the caller's cwd (e.g. when invoked from
// an orchestrator with a different working directory).
const COLLECT_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "collect.ts");

export interface CollectInput {
  url: string;
  driverPort: number;
  cdpPort: number;
  runDir: string;
  /** Phase the synthesized transcript lines are attributed to. Defaults to "discover". */
  phase?: PhaseId;
}

export interface CollectResult {
  /** Map of artifact key → absolute path on disk. Includes an "evidence" entry for evidence.json. */
  artifacts: Record<string, string>;
  transcript: TranscriptLine[];
  needsAuth: boolean;
}

// On-disk manifest written by collect.ts when invoked with --out <dir>.
// Kept in sync with the EvidenceManifest in /collect.ts.
interface EvidenceManifest {
  url: string;
  artifacts: Record<string, string>;
  sr?: {
    onLoad?: SrEntry[];
    tabSequence?: SrEntry[];
    landmarks?: SrEntry[];
    headings?: SrEntry[];
    links?: SrEntry[];
  };
  signals?: { needsAuth?: boolean };
}

interface SrEntry {
  spoken?: string;
  name?: string;
  role?: string;
  state?: string[];
}

// Wraps collect.ts. Shells out to `bun collect.ts <url> --port <p> --cdp-port <p> --out <runDir>`
// and parses the resulting evidence.json manifest into the runner's state shape:
//   - artifacts: absolute paths the report/UI can read directly
//   - transcript: SR entries flattened into TranscriptLine[] tagged with SR label
//   - needsAuth: heuristic signal driving the discover→auth conditional edge
export async function runCollect(input: CollectInput): Promise<CollectResult> {
  const outDir = resolve(input.runDir);
  const proc = Bun.spawn(
    [
      "bun",
      COLLECT_SCRIPT,
      input.url,
      "--port",
      String(input.driverPort),
      "--cdp-port",
      String(input.cdpPort),
      "--out",
      outDir,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const detail = stderr.trim() || stdout.trim() || "(no output)";
    throw new Error(`collect.ts failed (exit ${exitCode}): ${detail}`);
  }

  const evidencePath = join(outDir, "evidence.json");
  const raw = await readFile(evidencePath, "utf8");
  const manifest = JSON.parse(raw) as EvidenceManifest;

  const artifacts = absolutizeArtifacts(manifest.artifacts ?? {}, outDir);
  artifacts.evidence = evidencePath;

  const phase = input.phase ?? "discover";
  const transcript = flattenSrTranscript(manifest.sr, phase);

  return {
    artifacts,
    transcript,
    needsAuth: Boolean(manifest.signals?.needsAuth),
  };
}

function absolutizeArtifacts(rel: Record<string, string>, outDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, relPath] of Object.entries(rel)) {
    const abs = resolve(outDir, relPath);
    // Defense against a malformed manifest that tries to escape the run dir —
    // manifest paths must stay inside outDir so a compromised collect run
    // cannot point artifacts at arbitrary files on disk.
    const rebased = relative(outDir, abs);
    if (rebased.startsWith("..") || rebased.includes("\0")) {
      throw new Error(`evidence.json artifact '${key}' escapes run dir: ${relPath}`);
    }
    out[key] = abs;
  }
  return out;
}

function flattenSrTranscript(sr: EvidenceManifest["sr"], phase: PhaseId): TranscriptLine[] {
  if (!sr) return [];
  const now = Date.now();
  const lines: TranscriptLine[] = [];
  const add = (entries: SrEntry[] | undefined, label: string) => {
    if (!entries) return;
    for (const e of entries) {
      const text = e.spoken || [e.name, e.role, ...(e.state ?? [])].filter(Boolean).join(", ");
      if (!text) continue;
      lines.push({ t: now, phase, channel: "sr", text: `[${label}] ${text}` });
    }
  };
  add(sr.onLoad, "onLoad");
  add(sr.tabSequence, "tab");
  add(sr.landmarks, "landmark");
  add(sr.headings, "heading");
  add(sr.links, "link");
  return lines;
}
