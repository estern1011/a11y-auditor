/**
 * Driver interface for the daemon.
 *
 * Only Orca implements this in v1; the abstraction is preserved so a future
 * sibling (`agent-voiceover` on macOS) can offer the same HTTP API surface.
 */

import type { Page } from "playwright";
import type { VoResult, TranscriptEntry } from "./types.js";

export interface ScreenReaderDriver {
  readonly platform: "linux" | "macos";
  readonly name: string;
  readonly defaultPort: number;
  readonly defaultCdpPort: number;
  readonly logFile: string;
  readonly pidFile: string;
  readonly stateFile: string;
  readonly cliTimeoutMs: number;
  readonly maxRequestBody: number;

  // Lifecycle
  initialize(url: string | null, cdpPort: number): Promise<void>;
  cleanup(): Promise<void>;
  removePidFile(): void;

  // State
  getPage(): Page | null;
  getStatus(): { screenReaderActive: boolean; currentUrl: string | null; cdpPort: number };
  getTranscriptLength(): number;
  /**
   * Return the value a polling client should pass as `since=` next time to
   * receive only NEW entries. Equals the highest assigned transcript index,
   * NOT the buffer length — those differ after DELETE /transcript or after
   * the buffer rolls past MAX_TRANSCRIPT_ENTRIES. Returns -1 if no entries
   * have ever been recorded (so `since=-1` returns everything).
   */
  getTranscriptCursor(): number;

  // Navigation
  next(): Promise<VoResult>;
  previous(): Promise<VoResult>;
  act(): Promise<VoResult>;
  enter(): Promise<VoResult>;
  navigate(url: string): Promise<VoResult>;

  // Interaction
  perform(command: string): Promise<VoResult>;
  press(key: string, modifiers?: string[]): Promise<VoResult>;

  // Queries
  getItemText(): Promise<VoResult>;
  getTranscript(since?: number): TranscriptEntry[];
  clearTranscript(): TranscriptEntry[];
  getCommandNames(): string[];

  // Logging
  log(msg: string, err?: boolean): void;
}
