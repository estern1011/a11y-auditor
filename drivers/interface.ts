/**
 * Common interface for screen reader drivers.
 *
 * Both VoiceOver (macOS) and Orca (Linux) implement this interface,
 * allowing the HTTP server, CLI, and audit tools to work identically
 * regardless of the underlying screen reader.
 */

import type { Page } from "playwright";
import type { VoResult, TranscriptEntry } from "./types.ts";

export interface ScreenReaderDriver {
  readonly platform: "macos" | "linux";
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
