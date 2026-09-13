import { assertEquals, assertRejects } from "@std/assert";
import { retryRun } from "../../src/application/use_cases/retry_run.ts";
import {
  ConflictError,
  InvalidInputError,
  LauncherUnavailableError,
  NotFoundError,
} from "../../src/domain/errors.ts";
import { fakeContext, FakeLauncher, InMemoryRunStore } from "../support/fakes.ts";

const stopped = {
  status: "needs_input",
  repository: "/repo",
  brief_path: "/briefs/recorded.md",
  input_source: { task_id: "PROJ-7", path: "/runs/imports/jira-PROJ7-aa" },
};

Deno.test("a re-run reuses the recorded brief when it still exists", async () => {
  const runs = new InMemoryRunStore().addPipeline("run-a", stopped);
  runs.briefs.add("/briefs/recorded.md");
  const context = fakeContext({ runs });

  await retryRun(context, "run-a", { feedback: "use postgres" });
  assertEquals(context.launcher.started, [[
    "--brief",
    "/briefs/recorded.md",
    "--repo",
    "/repo",
    "--feedback",
    "use postgres",
  ]]);
});

Deno.test("without the recorded brief, the import's brief.md is reused next", async () => {
  const runs = new InMemoryRunStore().addPipeline("run-a", stopped);
  runs.briefs.add("/runs/imports/jira-PROJ7-aa/brief.md");
  const context = fakeContext({ runs });

  await retryRun(context, "run-a", {});
  assertEquals(context.launcher.started[0].slice(0, 2), ["--brief", "/runs/imports/jira-PROJ7-aa/brief.md"]);
});

Deno.test("with no brief on disk it re-reads the task, and refreshTask forces that", async () => {
  const runs = new InMemoryRunStore().addPipeline("run-a", stopped);
  const context = fakeContext({ runs });
  await retryRun(context, "run-a", {});

  runs.briefs.add("/briefs/recorded.md");
  await retryRun(context, "run-a", { refreshTask: true, repo: "/other" });

  assertEquals(context.launcher.started, [["PROJ-7", "--repo", "/repo"], ["PROJ-7", "--repo", "/other"]]);
});

Deno.test("a missing brief with no task id is refused rather than launched", async () => {
  const runs = new InMemoryRunStore().addPipeline("run-a", { ...stopped, input_source: undefined });
  const context = fakeContext({ runs });
  await assertRejects(
    () => retryRun(context, "run-a", {}),
    InvalidInputError,
    "brief this run used is missing",
  );
  assertEquals(context.launcher.started, []);
});

Deno.test("refusals, in the order a user needs to hear them", async () => {
  const runs = new InMemoryRunStore()
    .addPipeline("run-live", { ...stopped, status: "running" })
    .addPipeline("run-norepo", { ...stopped, repository: undefined });

  await assertRejects(() => retryRun(fakeContext({ runs }), "imports/jira-x-y", {}), InvalidInputError);
  await assertRejects(() => retryRun(fakeContext({ runs }), "run-missing", {}), NotFoundError);
  // No launcher outranks everything about the run itself.
  await assertRejects(
    () => retryRun(fakeContext({ runs, launcher: new FakeLauncher(false) }), "run-live", {}),
    LauncherUnavailableError,
  );
  await assertRejects(() => retryRun(fakeContext({ runs }), "run-live", {}), ConflictError);
  await assertRejects(
    () => retryRun(fakeContext({ runs }), "run-norepo", {}),
    InvalidInputError,
    "repository",
  );
});
