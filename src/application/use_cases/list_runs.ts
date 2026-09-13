import { importIdForPath } from "../../domain/run.ts";
import type { AppContext } from "../context.ts";
import type { RunSummary } from "../views.ts";
import { byRecentActivity, importSummary, pipelineSummary } from "./run_summaries.ts";

/**
 * Lists every run, newest activity first. An import that a pipeline run was created from
 * is folded into that run rather than listed twice.
 */
export async function listRuns(context: AppContext): Promise<RunSummary[]> {
  const pipelines: RunSummary[] = [];
  const consumedImports = new Map<string, RunSummary>();

  for (const stored of await context.runs.listPipelines()) {
    const summary = pipelineSummary(stored);
    pipelines.push(summary);
    const importPath = stored.record.input_source?.path;
    if (importPath) consumedImports.set(importIdForPath(importPath), summary);
  }

  const orphans: RunSummary[] = [];
  for (const id of await context.runs.listImportIds()) {
    const parent = consumedImports.get(id);
    if (parent) {
      parent.importIds.push(id);
      continue;
    }
    const stored = await context.runs.readImport(id, false);
    if (stored) orphans.push(importSummary(stored, context));
  }

  return [...pipelines, ...orphans].sort(byRecentActivity);
}
