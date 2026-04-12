/**
 * Platform detection and driver creation.
 *
 * Auto-detects macOS vs Linux and loads the appropriate screen reader driver.
 * Can be overridden with SCREEN_READER_FORCE env var.
 */

import type { ScreenReaderDriver } from "../drivers/interface.ts";

export async function createDriver(): Promise<ScreenReaderDriver> {
  const forced = process.env.SCREEN_READER_FORCE?.toLowerCase();

  if (forced === "voiceover" || (!forced && process.platform === "darwin")) {
    const { createVoiceOverDriver } = await import("./voiceover.ts");
    return createVoiceOverDriver();
  }

  if (forced === "orca" || (!forced && process.platform === "linux")) {
    const { createOrcaDriver } = await import("./orca.ts");
    return createOrcaDriver();
  }

  throw new Error(
    `Unsupported platform: ${process.platform}. ` +
      `Supported: macOS (VoiceOver), Linux (Orca). ` +
      `Override with SCREEN_READER_FORCE=voiceover|orca`,
  );
}
