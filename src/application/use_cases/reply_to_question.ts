import { DomainError, InvalidInputError, NotFoundError } from "../../domain/errors.ts";
import { recordedAnswerDelivery, requireAnswer, SENT_WITH_RERUN } from "../../domain/rerun.ts";
import { isImportId, replayedStages } from "../../domain/run.ts";
import type { AppContext } from "../context.ts";
import type { LaunchResult } from "../ports.ts";
import type { ReplyResult } from "../views.ts";
import { retryRun } from "./retry_run.ts";
import { requireRunId } from "./run_summaries.ts";

export interface ReplyInput {
  answer?: unknown;
  /** Start a fresh run carrying the answer. Off by default: a re-run replays stages. */
  relaunch?: unknown;
  repo?: unknown;
}

/**
 * Records an answer to an agent's question and, on request, sends it with a fresh run.
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
  const recorded = { recorded: true as const, answersPath, feedbackPath, replays: replayedStages(record) };

  if (!input.relaunch) {
    return { ...recorded, ...recordedAnswerDelivery(record, context.launcher.configured), launch: null };
  }

  let launch: LaunchResult;
  try {
    launch = await retryRun(context, id, { repo: input.repo, feedback: answer });
  } catch (error) {
    // The answer is already stored; say so, or the user will submit it a second time.
    if (error instanceof DomainError) {
      const Kind = error.constructor as new (message: string) => DomainError;
      throw new Kind(`Your answer was recorded, but the re-run could not start: ${error.message}`);
    }
    throw error;
  }
  return { ...recorded, delivered: true, delivery: SENT_WITH_RERUN, launch };
}
