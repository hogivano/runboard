import { join } from "@std/path";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { InvalidInputError, NotFoundError } from "../../src/domain/errors.ts";
import { withFixtures } from "../support/fixtures.ts";

Deno.test("listRuns folds a consumed import into the run it produced", async () => {
  await using env = await withFixtures();
  const runs = await env.app.listRuns();
  const ids = runs.map((run) => run.id);

  assert(ids.includes("run-question"));
  assert(
    !ids.includes("imports/tracker-demo42-a1b2c3"),
    "consumed import must not appear as its own row",
  );
  const pipeline = runs.find((run) => run.id === "run-question")!;
  assertEquals(pipeline.importIds, ["imports/tracker-demo42-a1b2c3"]);
});

Deno.test("listRuns reports an abandoned import as stale, not running", async () => {
  await using env = await withFixtures();
  const orphan = (await env.app.listRuns()).find((run) => run.id.endsWith("dead00"))!;
  assertEquals(orphan.kind, "import");
  assertEquals(orphan.status, "stale");
});

Deno.test("listRuns exposes the run format statuses", async () => {
  await using env = await withFixtures();
  const byId = Object.fromEntries((await env.app.listRuns()).map((run) => [run.id, run]));
  assertEquals(byId["run-question"].status, "needs_input");
  assertEquals(byId["run-legacy"].status, "ready_for_manager_review");
  assertEquals(byId["run-question"].taskId, "demo42");
});

Deno.test("listRuns sorts by most recent activity", async () => {
  await using env = await withFixtures();
  const runs = await env.app.listRuns();
  const sorted = [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  assertEquals(runs.map((r) => r.id), sorted.map((r) => r.id));
});

Deno.test("getRun returns detail for a slash-bearing import id", async () => {
  await using env = await withFixtures();
  const detail = await env.app.getRun("imports/tracker-demo42-a1b2c3");
  assertEquals(detail.kind, "import");
  assertEquals(detail.status, "completed");
  assert(detail.files.includes("prompt.md"));
  assert(detail.events.length > 0, "import detail should list activity");
});

Deno.test("getRun skips torn and malformed JSONL lines", async () => {
  await using env = await withFixtures();
  const detail = await env.app.getRun("run-legacy");
  assertEquals(detail.events.length, 1);
  assertEquals(detail.events[0].message, "analyst started intake");
});

Deno.test("getRun carries the stage history used by the graph", async () => {
  await using env = await withFixtures();
  const detail = await env.app.getRun("run-question");
  assertEquals(detail.history[0].stage, "intake");
  assertEquals(detail.history[0].report?.status, "needs_input");
});

Deno.test("getRun rejects unknown runs and unsafe ids", async () => {
  await using env = await withFixtures();
  for (const [id, status] of [["run-missing", 404], ["../secrets", 400], ["a/b/c", 400]] as const) {
    await assertRejects(() => env.app.getRun(id), status === 404 ? NotFoundError : InvalidInputError);
  }
});

Deno.test("activityAt moves when an agent writes inside a stage folder", async () => {
  await using env = await withFixtures();
  const before = (await env.app.getRun("run-question")).activityAt;
  const later = new Date(Date.parse(before) + 60_000);
  const log = join(env.runsRoot, "run-question/01-intake-analyst/output.log");
  await Deno.writeTextFile(log, "agent output\n");
  await Deno.utime(log, later, later);
  const after = (await env.app.getRun("run-question")).activityAt;
  assertEquals(after, later.toISOString());
});
