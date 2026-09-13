import { assert, assertEquals, assertRejects } from "@std/assert";
import { getRun, listRuns } from "../src/runs.ts";
import { HttpError } from "../src/errors.ts";
import { withFixtures } from "./helpers.ts";

Deno.test("listRuns folds a consumed import into the run it produced", async () => {
  await using env = await withFixtures();
  const runs = await listRuns(env.config);
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
  const orphan = (await listRuns(env.config)).find((run) => run.id.endsWith("dead00"))!;
  assertEquals(orphan.kind, "import");
  assertEquals(orphan.status, "stale");
});

Deno.test("listRuns exposes the run format statuses", async () => {
  await using env = await withFixtures();
  const byId = Object.fromEntries((await listRuns(env.config)).map((run) => [run.id, run]));
  assertEquals(byId["run-question"].status, "needs_input");
  assertEquals(byId["run-legacy"].status, "ready_for_manager_review");
  assertEquals(byId["run-question"].taskId, "demo42");
});

Deno.test("listRuns sorts by most recent activity", async () => {
  await using env = await withFixtures();
  const runs = await listRuns(env.config);
  const sorted = [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  assertEquals(runs.map((r) => r.id), sorted.map((r) => r.id));
});

Deno.test("getRun returns detail for a slash-bearing import id", async () => {
  await using env = await withFixtures();
  const detail = await getRun(env.config, "imports/tracker-demo42-a1b2c3");
  assertEquals(detail.kind, "import");
  assertEquals(detail.status, "completed");
  assert(detail.files.includes("prompt.md"));
  assert(detail.events.length > 0, "import detail should list activity");
});

Deno.test("getRun skips torn and malformed JSONL lines", async () => {
  await using env = await withFixtures();
  const detail = await getRun(env.config, "run-legacy");
  assertEquals(detail.events.length, 1);
  assertEquals(detail.events[0].message, "analyst started intake");
});

Deno.test("getRun carries the stage history used by the graph", async () => {
  await using env = await withFixtures();
  const detail = await getRun(env.config, "run-question");
  assertEquals(detail.history[0].stage, "intake");
  assertEquals(detail.history[0].report?.status, "needs_input");
});

Deno.test("getRun rejects unknown runs and unsafe ids", async () => {
  await using env = await withFixtures();
  for (const [id, status] of [["run-missing", 404], ["../secrets", 400], ["a/b/c", 400]] as const) {
    const error = await assertRejects(() => getRun(env.config, id), HttpError);
    assertEquals(error.status, status);
  }
});
