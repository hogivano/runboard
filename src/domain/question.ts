/**
 * Open questions: runs waiting on a human. A runner exits when a stage reports `needs_input`
 * or `blocked`. An answer then reaches an agent by resuming that run, when the runner
 * supports it, or through a fresh run started with `--feedback`.
 */
import { rerunPlan } from "./rerun.ts";
import { askingStage, type RunRecord, type RunStatus } from "./run.ts";

/**
 * How an answer can currently reach the asking agent. `resume`: the halted run continues
 * from the stage that asked. `relaunch`: only a fresh run carries the answer.
 */
export type AnswerChannel = "resume" | "relaunch";
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
  channel: AnswerChannel;
  /** Stages that run again when the answer is sent. */
  replays: string[];
  answered: boolean;
}

export function toOpenQuestion(
  run: { id: string; label: string; status: RunStatus; activeStage: string | null; updatedAt: string },
  record: RunRecord,
  answered: boolean,
  resumeSupported: boolean,
): OpenQuestion {
  const entry = askingStage(record);
  const plan = rerunPlan(record, resumeSupported);
  return {
    runId: run.id,
    label: run.label,
    status: run.status,
    stage: entry?.stage ?? run.activeStage,
    role: entry?.role ?? null,
    detail: entry?.report?.summary ?? "",
    reason: record.reason ?? null,
    askedAt: run.updatedAt,
    channel: plan.mode === "resume" ? "resume" : "relaunch",
    replays: plan.stages,
    answered,
  };
}
