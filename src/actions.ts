/** Side-effecting operations: launching the runner CLI and recording answers. */
import { join } from "@std/path";
import type { Config } from "./config.ts";
import type { RunState } from "./types.ts";
import { badRequest, conflict, HttpError, notFound } from "./errors.ts";
import { readRunState, runDirectory } from "./runs.ts";
import { replayedStages } from "./questions.ts";

const MAX_FEEDBACK_CHARS = 20_000;

export interface LaunchResult {
  pid: number;
  command: string[];
}

/**
 * Wrapper used to start a run. `Deno.Command` has no `detached` option, so a plain
 * spawn would put the run in the dashboard's process group and Ctrl-C in the
 * dashboard's terminal would kill it mid-stage. `sh` ignores SIGINT/SIGHUP and then
 * `exec`s the launcher; an ignored disposition survives exec, so the run outlives the
 * dashboard the way it did before.
 */
const DETACH_SHELL = "/bin/sh";
const DETACH_SCRIPT = 'trap "" INT HUP; exec "$@"';

/** Fails early with a readable message rather than a shell exit code of 127. */
async function assertLauncherRunnable(launcher: string | null): Promise<string> {
  if (!launcher) {
    throw badRequest(
      "No launcher is configured, so runboard cannot start runs. Set RUNBOARD_LAUNCHER or " +
        "`launcher` in runboard.config.json.",
    );
  }
  let info: Deno.FileInfo;
  try {
    info = await Deno.stat(launcher);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw badRequest(
        `Launcher not found at ${launcher}. Set RUNBOARD_LAUNCHER to the runner CLI path.`,
      );
    }
    throw error;
  }
  if (!info.isFile) throw badRequest(`Launcher at ${launcher} is not a file`);
  if (info.mode !== null && (info.mode & 0o111) === 0) {
    throw badRequest(`Launcher at ${launcher} is not executable`);
  }
  return launcher;
}

/**
 * Spawns the runner CLI and detaches from it. Arguments are passed as a
 * list, never a shell string, so nothing typed into the dashboard can be interpreted
 * as shell syntax.
 */
export async function launch(config: Config, args: string[]): Promise<LaunchResult> {
  const launcher = await assertLauncherRunnable(config.launcher);
  const child = new Deno.Command(DETACH_SHELL, {
    args: ["-c", DETACH_SCRIPT, "runboard-launch", launcher, ...args],
    cwd: config.launchCwd,
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
  child.unref();
  // The run owns its own lifetime; ignore its exit so no unhandled rejection is left behind.
  child.status.catch(() => {});
  return { pid: child.pid, command: [launcher, ...args] };
}

function cleanText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw badRequest(`${field} is required`);
  const text = value.trim();
  if (text.includes("\0")) throw badRequest(`${field} contains invalid characters`);
  return text;
}

export interface StartInput {
  task?: unknown;
  repo?: unknown;
}

/** Starts a fresh run from a task URL or id. */
export function startRun(config: Config, input: StartInput): Promise<LaunchResult> {
  const args = [cleanText(input.task, "Task URL or ID")];
  if (input.repo !== undefined && input.repo !== "") {
    args.push("--repo", cleanText(input.repo, "Repository path"));
  }
  return launch(config, args);
}

export interface RetryInput {
  repo?: unknown;
  feedback?: unknown;
  /**
   * Re-read the task from its source instead of reusing the brief the first import produced.
   * Off by default: the re-read is a full agent call, and the saved brief is the same
   * task text the original run worked from.
   */
  refreshTask?: unknown;
}

/**
 * Picks the input arguments for a fresh run, preferring a brief already on disk.
 *
 * The runner records `brief_path`; older runs do not, but `input_source.path` points at
 * the import directory, and a completed import leaves `brief.md` there. Reusing it
 * skips a task re-import, which is a full agent call.
 */
async function inputArgs(state: RunState, refresh: boolean): Promise<string[]> {
  if (!refresh) {
    const candidates = [
      state.brief_path,
      state.input_source?.path ? join(state.input_source.path, "brief.md") : null,
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (await Deno.stat(candidate).then((info) => info.isFile).catch(() => false)) {
        return ["--brief", candidate];
      }
    }
  }
  if (state.input_source?.task_id) return [state.input_source.task_id];
  // Passing a brief that is gone would start a run that fails at once while the UI
  // reports it as sent, so a missing brief is an error, not a fallback.
  if (state.brief_path) {
    throw badRequest(
      `The brief this run used is missing (${state.brief_path}) and the run has no task id to re-read`,
    );
  }
  throw badRequest("Run has no reusable task or brief to retry from");
}

/**
 * Re-runs a finished run in a fresh worktree. The repository comes from the run's own
 * state when the runner recorded one; older runs may not, so the caller must supply it.
 */
export async function retryRun(
  config: Config,
  id: string,
  input: RetryInput,
): Promise<LaunchResult> {
  if (id.startsWith("imports/")) {
    throw badRequest("Imports cannot be retried; start the task again instead");
  }
  const state = await readRunState(config, id);
  if (!state) throw notFound(`No run at ${id}`);
  // Without a launcher nothing else about the re-run matters; say that first.
  await assertLauncherRunnable(config.launcher);
  if (state.status === "running") {
    throw conflict("Run is still active; wait for it to finish or block before retrying");
  }

  const repository = input.repo !== undefined && input.repo !== ""
    ? cleanText(input.repo, "Repository path")
    : state.repository;
  if (!repository) {
    throw badRequest(
      "This run did not record its repository. Enter the repository path in the retry form.",
    );
  }

  const args = await inputArgs(state, input.refreshTask === true);
  args.push("--repo", repository);
  if (input.feedback !== undefined && input.feedback !== "") {
    args.push("--feedback", cleanText(input.feedback, "Feedback"));
  }
  return launch(config, args);
}

export interface ReplyInput {
  answer?: unknown;
  /** Start a fresh run carrying the answer. Off by default: a relaunch replays stages. */
  relaunch?: unknown;
  repo?: unknown;
}

export interface ReplyResult {
  recorded: true;
  /** Where the answer was written, so it is never "saved" into nothing. */
  answersPath: string;
  feedbackPath: string;
  /** True when an agent will actually read this answer; false when it only sits on disk. */
  delivered: boolean;
  delivery: string;
  replays: string[];
  launch: LaunchResult | null;
}

/**
 * Records an answer to an agent's question and, on request, sends it.
 *
 * The answer is always appended to `<run>/answers.jsonl` and mirrored to
 * `<run>/feedback.md`. That file only reaches an agent while a run is still executing
 * (the runner reads it when building each stage prompt); a run that stopped on
 * `needs_input` has already exited, so answering it for real means relaunching the CLI
 * with `--feedback`. `delivered` says which of the two happened, so the UI never
 * claims an answer landed when it did not.
 */
export async function replyToQuestion(
  config: Config,
  id: string,
  input: ReplyInput,
): Promise<ReplyResult> {
  if (id.startsWith("imports/")) {
    throw badRequest("Answers apply to pipeline runs, not task imports");
  }
  const answer = cleanText(input.answer, "Answer");
  if (answer.length > MAX_FEEDBACK_CHARS) {
    throw badRequest(`Answer is limited to ${MAX_FEEDBACK_CHARS} characters`);
  }
  const state = await readRunState(config, id);
  if (!state) throw notFound(`No run at ${id}`);

  const dir = runDirectory(config, id);
  const answersPath = join(dir, "answers.jsonl");
  const feedbackPath = join(dir, "feedback.md");
  const entry = {
    time: new Date().toISOString(),
    run: id,
    stage: state.active_stage ?? null,
    status: state.status ?? null,
    answer,
  };
  await Deno.writeTextFile(answersPath, `${JSON.stringify(entry)}\n`, { append: true });
  // The runner appends this file wholesale into the next stage prompt, so answers accumulate
  // rather than replace: overwriting would drop an earlier answer a live run has not read yet.
  await Deno.writeTextFile(feedbackPath, `## Answer ${entry.time}\n\n${answer}\n\n`, {
    append: true,
  });

  const live = state.status === "running";
  if (!input.relaunch) {
    return {
      recorded: true,
      answersPath,
      feedbackPath,
      delivered: live,
      delivery: live
        ? "Recorded. The running team picks this up when it builds the next stage prompt."
        : config.launcher
        ? "Recorded only. This run has already exited, so no agent will read it until you re-run the team with this answer."
        : "Recorded only. This run has already exited and no launcher is configured, so no agent will read it. Re-run the task with your runner and pass this answer along.",
      replays: replayedStages(state),
      launch: null,
    };
  }

  let launch: LaunchResult;
  try {
    launch = await retryRun(config, id, { repo: input.repo, feedback: answer });
  } catch (error) {
    // The answer is already on disk; say so, or the user will submit it a second time.
    if (error instanceof HttpError) {
      throw new HttpError(
        error.status,
        `Your answer was recorded, but the re-run could not start: ${error.message}`,
      );
    }
    throw error;
  }
  return {
    recorded: true,
    answersPath,
    feedbackPath,
    delivered: true,
    delivery: "Answer sent: a fresh run started with it appended to the brief.",
    replays: replayedStages(state),
    launch,
  };
}
