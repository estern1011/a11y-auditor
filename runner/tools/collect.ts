import type { TranscriptLine } from "../state.ts";

export interface CollectInput {
  url: string;
  driverPort: number;
  cdpPort: number;
  runDir: string;
}

export interface CollectResult {
  artifacts: Record<string, string>;
  transcript: TranscriptLine[];
  needsAuth: boolean;
}

// Wraps collect.ts. Phase A scaffold: returns an empty evidence envelope.
// Real implementation shells out to `bun collect.ts --url <url> --out <runDir>`
// (collect.ts will gain a `--out` flag per plan) and parses the resulting
// Evidence JSON into the runner's state shape.
export async function runCollect(input: CollectInput): Promise<CollectResult> {
  void input;
  return {
    artifacts: {},
    transcript: [],
    needsAuth: false,
  };
}
