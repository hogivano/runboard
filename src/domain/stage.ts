/** Stages: how a run's pipeline is drawn, and how stage folders are named. */
import type { HistoryEntry, RunRecord, StageStatus } from "./run.ts";

/** A stage the pipeline is expected to run, in order, with an optional display label. */
export interface StageSpec {
  id: string;
  label?: string;
}

/** One node of the stage graph. */
export interface StageView {
  id: string;
  label: string;
  role: string | null;
  status: StageStatus;
  diffStat: string | null;
  artifacts: string[];
}

/**
 * The stages to draw for a run. A run describes its own pipeline: every stage in its
 * history is shown, labelled with the role that ran it. Configured stages add ordering,
 * friendlier labels, and the stages that have not started yet.
 */
export function buildStageGraph(record: RunRecord, specs: readonly StageSpec[]): StageView[] {
  const history = record.history ?? [];
  // A stage can run more than once (fix rounds); the latest entry is its current state.
  const latest = new Map<string, HistoryEntry>();
  for (const entry of history) latest.set(entry.stage, entry);

  const order: string[] = [];
  const add = (id: string | undefined) => {
    if (id && !order.includes(id)) order.push(id);
  };
  for (const spec of specs) add(spec.id);
  for (const entry of history) add(entry.stage);
  add(record.active_stage);

  const labels = new Map(specs.map((spec) => [spec.id, spec.label]));
  return order.map((id) => {
    const entry = latest.get(id);
    const role = entry?.role ?? null;
    return {
      id,
      label: labels.get(id) ?? (role ? `${role} · ${id}` : id),
      role,
      status: entry?.report?.status ?? (record.active_stage === id ? "active" : "pending"),
      diffStat: entry?.diff_stat ?? null,
      artifacts: entry?.report?.artifacts ?? [],
    };
  });
}

/** Stage folders are named `NN-<stage>-<role>`, e.g. `01-intake-analyst`. */
const STAGE_FOLDER = /^(\d+)-(.+)-([a-z]+)$/;

export function parseStageFolder(name: string): { stage: string; role: string } | null {
  const match = STAGE_FOLDER.exec(name);
  return match ? { stage: match[2], role: match[3] } : null;
}

export function isStageFolder(name: string): boolean {
  return STAGE_FOLDER.test(name);
}
