/** Shared by the run use cases: validating ids and turning stored runs into list rows. */
import { InvalidInputError } from "../../domain/errors.ts";
import { importLabel, importStatus } from "../../domain/import_log.ts";
import { isValidRunId, parseRunStatus, retryBlockedReason, taskIdFromImportId } from "../../domain/run.ts";
import type { AppContext } from "../context.ts";
import type { StoredImport, StoredPipeline } from "../ports.ts";
import type { RunSummary } from "../views.ts";

export function requireRunId(id: string): string {
  if (!isValidRunId(id)) throw new InvalidInputError(`Invalid run id: ${JSON.stringify(id)}`);
  return id;
}

function isoOr(date: Date | null, fallback: string): string {
  return date ? date.toISOString() : fallback;
}

function lastSegment(path: string): string {
  return path.split("/").pop() ?? path;
}

export function pipelineSummary(stored: StoredPipeline): RunSummary {
  const { id, record } = stored;
  const status = parseRunStatus(record.status);
  const taskId = record.input_source?.task_id ?? null;
  return {
    id,
    kind: "pipeline",
    status,
    label: taskId ? `Task ${taskId}` : (record.brief_path ? lastSegment(record.brief_path) : id),
    activeStage: record.active_stage ?? null,
    stageCalls: record.stage_calls ?? 0,
    runnerPromptChars: record.runner_prompt_chars ?? 0,
    startedAt: record.started_at ?? null,
    updatedAt: isoOr(stored.recordWrittenAt, record.started_at ?? ""),
    taskId,
    workspace: record.workspace ?? null,
    repository: record.repository ?? null,
    importIds: [],
    retryable: status !== "running",
    retryBlockedReason: retryBlockedReason(status),
  };
}

export function importSummary(stored: StoredImport, context: AppContext): RunSummary {
  const { settings } = context;
  return {
    id: stored.id,
    kind: "import",
    status: importStatus(stored.lines, stored.lastWrite, context.now(), settings.staleImportMs),
    label: taskIdFromImportId(stored.id) ?? lastSegment(stored.id),
    activeStage: importLabel(settings.sourceLabel),
    stageCalls: 1,
    runnerPromptChars: 0,
    startedAt: null,
    updatedAt: isoOr(stored.lastWrite, new Date(0).toISOString()),
    taskId: taskIdFromImportId(stored.id),
    workspace: null,
    repository: null,
    importIds: [],
    retryable: false,
    retryBlockedReason: "Imports are re-run by starting the task again",
  };
}

/** Newest activity first. */
export function byRecentActivity(a: RunSummary, b: RunSummary): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}
