import { assertEquals } from "@std/assert";
import { listRuns } from "../../src/application/use_cases/list_runs.ts";
import { fakeContext, InMemoryRunStore, NOW } from "../support/fakes.ts";

const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

Deno.test("an import a run was created from is folded into that run", async () => {
  const runs = new InMemoryRunStore()
    .addPipeline("run-a", { status: "running", input_source: { path: "/runs/imports/jira-X1-aa" } })
    .addImport("imports/jira-X1-aa", [{ type: "result" }], NOW);

  const [only, ...rest] = await listRuns(fakeContext({ runs }));
  assertEquals(rest, []);
  assertEquals(only.id, "run-a");
  assertEquals(only.importIds, ["imports/jira-X1-aa"]);
});

Deno.test("import status comes from its stream and the clock", async () => {
  const runs = new InMemoryRunStore()
    .addImport("imports/jira-A1-done", [{ type: "result", is_error: false }], minutesAgo(60))
    .addImport("imports/jira-A2-fail", [{ type: "result", is_error: true }], minutesAgo(60))
    .addImport("imports/jira-A3-live", [{ type: "assistant" }], minutesAgo(2))
    .addImport("imports/jira-A4-dead", [{ type: "assistant" }], minutesAgo(30));

  const byId = Object.fromEntries((await listRuns(fakeContext({ runs }))).map((r) => [r.id, r.status]));
  assertEquals(byId, {
    "imports/jira-A1-done": "completed",
    "imports/jira-A2-fail": "failed",
    "imports/jira-A3-live": "running",
    "imports/jira-A4-dead": "stale",
  });
});

Deno.test("runs are listed newest activity first, with labels from their record", async () => {
  const runs = new InMemoryRunStore()
    .addPipeline(
      "run-old",
      { status: "ready_for_manager_review", brief_path: "/b/old-brief.md" },
      minutesAgo(90),
    )
    .addPipeline("run-new", { status: "needs_input", input_source: { task_id: "PROJ-7" } }, minutesAgo(1))
    .addPipeline("run-odd", { status: "exploded" }, minutesAgo(30));

  const listed = await listRuns(fakeContext({ runs }));
  assertEquals(listed.map((r) => [r.id, r.label, r.status, r.retryable]), [
    ["run-new", "Task PROJ-7", "needs_input", true],
    ["run-odd", "run-odd", "unknown", true],
    ["run-old", "old-brief.md", "ready_for_manager_review", true],
  ]);
});
