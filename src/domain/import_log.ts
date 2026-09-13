/**
 * Imports: a separate agent run that reads a task from its source before a pipeline
 * starts. Its state is derived from the agent's output stream.
 */
import type { RunEvent, RunStatus } from "./run.ts";

/** How many activity entries a detail view shows. */
export const MAX_EVENTS = 60;

type StreamLine = Record<string, unknown>;

/**
 * A finished import ends with a `result` line. One without it that has stopped growing
 * is dead, not running, so it is `stale` instead of inflating the active count forever.
 */
export function importStatus(
  lines: readonly StreamLine[],
  lastWrite: Date | null,
  now: Date,
  staleAfterMs: number,
): RunStatus {
  const result = lines.findLast((line) => line.type === "result");
  if (result) return result.is_error ? "failed" : "completed";
  if (lastWrite && now.getTime() - lastWrite.getTime() > staleAfterMs) return "stale";
  return "running";
}

/** Turns agent stream lines into the short activity entries the detail view lists. */
export function importEvents(
  lines: readonly StreamLine[],
  fallbackTime: string,
  label: string,
): RunEvent[] {
  const events: RunEvent[] = [];
  for (const line of lines) {
    const time = typeof line.timestamp === "string" ? line.timestamp : fallbackTime;
    if (line.type === "result") {
      events.push({
        time,
        message: line.is_error ? `${label} failed` : `${label} completed`,
        status: line.is_error ? "failed" : "completed",
      });
      continue;
    }
    const message = line.message as { content?: { type?: string; name?: string }[] } | undefined;
    const tools = (message?.content ?? [])
      .filter((block) => block.type === "tool_use")
      .map((block) => block.name ?? "tool")
      .join(", ");
    if (tools) events.push({ time, message: tools });
  }
  return events.slice(-MAX_EVENTS);
}

/** "Jira import", "task import" — whatever the task source is called. */
export function importLabel(sourceLabel: string): string {
  return `${sourceLabel} import`;
}
