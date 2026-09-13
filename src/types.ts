/**
 * Shapes a runner writes to disk (see docs/RUN_FORMAT.md). This module is the single place where the
 * on-disk contract is spelled out; change it here when the format changes.
 */

/** Run-level status. `stale`/`failed`/`completed` are derived here for imports. */
export type RunStatus =
  | "running"
  | "needs_input"
  | "blocked"
  | "ready_for_manager_review"
  | "completed"
  | "failed"
  | "stale"
  | "unknown";

/** Per-stage status; `active`/`pending` are derived, the rest come from agent reports. */
export type StageStatus = "pass" | "fail" | "needs_input" | "blocked" | "active" | "pending";

/** A pipeline run owns a full stage graph; an import is only the task read that precedes one. */
export type RunKind = "pipeline" | "import";

export interface StageReport {
  status: StageStatus;
  summary?: string;
  artifacts?: string[];
  issues?: string[];
  checks?: unknown[];
  acceptance_criteria?: string[];
  test_cases?: string[];
  evidence?: string[];
  engineers?: string[];
}

export interface HistoryEntry {
  stage: string;
  role?: string;
  engine?: string;
  model?: string;
  effort?: string;
  report?: StageReport;
  diff_stat?: string;
}

export interface InputSource {
  type?: string;
  task_id?: string;
  /** Absolute path of the import directory this run was created from. */
  path?: string;
  runner_prompt_chars?: number;
  stage_calls?: number;
}

/** Contents of `<run>/state.json`. Optional fields are absent in runs from older runner builds. */
export interface RunState {
  status?: string;
  workspace?: string;
  history?: HistoryEntry[];
  runner_prompt_chars?: number;
  stage_calls?: number;
  started_at?: string;
  base_sha?: string;
  brief_path?: string;
  repository?: string;
  input_source?: InputSource;
  active_stage?: string;
  fix_rounds?: number;
  reason?: string;
}

/** One line of `<run>/events.jsonl`, or a line of an import's `output.jsonl` normalised into this shape. */
export interface RunEvent {
  time: string;
  stage?: string;
  role?: string;
  status?: string;
  message: string;
}

/** A row in the runs list. Cheap to build: never parses a whole log file. */
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
  /** True when the run can be retried; `retryBlockedReason` explains a false. */
  retryable: boolean;
  retryBlockedReason: string | null;
}

/** One node of the stage graph, derived from history plus the configured stage order. */
export interface StageView {
  id: string;
  label: string;
  role: string | null;
  status: StageStatus;
  diffStat: string | null;
  artifacts: string[];
}

/** Everything the detail pane renders for one run. */
export interface RunDetail extends RunSummary {
  history: HistoryEntry[];
  stages: StageView[];
  events: RunEvent[];
  files: string[];
  reason: string | null;
}
