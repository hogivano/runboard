/**
 * Decides which actions the run detail pane offers. Kept free of the DOM so it can be
 * tested, and applied on every render so the result never depends on whether settings
 * loaded before or after the pane was first drawn.
 *
 * @param {{ canLaunch: boolean }} settings  what the server can do
 * @param {{ kind: string, status: string, retryable: boolean }} run
 * @param {{ channel: "resume" | "relaunch", replays: string[] } | undefined} question  the open
 *   question on this run, if any
 */
export function detailControls(settings, run, question) {
  const isImport = run.kind === "import";
  const canLaunch = Boolean(settings.canLaunch) && !isImport;
  return {
    /** Imports are task reads, not agent runs: there is nobody to answer. */
    showReply: !isImport,
    /** Re-run, "answer and re-run", the repository field and the re-read option. */
    showLaunch: canLaunch,
    canRetry: canLaunch && Boolean(run.retryable),
    /** A resumable run continues where it halted; anything else starts a fresh run. */
    sendLabel: question?.channel === "resume" ? "Answer and continue run" : "Answer and re-run team",
    warning: replyWarning(canLaunch, run, question),
  };
}

function replyWarning(canLaunch, run, question) {
  if (run.kind === "import") return "";
  if (run.status === "running") {
    return "This run is live; a recorded answer is picked up when it builds the next stage prompt.";
  }
  if (!canLaunch) {
    return "This run has stopped and no launcher is configured, so an answer is recorded here but not sent to an agent.";
  }
  if (question?.channel === "resume") {
    return `This run has stopped. Answering continues it in its own worktree, running ${
      question.replays.join(", ")
    } again with your answer.`;
  }
  if (question) {
    return question.replays.length
      ? `This run has stopped. Answering re-runs the team from the start, replaying: ${
        question.replays.join(", ")
      }.`
      : "This run has stopped. Answering starts a fresh run carrying your answer.";
  }
  return "This run is not waiting on a question. A recorded answer is only read if you re-run the team.";
}

/**
 * A cheap fingerprint of what the document list depends on. The list is reloaded only when
 * it changes — each reload runs `git status` in the worktree, so it must not run every poll.
 */
export function documentsKey(run) {
  return [
    run.activityAt ?? run.updatedAt,
    run.stages?.length ?? 0,
    (run.files ?? []).join("|"),
  ].join("::");
}
