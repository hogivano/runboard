import { NotFoundError } from "../../domain/errors.ts";
import { importEvents, importLabel, MAX_EVENTS } from "../../domain/import_log.ts";
import { importIdForPath, isImportId, toRunEvents } from "../../domain/run.ts";
import { buildStageGraph } from "../../domain/stage.ts";
import type { AppContext } from "../context.ts";
import type { RunDetail } from "../views.ts";
import { importSummary, pipelineSummary, requireRunId } from "./run_summaries.ts";

/** Loads one run's detail. Throws `NotFoundError` when it does not exist. */
export async function getRun(context: AppContext, rawId: string): Promise<RunDetail> {
  const id = requireRunId(rawId);
  const { runs, settings } = context;

  if (isImportId(id)) {
    const stored = await runs.readImport(id, true);
    if (!stored) throw new NotFoundError(`No import at ${id}`);
    const summary = importSummary(stored, context);
    return {
      ...summary,
      history: [],
      stages: [],
      activityAt: summary.updatedAt,
      events: importEvents(stored.lines, summary.updatedAt, importLabel(settings.sourceLabel)),
      files: await runs.listRunFiles(id),
      reason: null,
    };
  }

  const stored = await runs.readPipeline(id);
  if (!stored) throw new NotFoundError(`No run at ${id}`);
  const { record } = stored;
  const summary = pipelineSummary(stored);
  if (record.input_source?.path) summary.importIds.push(importIdForPath(record.input_source.path));
  const activity = await runs.latestActivity(id);

  return {
    ...summary,
    history: record.history ?? [],
    stages: buildStageGraph(record, settings.stages),
    activityAt: activity ? activity.toISOString() : summary.updatedAt,
    events: toRunEvents(await runs.readEventLines(id), MAX_EVENTS),
    files: await runs.listRunFiles(id),
    reason: record.reason ?? null,
  };
}
