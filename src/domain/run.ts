/**
 * The run entity: what a pipeline runner records about one run, and the rules that
 * interpret it. Field names follow the run directory format (docs/RUN_FORMAT.md).
 */

/** Run-level status. `completed`, `failed` and `stale` are derived for imports. */
export type RunStatus =
  | "running"
  | "needs_input"
  | "blocked"
  | "ready_for_manager_review"
  | "completed"
  | "failed"
  | "stale"
  | "unknown";

/** Per-stage status; `active` and `pending` are derived, the rest come from agent reports. */
export type StageStatus = "pass" | "fail" | "needs_input" | "blocked" | "active" | "pending";

/** A pipeline run owns a stage graph; an import is only the task read that precedes one. */
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

/** A run as its runner recorded it. Optional fields are absent in runs from older runners. */
export interface RunRecord {
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

/** One entry of a run's activity log. */
export interface RunEvent {
  time: string;
  stage?: string;
  role?: string;
  status?: string;
  message: string;
}

const PIPELINE_STATUSES: readonly RunStatus[] = [
  "running",
  "needs_input",
  "blocked",
  "ready_for_manager_review",
];

/** Statuses meaning an agent or the runner stopped and a human has to answer. */
const WAITING: ReadonlySet<string> = new Set(["needs_input", "blocked"]);

/** Interprets a recorded status; anything outside the format's vocabulary is `unknown`. */
export function parseRunStatus(value: unknown): RunStatus {
  return PIPELINE_STATUSES.includes(value as RunStatus) ? value as RunStatus : "unknown";
}

export function isWaitingStatus(status: string | undefined): boolean {
  return status !== undefined && WAITING.has(status);
}

/** A live run cannot be re-run; anything that has stopped can. */
export function retryBlockedReason(status: RunStatus): string | null {
  return status === "running" ? "Run is still active" : null;
}

/** Imports live under this prefix of the runs root. */
export const IMPORTS_PREFIX = "imports";

export function isImportId(id: string): boolean {
  return id.startsWith(`${IMPORTS_PREFIX}/`);
}

/** The import id a run was created from, given the import folder path it recorded. */
export function importIdForPath(path: string): string {
  const name = path.replace(/\/+$/, "").split("/").pop() ?? path;
  return `${IMPORTS_PREFIX}/${name}`;
}

/** Import folders are named `<source>-<taskId>-<suffix>`, e.g. `jira-PROJ42-x1y2`. */
export function taskIdFromImportId(id: string): string | null {
  const name = id.split("/").pop() ?? id;
  const match = /^[a-z][a-z0-9]*-([A-Za-z0-9]+)-[A-Za-z0-9_]+$/.exec(name);
  return match ? match[1] : null;
}

/** Run ids are one or two path segments: `run-abc123` or `imports/<source>-<task>-<suffix>`. */
const RUN_ID = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?$/;

/** Rejects `.`, `..`, absolute paths and anything else that could leave the runs root. */
export function isValidRunId(id: string): boolean {
  return RUN_ID.test(id);
}

/**
 * Stages a relaunch would run again. A relaunch starts a brand new run, so this is every
 * stage already completed plus the one that asked — shown so the cost of answering is
 * visible before the click, not after.
 */
export function replayedStages(record: RunRecord): string[] {
  const done = (record.history ?? []).map((entry) => entry.stage);
  const asking = record.active_stage;
  return asking && !done.includes(asking) ? [...done, asking] : done;
}

/** The last history entry whose report stopped the run, else the last entry. */
export function askingStage(record: RunRecord): HistoryEntry | null {
  const history = record.history ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (isWaitingStatus(history[i].report?.status)) return history[i];
  }
  return history.at(-1) ?? null;
}

/** A run's activity log for display: well-formed entries only, most recent `limit`. */
export function toRunEvents(lines: readonly unknown[], limit: number): RunEvent[] {
  return (lines as RunEvent[])
    .filter((event) => event && typeof event.message === "string")
    .slice(-limit);
}
