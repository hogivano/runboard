/**
 * Open questions: runs waiting on a human. A runner may exit when a stage reports
 * `needs_input` or `blocked`, with no resume; an answer then reaches an agent only through
 * a fresh run started with `--feedback`.
 */
import { askingStage, replayedStages, type RunRecord, type RunStatus } from "./run.ts";

/** How an answer can currently reach the asking agent. */
export type AnswerChannel = "relaunch" | "next_stage";

export interface OpenQuestion {
  runId: string;
  label: string;
  status: string;
  /** Stage that stopped, and the agent that asked. */
  stage: string | null;
  role: string | null;
  /** The agent's own words. Not parsed for a question: the qualifiers matter. */
  detail: string;
  /** Set when the runner blocked on an error rather than an agent report. */
  reason: string | null;
  askedAt: string;
  /** `relaunch`: the run exited, only a fresh run carries the answer. */
  channel: AnswerChannel;
  /** Stages a re-run carrying the answer would replay. */
  replays: string[];
  answered: boolean;
}

export function toOpenQuestion(
  run: { id: string; label: string; status: RunStatus; activeStage: string | null; updatedAt: string },
  record: RunRecord,
  answered: boolean,
): OpenQuestion {
  const entry = askingStage(record);
  return {
    runId: run.id,
    label: run.label,
    status: run.status,
    stage: entry?.stage ?? run.activeStage,
    role: entry?.role ?? null,
    detail: entry?.report?.summary ?? "",
    reason: record.reason ?? null,
    askedAt: run.updatedAt,
    channel: "relaunch",
    replays: replayedStages(record),
    answered,
  };
}
