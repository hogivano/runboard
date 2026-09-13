/** Output models the use cases return: the shape the dashboard renders. */
import type { HistoryEntry, RunEvent, RunKind, RunStatus } from "../domain/run.ts";
import type { StageView } from "../domain/stage.ts";

/** A row in the runs list. Cheap to build: never reads a whole log file. */
export interface RunSummary {
  id: string;
  kind: RunKind;
  status: RunStatus;
  label: string;
  activeStage: string | null;
  stageCalls: number;
  runnerPromptChars: number;
  startedAt: string | null;
  updatedAt: string;
  taskId: string | null;
  workspace: string | null;
  repository: string | null;
  /** Import ids folded into this run, so one unit of work shows as one row. */
  importIds: string[];
  retryable: boolean;
  retryBlockedReason: string | null;
}

/** Everything the detail pane renders for one run. */
export interface RunDetail extends RunSummary {
  history: HistoryEntry[];
  stages: StageView[];
  /** Latest write anywhere in the run's folder, including inside stage folders. */
  activityAt: string;
  events: RunEvent[];
  files: string[];
  reason: string | null;
}

export interface ReplyResult {
  recorded: true;
  /** Where the answer was written, so it is never "saved" into nothing. */
  answersPath: string;
  feedbackPath: string;
  /** True when an agent will actually read the answer; false when it only sits on disk. */
  delivered: boolean;
  delivery: string;
  replays: string[];
  launch: { pid: number; command: string[] } | null;
}

/** What the UI may know about the server. Never paths. */
export interface PublicSettings {
  title: string;
  sourceLabel: string;
  canLaunch: boolean;
}
