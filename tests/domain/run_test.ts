import { assertEquals } from "@std/assert";
import { importStatus } from "../../src/domain/import_log.ts";
import {
  askingStage,
  importIdForPath,
  isValidRunId,
  parseRunStatus,
  replayedStages,
  taskIdFromImportId,
} from "../../src/domain/run.ts";

Deno.test("run ids are one or two safe path segments", () => {
  assertEquals(["run-1", "imports/jira-X-y", "a_b"].map(isValidRunId), [true, true, true]);
  assertEquals(["..", "../x", "a/b/c", "/abs", "a b", ""].map(isValidRunId), [
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
});

Deno.test("statuses outside the format's vocabulary are unknown", () => {
  assertEquals(parseRunStatus("needs_input"), "needs_input");
  assertEquals(parseRunStatus("completed"), "unknown");
  assertEquals(parseRunStatus(undefined), "unknown");
});

Deno.test("import folder names carry the task id", () => {
  assertEquals(taskIdFromImportId("imports/jira-PROJ42-x1y2"), "PROJ42");
  assertEquals(taskIdFromImportId("imports/plainname"), null);
  assertEquals(importIdForPath("/runs/imports/jira-PROJ42-x1y2/"), "imports/jira-PROJ42-x1y2");
});

Deno.test("the asking stage is the last one that stopped, and replays include it", () => {
  const record = {
    active_stage: "review",
    history: [
      { stage: "intake", report: { status: "pass" as const } },
      { stage: "plan", report: { status: "needs_input" as const } },
      { stage: "build", report: { status: "pass" as const } },
    ],
  };
  assertEquals(askingStage(record)?.stage, "plan");
  assertEquals(replayedStages(record), ["intake", "plan", "build", "review"]);
});

Deno.test("an import is stale only when it has no result and has gone quiet", () => {
  const now = new Date("2026-01-10T12:00:00Z");
  const quietFor = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const tenMinutes = 10 * 60_000;
  assertEquals(importStatus([], quietFor(11), now, tenMinutes), "stale");
  assertEquals(importStatus([], quietFor(9), now, tenMinutes), "running");
  assertEquals(importStatus([{ type: "result" }], quietFor(600), now, tenMinutes), "completed");
  assertEquals(importStatus([], null, now, tenMinutes), "running");
});
