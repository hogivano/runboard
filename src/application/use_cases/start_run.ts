import { optionalText, requireText } from "../../domain/rerun.ts";
import type { AppContext } from "../context.ts";
import type { LaunchResult } from "../ports.ts";

export interface StartRunInput {
  task?: unknown;
  repo?: unknown;
}

/** Starts a fresh run from a task URL or id. */
export function startRun(context: AppContext, input: StartRunInput): Promise<LaunchResult> {
  const args = [requireText(input.task, "Task URL or ID")];
  const repository = optionalText(input.repo, "Repository path");
  if (repository) args.push("--repo", repository);
  return context.launcher.start(args);
}
