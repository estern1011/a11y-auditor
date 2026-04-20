export interface StartDriverInput {
  sr: "voiceover" | "orca";
  url: string;
  viewport: { w: number; h: number };
}

export interface StartDriverResult {
  driverPort: number;
  cdpPort: number;
}

// Thin wrapper around drivers/{voiceover,orca}/driver.ts `start` subcommand.
// Phase A scaffold: returns the default port pair so the graph can compile and
// run against an already-launched driver. Real implementation spawns the driver
// process, picks a free port (see Open Questions → Driver port allocation), and
// waits for readiness via the HTTP API.
export async function startDriver(input: StartDriverInput): Promise<StartDriverResult> {
  void input;
  const driverPort = input.sr === "voiceover" ? 7483 : 7484;
  const cdpPort = input.sr === "voiceover" ? 9222 : 9223;
  return { driverPort, cdpPort };
}
