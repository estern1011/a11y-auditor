/**
 * Event hub for the live view's `/events` WebSocket.
 *
 * A tiny in-process pub/sub. The driver core emits `focus` (and the speech
 * tap emits `transcript`) here; the server fans them out to every connected
 * `/events` client as JSON. Orchestrators may also push `phase` events to
 * annotate what stage an audit is in — the viewer renders them inline, and
 * it's a no-op if nothing emits them.
 *
 * Zero heavy deps so both the driver and the speech module can import it
 * without a dependency cycle.
 */

import { EventEmitter } from "events";

export interface TranscriptEvent {
  /** epoch ms */
  t: number;
  /** "orca" for screen-reader speech; orchestrators may use their own labels */
  source: string;
  text: string;
}

export interface FocusEvent {
  t: number;
  /** AT-SPI screen-coordinate bounding box, full Xvfb framebuffer space */
  bbox?: { x: number; y: number; w: number; h: number };
  role: string;
  name: string;
}

export interface PhaseEvent {
  t: number;
  name: string;
}

export type LiveEvent =
  | ({ type: "transcript" } & TranscriptEvent)
  | ({ type: "focus" } & FocusEvent)
  | ({ type: "phase" } & PhaseEvent);

class LiveEventHub extends EventEmitter {
  emitTranscript(e: Omit<TranscriptEvent, "t"> & { t?: number }): void {
    this.emit("event", { type: "transcript", t: e.t ?? Date.now(), source: e.source, text: e.text });
  }

  emitFocus(e: Omit<FocusEvent, "t"> & { t?: number }): void {
    this.emit("event", { type: "focus", t: e.t ?? Date.now(), bbox: e.bbox, role: e.role, name: e.name });
  }

  emitPhase(e: Omit<PhaseEvent, "t"> & { t?: number }): void {
    this.emit("event", { type: "phase", t: e.t ?? Date.now(), name: e.name });
  }

  /** Subscribe; returns an unsubscribe fn. */
  subscribe(fn: (e: LiveEvent) => void): () => void {
    this.on("event", fn);
    return () => this.off("event", fn);
  }
}

// Single shared hub for the process.
export const liveEvents = new LiveEventHub();
liveEvents.setMaxListeners(64);
