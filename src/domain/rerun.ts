/**
 * Rules for starting a run again and for answering an agent. Which files exist is decided
 * by the caller through a port and passed in, so these stay pure.
 */
import { ConflictError, InvalidInputError } from "./errors.ts";
import { isWaitingStatus, replayedStages, type RunRecord } from "./run.ts";

export const MAX_ANSWER_CHARS = 20_000;

/** A required free-text field: trimmed, non-empty, no NUL bytes. */
export function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new InvalidInputError(`${field} is required`);
  const text = value.trim();
  if (text.includes("\0")) throw new InvalidInputError(`${field} contains invalid characters`);
  return text;
}

/** An optional free-text field: absent or empty means "not given". */
export function optionalText(value: unknown, field: string): string | null {
  return value === undefined || value === "" ? null : requireText(value, field);
}

export function requireAnswer(value: unknown): string {
  const answer = requireText(value, "Answer");
  if (answer.length > MAX_ANSWER_CHARS) {
    throw new InvalidInputError(`Answer is limited to ${MAX_ANSWER_CHARS} characters`);
  }
  return answer;
}

export function assertNotLive(record: RunRecord): void {
  if (record.status === "running") {
    throw new ConflictError("Run is still active; wait for it to finish or block before retrying");
  }
}

/**
 * The repository a re-run works in: the one the user typed, else the one the run recorded.
 * Older runs did not record one, so the user has to supply it.
 */
export function resolveRepository(record: RunRecord, requested: string | null): string {
  const repository = requested ?? record.repository;
  if (!repository) {
    throw new InvalidInputError(
      "This run did not record its repository. Enter the repository path in the retry form.",
    );
  }
  return repository;
}

/**
 * Briefs a re-run could reuse, most specific first. The runner records `brief_path`;
 * older runs did not, but a completed import leaves `brief.md` in the folder
 * `input_source.path` names. Reusing one skips re-reading the task, a full agent call.
 */
export function briefCandidates(record: RunRecord): string[] {
  const candidates: string[] = [];
  if (record.brief_path) candidates.push(record.brief_path);
  if (record.input_source?.path) {
    candidates.push(`${record.input_source.path.replace(/\/+$/, "")}/brief.md`);
  }
  return candidates;
}

/**
 * The runner arguments naming what to run: a brief that exists, else the task id to read
 * again. Passing a brief that is gone would start a run that fails at once while the user
 * is told it was sent, so a missing brief with nothing to fall back to is an error.
 *
 * @param existingBrief the first of `briefCandidates` that exists, or null; ignored when
 *   the user asked to re-read the task.
 */
export function runInputArgs(
  record: RunRecord,
  refreshTask: boolean,
  existingBrief: string | null,
): string[] {
  if (!refreshTask && existingBrief) return ["--brief", existingBrief];
  if (record.input_source?.task_id) return [record.input_source.task_id];
  if (record.brief_path) {
    throw new InvalidInputError(
      `The brief this run used is missing (${record.brief_path}) and the run has no task id to re-read`,
    );
  }
  throw new InvalidInputError("Run has no reusable task or brief to retry from");
}

/**
 * Whether a runner that supports `--resume` can continue this run where it halted: the run
 * stopped on a question or a block, names the stage that stopped it, and either recorded
 * the stages still queued after it or stopped on its very first stage, where nothing
 * queued could have been lost.
 */
export function canResume(record: RunRecord): boolean {
  const halted = record.active_stage;
  if (!halted || !isWaitingStatus(record.status)) return false;
  if (Array.isArray(record.stage_queue)) return true;
  const history = record.history ?? [];
  return history.length === 0 || (history.length === 1 && history[0].stage === halted);
}

/** How sending an answer would reach the agents, and which stages run again. */
export type RerunPlan =
  | { mode: "resume"; stages: string[] }
  | { mode: "replay"; stages: string[] };

/**
 * Resume when the runner can and the run allows it: only the halted stage runs again, in
 * the same worktree. Otherwise a fresh run replays every stage up to the one that asked.
 */
export function rerunPlan(record: RunRecord, resumeSupported: boolean): RerunPlan {
  if (resumeSupported && canResume(record)) {
    return { mode: "resume", stages: [record.active_stage!] };
  }
  return { mode: "replay", stages: replayedStages(record) };
}

/**
 * Runner arguments that continue a halted run. The answer is not passed with `--feedback`:
 * runboard has already appended it to the run's `feedback.md`, which every stage rereads,
 * and passing it again would put it in the prompt twice.
 */
export function resumeArgs(runDirectory: string): string[] {
  return ["--resume", runDirectory];
}

/**
 * What recording an answer without re-running achieves. The runner reads `feedback.md` only
 * while it is executing, so for a stopped run the honest answer is "stored, not delivered".
 */
export function recordedAnswerDelivery(
  record: RunRecord,
  canLaunch: boolean,
  resumeSupported = false,
): { delivered: boolean; delivery: string } {
  if (record.status === "running") {
    return {
      delivered: true,
      delivery: "Recorded. The running team picks this up when it builds the next stage prompt.",
    };
  }
  return {
    delivered: false,
    delivery: canLaunch
      ? rerunPlan(record, resumeSupported).mode === "resume"
        ? "Recorded only. This run has already exited, so no agent will read it until you continue the run."
        : "Recorded only. This run has already exited, so no agent will read it until you re-run the team with this answer."
      : "Recorded only. This run has already exited and no launcher is configured, so no agent will read it. Re-run the task with your runner and pass this answer along.",
  };
}

export const SENT_WITH_RERUN = "Answer sent: a fresh run started with it appended to the brief.";

export function sentWithResume(stage: string): string {
  return `Answer sent: the run continues from ${stage} in its own worktree.`;
}
