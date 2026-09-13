/**
 * The questions half of the loop: which runs are waiting on an answer, and what the
 * asking agent actually said.
 *
 * A runner may stop when a stage reports `needs_input` or `blocked`
 * and exit, with no resume. Then an answer reaches an agent only by relaunching the
 * CLI with `--feedback`, which the runner adds to the brief. Writing `<run>/feedback.md` alone does nothing
 * for a stopped run: the runner reads it while building the next stage prompt,
 * inside the loop that has already exited.
 */
import { join } from "@std/path";
import type { Config } from "./config.ts";
import { listRuns } from "./runs.ts";
import type { HistoryEntry, RunState } from "./types.ts";

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
  /**
   * `relaunch` means the run has exited and only a fresh CLI run carries the answer;
   * `next_stage` means the run is live and will pick up `feedback.md`.
   */
  channel: AnswerChannel;
  /** Stages that would run again if the answer is sent with a relaunch. */
  replays: string[];
  answered: boolean;
}

const WAITING = new Set(["needs_input", "blocked"]);

/** The last history entry whose report stopped the run. */
function askingStage(state: RunState): HistoryEntry | null {
  const history = state.history ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    const status = history[i].report?.status;
    if (status && WAITING.has(status)) return history[i];
  }
  return history.at(-1) ?? null;
}

async function hasAnswer(runDir: string): Promise<boolean> {
  try {
    return (await Deno.stat(join(runDir, "answers.jsonl"))).isFile;
  } catch {
    return false;
  }
}

/** Every run waiting on a human answer, most recent first. */
export async function listOpenQuestions(config: Config): Promise<OpenQuestion[]> {
  const questions: OpenQuestion[] = [];

  for (const run of await listRuns(config)) {
    if (run.kind !== "pipeline" || !WAITING.has(run.status)) continue;
    const runDir = join(config.runsRoot, run.id);
    const state = JSON.parse(
      await Deno.readTextFile(join(runDir, "state.json")).catch(() => "null"),
    ) as RunState | null;
    if (!state) continue;

    const entry = askingStage(state);
    questions.push({
      runId: run.id,
      label: run.label,
      status: run.status,
      stage: entry?.stage ?? run.activeStage,
      role: entry?.role ?? null,
      detail: entry?.report?.summary ?? "",
      reason: state.reason ?? null,
      askedAt: run.updatedAt,
      // The run has exited, so only a relaunch carries the answer to an agent.
      channel: "relaunch",
      replays: replayedStages(state),
      answered: await hasAnswer(runDir),
    });
  }
  return questions;
}

/**
 * Stages a relaunch would run again. A relaunch starts a brand new run, so this is
 * every stage already completed plus the one that asked — shown so the cost of
 * answering is visible before the click, not after.
 */
export function replayedStages(state: RunState): string[] {
  const done = (state.history ?? []).map((entry) => entry.stage);
  const asking = state.active_stage;
  return asking && !done.includes(asking) ? [...done, asking] : done;
}
