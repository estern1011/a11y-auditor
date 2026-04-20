import { Annotation } from "@langchain/langgraph";

export type PhaseId =
  | "boot"
  | "discover"
  | "auth"
  | "baseline"
  | "keyboard"
  | "visual"
  | "report";

export type PhaseStatus = "pending" | "running" | "ok" | "skip" | "error";

export type Severity = "critical" | "serious" | "moderate" | "minor";

export interface Finding {
  id: string;
  criterion: string;
  severity: Severity;
  title: string;
  detail?: string;
  selector?: string;
  screenshot?: string;
  markers?: Array<{ x: number; y: number; w: number; h: number }>;
  sources?: Array<"axe" | "sr" | "keyboard" | "visual" | "manual">;
}

export interface TranscriptLine {
  t: number;
  phase: PhaseId;
  channel: "sr" | "key" | "tool" | "agent" | "system";
  text: string;
}

const lastWriteWins =
  <T>() =>
  (_a: T, b: T) =>
    b;

export const State = Annotation.Root({
  runId: Annotation<string>({ reducer: lastWriteWins<string>(), default: () => "" }),
  url: Annotation<string>({ reducer: lastWriteWins<string>(), default: () => "" }),
  sr: Annotation<"voiceover" | "orca">({
    reducer: lastWriteWins<"voiceover" | "orca">(),
    default: () => "orca",
  }),
  wcag: Annotation<"A" | "AA" | "AAA">({
    reducer: lastWriteWins<"A" | "AA" | "AAA">(),
    default: () => "AA",
  }),
  viewport: Annotation<{ w: number; h: number }>({
    reducer: lastWriteWins<{ w: number; h: number }>(),
    default: () => ({ w: 1440, h: 900 }),
  }),
  driverPort: Annotation<number>({ reducer: lastWriteWins<number>(), default: () => 0 }),
  cdpPort: Annotation<number>({ reducer: lastWriteWins<number>(), default: () => 0 }),
  runDir: Annotation<string>({ reducer: lastWriteWins<string>(), default: () => "" }),
  authEnvPath: Annotation<string | undefined>({
    reducer: lastWriteWins<string | undefined>(),
    default: () => undefined,
  }),

  findings: Annotation<Finding[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  transcript: Annotation<TranscriptLine[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  artifacts: Annotation<Record<string, string>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  phaseStatus: Annotation<Record<PhaseId, PhaseStatus>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({
      boot: "pending",
      discover: "pending",
      auth: "pending",
      baseline: "pending",
      keyboard: "pending",
      visual: "pending",
      report: "pending",
    }),
  }),

  needsAuth: Annotation<boolean>({ reducer: lastWriteWins<boolean>(), default: () => false }),
  hasInteractive: Annotation<boolean>({
    reducer: lastWriteWins<boolean>(),
    default: () => true,
  }),
  treeEmpty: Annotation<boolean>({ reducer: lastWriteWins<boolean>(), default: () => false }),
});

export type RunnerState = typeof State.State;
export type RunnerStateUpdate = typeof State.Update;
