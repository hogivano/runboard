import { DomainError, InvalidInputError, NotFoundError } from "../../domain/errors.ts";
import {
  recordedAnswerDelivery,
  requireAnswer,
  rerunPlan,
  resumeArgs,
  SENT_WITH_RERUN,
  sentWithResume,
} from "../../domain/rerun.ts";
import { isImportId } from "../../domain/run.ts";
import type { AppContext } from "../context.ts";
import type { LaunchResult } from "../ports.ts";
import type { ReplyResult } from "../views.ts";
import { retryRun } from "./retry_run.ts";
import { requireRunId } from "./run_summaries.ts";

export interface ReplyInput {
  answer?: unknown;
  /**
   * Send the answer to the agents: resume the halted run when the runner supports it, else
   * start a fresh run carrying it. Off by default: either one runs stages again.
   */
  relaunch?: unknown;
  repo?: unknown;
}

/**
 * Records an answer to an agent's question and, on request, sends it: by resuming the run
 * where it halted, or with a fresh run when the run or the runner cannot resume.
 * `delivered` says whether an agent will actually read it, so the UI never claims an answer
 * landed when it only sits on disk.
 */
export async function replyToQuestion(
  context: AppContext,
  rawId: string,
  input: ReplyInput,
): Promise<ReplyResult> {
  if (isImportId(rawId)) {
    throw new InvalidInputError("Answers apply to pipeline runs, not task imports");
  }
  const answer = requireAnswer(input.answer);
  const id = requireRunId(rawId);
  const stored = await context.runs.readPipeline(id);
  if (!stored) throw new NotFoundError(`No run at ${id}`);
  const { record } = stored;

  const { answersPath, feedbackPath } = await context.runs.appendAnswer(id, {
    time: context.now().toISOString(),
    run: id,
    stage: record.active_stage ?? null,
    status: record.status ?? null,
    answer,
  });
  const plan = rerunPlan(record, context.settings.resume);
  const recorded = { recorded: true as const, answersPath, feedbackPath, replays: plan.stages };

  if (!input.relaunch) {
    return {
      ...recorded,
      ...recordedAnswerDelivery(record, context.launcher.configured, context.settings.resume),
      launch: null,
    };
  }

  let launch: LaunchResult;
  try {
    if (plan.mode === "resume") {
      // A resumable run is halted, never live; its worktree and brief come from its state.
      launch = await context.launcher.start(resumeArgs(context.runs.runDirectory(id)));
    } else {
      launch = await retryRun(context, id, { repo: input.repo, feedback: answer });
    }
  } catch (error) {
    // The answer is already stored; say so, or the user will submit it a second time.
    if (error instanceof DomainError) {
      const Kind = error.constructor as new (message: string) => DomainError;
      const action = plan.mode === "resume" ? "the run could not continue" : "the re-run could not start";
      throw new Kind(`Your answer was recorded, but ${action}: ${error.message}`);
    }
    throw error;
  }
  const delivery = plan.mode === "resume" ? sentWithResume(plan.stages[0]) : SENT_WITH_RERUN;
  return { ...recorded, delivered: true, delivery, launch };
}
