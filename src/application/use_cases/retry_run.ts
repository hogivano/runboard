import { InvalidInputError, NotFoundError } from "../../domain/errors.ts";
import {
  assertNotLive,
  briefCandidates,
  optionalText,
  resolveRepository,
  runInputArgs,
} from "../../domain/rerun.ts";
import { isImportId } from "../../domain/run.ts";
import type { AppContext } from "../context.ts";
import type { LaunchResult } from "../ports.ts";
import { requireRunId } from "./run_summaries.ts";

export interface RetryRunInput {
  repo?: unknown;
  feedback?: unknown;
  /**
   * Re-read the task from its source instead of reusing the brief the first import produced.
   * Off by default: the re-read is a full agent call.
   */
  refreshTask?: unknown;
}

/** Starts a finished run again in a fresh worktree. */
export async function retryRun(
  context: AppContext,
  rawId: string,
  input: RetryRunInput,
): Promise<LaunchResult> {
  if (isImportId(rawId)) {
    throw new InvalidInputError("Imports cannot be retried; start the task again instead");
  }
  const id = requireRunId(rawId);
  const stored = await context.runs.readPipeline(id);
  if (!stored) throw new NotFoundError(`No run at ${id}`);
  // Without a runner nothing else about the re-run matters; say that first.
  await context.launcher.ensureReady();

  const { record } = stored;
  assertNotLive(record);
  const repository = resolveRepository(record, optionalText(input.repo, "Repository path"));

  const refreshTask = input.refreshTask === true;
  let existingBrief: string | null = null;
  if (!refreshTask) {
    for (const candidate of briefCandidates(record)) {
      if (await context.runs.briefExists(candidate)) {
        existingBrief = candidate;
        break;
      }
    }
  }

  const args = runInputArgs(record, refreshTask, existingBrief);
  args.push("--repo", repository);
  const feedback = optionalText(input.feedback, "Feedback");
  if (feedback) args.push("--feedback", feedback);
  return context.launcher.start(args);
}
