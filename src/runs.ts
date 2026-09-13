/**
 * Reads a runs directory and derives everything the dashboard shows.
 * This is the only module that knows the on-disk layout (docs/RUN_FORMAT.md), so it
 * is the one to test when a runner changes what it writes.
 */
import { basename, join } from "@std/path";
import type { Config } from "./config.ts";
import { assertRunId, notFound } from "./errors.ts";
import { parseJsonLines, readTail } from "./jsonl.ts";
import type {
  HistoryEntry,
  RunDetail,
  RunEvent,
  RunState,
  RunStatus,
  RunSummary,
  StageView,
} from "./types.ts";

const IMPORTS_DIR = "imports";
/** Enough of an import log to reach the trailing `result` line without reading the whole file. */
const LIST_TAIL_BYTES = 64 * 1024;
const DETAIL_TAIL_BYTES = 512 * 1024;
const MAX_EVENTS = 60;

const PIPELINE_STATUSES: RunStatus[] = [
  "running",
  "needs_input",
  "blocked",
  "ready_for_manager_review",
];

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
  } catch {
    return null;
  }
}

async function listEntries(dir: string): Promise<Deno.DirEntry[]> {
  const out: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) out.push(entry);
  } catch {
    // Missing or unreadable runs root: an empty dashboard is the correct answer.
  }
  return out;
}

async function modifiedAt(path: string): Promise<Date | null> {
  try {
    return (await Deno.stat(path)).mtime;
  } catch {
    return null;
  }
}

function isoOr(date: Date | null, fallback: string): string {
  return date ? date.toISOString() : fallback;
}

function asRunStatus(value: unknown): RunStatus {
  return PIPELINE_STATUSES.includes(value as RunStatus) ? value as RunStatus : "unknown";
}

// ---------------------------------------------------------------- imports

interface ImportProbe {
  status: RunStatus;
  updatedAt: string;
  events: RunEvent[];
}

/**
 * Derives an import's state from its `output.jsonl`. A finished import ends with a
 * `result` line; one without it that has stopped growing is dead, not running, so it
 * is reported as `stale` instead of inflating the active count forever.
 */
async function probeImport(dir: string, config: Config, detail: boolean): Promise<ImportProbe> {
  const log = join(dir, "output.jsonl");
  const mtime = await modifiedAt(log) ?? await modifiedAt(dir);
  const updatedAt = isoOr(mtime, new Date(0).toISOString());
  const raw = await readTail(log, detail ? DETAIL_TAIL_BYTES : LIST_TAIL_BYTES);
  const lines = parseJsonLines(raw) as Record<string, unknown>[];

  const result = lines.findLast((line) => line.type === "result");
  let status: RunStatus;
  if (result) status = result.is_error ? "failed" : "completed";
  else if (mtime && Date.now() - mtime.getTime() > config.staleImportMs) status = "stale";
  else status = "running";

  return {
    status,
    updatedAt,
    events: detail ? importEvents(lines, updatedAt, importLabel(config)) : [],
  };
}

/** Turns raw agent stream lines into the short activity entries the detail pane lists. */
function importEvents(
  lines: Record<string, unknown>[],
  fallbackTime: string,
  label: string,
): RunEvent[] {
  const events: RunEvent[] = [];
  for (const line of lines) {
    const time = typeof line.timestamp === "string" ? line.timestamp : fallbackTime;
    if (line.type === "result") {
      events.push({
        time,
        message: line.is_error ? `${label} failed` : `${label} completed`,
        status: line.is_error ? "failed" : "completed",
      });
      continue;
    }
    const message = line.message as { content?: { type?: string; name?: string }[] } | undefined;
    const tools = (message?.content ?? [])
      .filter((block) => block.type === "tool_use")
      .map((block) => block.name ?? "tool")
      .join(", ");
    if (tools) events.push({ time, message: tools });
  }
  return events.slice(-MAX_EVENTS);
}

/** "Jira import", "task import" — whatever the configured source is called. */
function importLabel(config: Config): string {
  return `${config.sourceLabel} import`;
}

function importSummary(id: string, probe: ImportProbe, config: Config): RunSummary {
  return {
    id,
    kind: "import",
    status: probe.status,
    label: taskIdFromImport(id) ?? basename(id),
    activeStage: importLabel(config),
    stageCalls: 1,
    runnerPromptChars: 0,
    startedAt: null,
    updatedAt: probe.updatedAt,
    taskId: taskIdFromImport(id),
    workspace: null,
    repository: null,
    importIds: [],
    retryable: false,
    retryBlockedReason: "Imports are re-run by starting the task again",
  };
}

/** Import directories are named `<source>-<taskId>-<suffix>`, e.g. `jira-PROJ42-x1y2`. */
function taskIdFromImport(id: string): string | null {
  const match = /^[a-z][a-z0-9]*-([A-Za-z0-9]+)-[A-Za-z0-9_]+$/.exec(basename(id));
  return match ? match[1] : null;
}

// --------------------------------------------------------------- pipelines

function pipelineSummary(id: string, state: RunState, updatedAt: string): RunSummary {
  const status = asRunStatus(state.status);
  const taskId = state.input_source?.task_id ?? null;
  return {
    id,
    kind: "pipeline",
    status,
    label: taskId ? `Task ${taskId}` : (state.brief_path ? basename(state.brief_path) : id),
    activeStage: state.active_stage ?? null,
    stageCalls: state.stage_calls ?? 0,
    runnerPromptChars: state.runner_prompt_chars ?? 0,
    startedAt: state.started_at ?? null,
    updatedAt,
    taskId,
    workspace: state.workspace ?? null,
    repository: state.repository ?? null,
    importIds: [],
    retryable: status !== "running",
    retryBlockedReason: status === "running" ? "Run is still active" : null,
  };
}

// ------------------------------------------------------------------- list

/**
 * Lists every run, newest activity first. An import that a pipeline run was created
 * from is folded into that run rather than listed twice.
 */
export async function listRuns(config: Config): Promise<RunSummary[]> {
  const pipelines: RunSummary[] = [];
  const consumedImports = new Map<string, RunSummary>();

  for (const entry of await listEntries(config.runsRoot)) {
    if (!entry.isDirectory || entry.name === IMPORTS_DIR) continue;
    const dir = join(config.runsRoot, entry.name);
    const state = await readJson<RunState>(join(dir, "state.json"));
    if (!state) continue;
    const updatedAt = isoOr(await modifiedAt(join(dir, "state.json")), state.started_at ?? "");
    const summary = pipelineSummary(entry.name, state, updatedAt);
    pipelines.push(summary);
    if (state.input_source?.path) {
      consumedImports.set(`${IMPORTS_DIR}/${basename(state.input_source.path)}`, summary);
    }
  }

  const orphans: RunSummary[] = [];
  for (const entry of await listEntries(join(config.runsRoot, IMPORTS_DIR))) {
    if (!entry.isDirectory) continue;
    const id = `${IMPORTS_DIR}/${entry.name}`;
    const parent = consumedImports.get(id);
    if (parent) {
      parent.importIds.push(id);
      continue;
    }
    const probe = await probeImport(join(config.runsRoot, IMPORTS_DIR, entry.name), config, false);
    orphans.push(importSummary(id, probe, config));
  }

  return [...pipelines, ...orphans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// ------------------------------------------------------------ stage graph

/**
 * The stages to draw for a run. A run describes its own pipeline: every stage in its
 * history is shown, labelled with the role that ran it. Configured stages add ordering,
 * friendlier labels, and the stages that have not started yet.
 */
export function stageGraph(state: RunState, config: Config): StageView[] {
  const history = state.history ?? [];
  // A stage can run more than once (fix rounds); the latest entry is its current state.
  const latest = new Map<string, HistoryEntry>();
  for (const entry of history) latest.set(entry.stage, entry);

  const order: string[] = [];
  const add = (id: string | undefined) => {
    if (id && !order.includes(id)) order.push(id);
  };
  for (const stage of config.stages) add(stage.id);
  for (const entry of history) add(entry.stage);
  add(state.active_stage);

  const labels = new Map(config.stages.map((stage) => [stage.id, stage.label]));
  return order.map((id) => {
    const entry = latest.get(id);
    const role = entry?.role ?? null;
    return {
      id,
      label: labels.get(id) ?? (role ? `${role} · ${id}` : id),
      role,
      status: entry?.report?.status ?? (state.active_stage === id ? "active" : "pending"),
      diffStat: entry?.diff_stat ?? null,
      artifacts: entry?.report?.artifacts ?? [],
    };
  });
}

// ----------------------------------------------------------------- detail

/** Stage folders are `NN-<stage>-<role>`. */
const STAGE_DIR = /^\d+-.+-[a-z]+$/;

/**
 * Latest modification time anywhere a runner writes during a run: the run directory,
 * its files, each stage folder and the files inside it. state.json alone misses an agent
 * writing its report or output.log mid-stage.
 */
async function latestActivity(dir: string, fallback: string): Promise<string> {
  let latest = 0;
  const consider = async (path: string) => {
    const mtime = await modifiedAt(path);
    if (mtime && mtime.getTime() > latest) latest = mtime.getTime();
  };
  await consider(dir);
  for (const entry of await listEntries(dir)) {
    const path = join(dir, entry.name);
    await consider(path);
    if (!entry.isDirectory || !STAGE_DIR.test(entry.name)) continue;
    for (const file of await listEntries(path)) await consider(join(path, file.name));
  }
  return latest ? new Date(latest).toISOString() : fallback;
}

async function listFiles(dir: string): Promise<string[]> {
  return (await listEntries(dir)).filter((e) => e.isFile).map((e) => e.name).sort();
}

async function pipelineEvents(dir: string): Promise<RunEvent[]> {
  const raw = await readTail(join(dir, "events.jsonl"), DETAIL_TAIL_BYTES);
  return (parseJsonLines(raw) as RunEvent[])
    .filter((event) => event && typeof event.message === "string")
    .slice(-MAX_EVENTS);
}

/** Loads one run's detail. Throws `HttpError(404)` when the run does not exist. */
export async function getRun(config: Config, rawId: string): Promise<RunDetail> {
  const id = assertRunId(rawId);
  const dir = join(config.runsRoot, id);

  if (id.startsWith(`${IMPORTS_DIR}/`)) {
    const stat = await modifiedAt(dir);
    if (!stat) throw notFound(`No import at ${id}`);
    const probe = await probeImport(dir, config, true);
    return {
      ...importSummary(id, probe, config),
      history: [],
      stages: [],
      activityAt: probe.updatedAt,
      events: probe.events,
      files: await listFiles(dir),
      reason: null,
    };
  }

  const state = await readJson<RunState>(join(dir, "state.json"));
  if (!state) throw notFound(`No run at ${id}`);
  const updatedAt = isoOr(await modifiedAt(join(dir, "state.json")), state.started_at ?? "");
  const summary = pipelineSummary(id, state, updatedAt);
  if (state.input_source?.path) {
    summary.importIds.push(`${IMPORTS_DIR}/${basename(state.input_source.path)}`);
  }
  return {
    ...summary,
    history: (state.history ?? []) as HistoryEntry[],
    stages: stageGraph(state, config),
    activityAt: await latestActivity(dir, updatedAt),
    events: await pipelineEvents(dir),
    files: await listFiles(dir),
    reason: state.reason ?? null,
  };
}

/** Reads a run's state for the action layer, without building a full detail payload. */
export async function readRunState(config: Config, rawId: string): Promise<RunState | null> {
  const id = assertRunId(rawId);
  return await readJson<RunState>(join(config.runsRoot, id, "state.json"));
}

export function runDirectory(config: Config, rawId: string): string {
  return join(config.runsRoot, assertRunId(rawId));
}
