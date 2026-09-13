import { assert, assertEquals, assertRejects } from "@std/assert";
import { replyToQuestion } from "../../src/application/use_cases/reply_to_question.ts";
import { InvalidInputError, LauncherUnavailableError, LaunchFailedError } from "../../src/domain/errors.ts";
import { fakeContext, FakeLauncher, InMemoryRunStore, NOW } from "../support/fakes.ts";

const asking = {
  status: "needs_input",
  active_stage: "plan",
  repository: "/repo",
  input_source: { task_id: "PROJ-7" },
  history: [{ stage: "intake", role: "analyst", report: { status: "pass" as const } }],
};

Deno.test("an answer to a stopped run is recorded, timestamped and reported as not delivered", async () => {
  const runs = new InMemoryRunStore().addPipeline("run-a", asking);
  const context = fakeContext({ runs });

  const result = await replyToQuestion(context, "run-a", { answer: "  use postgres  " });
  assertEquals(result.delivered, false);
  assertEquals(result.replays, ["intake", "plan"]);
  assertEquals(runs.answers.get("run-a"), [{
    time: NOW.toISOString(),
    run: "run-a",
    stage: "plan",
    status: "needs_input",
    answer: "use postgres",
  }]);
  assertEquals(context.launcher.started, []);
});

Deno.test("an answer to a live run will be read by its next stage", async () => {
  const runs = new InMemoryRunStore().addPipeline("run-a", { ...asking, status: "running" });
  const result = await replyToQuestion(fakeContext({ runs }), "run-a", { answer: "ok" });
  assertEquals(result.delivered, true);
});

Deno.test("without a launcher the delivery message does not promise a re-run", async () => {
  const runs = new InMemoryRunStore().addPipeline("run-a", asking);
  const result = await replyToQuestion(
    fakeContext({ runs, launcher: new FakeLauncher(false) }),
    "run-a",
    { answer: "ok" },
  );
  assert(result.delivery.includes("no launcher is configured"));
});

Deno.test("relaunch sends the answer as feedback with a fresh run", async () => {
  const runs = new InMemoryRunStore().addPipeline("run-a", asking);
  const context = fakeContext({ runs });
  const result = await replyToQuestion(context, "run-a", { answer: "use postgres", relaunch: true });
  assertEquals(result.delivered, true);
  assertEquals(context.launcher.started, [["PROJ-7", "--repo", "/repo", "--feedback", "use postgres"]]);
});

Deno.test("a failed relaunch keeps its error kind and says the answer was still recorded", async () => {
  const runs = new InMemoryRunStore().addPipeline("run-a", asking);
  const context = fakeContext({ runs, launcher: new FakeLauncher(true, "Launcher not found") });
  await assertRejects(
    () => replyToQuestion(context, "run-a", { answer: "ok", relaunch: true }),
    LauncherUnavailableError,
    "Your answer was recorded, but the re-run could not start: Launcher not found",
  );
  assertEquals(runs.answers.get("run-a")?.length, 1);
});

Deno.test("empty answers and imports are refused before anything is stored", async () => {
  const runs = new InMemoryRunStore().addPipeline("run-a", asking);
  const context = fakeContext({ runs });
  await assertRejects(() => replyToQuestion(context, "run-a", { answer: "   " }), InvalidInputError);
  await assertRejects(
    () => replyToQuestion(context, "imports/jira-x-y", { answer: "ok" }),
    InvalidInputError,
  );
  assertEquals(runs.answers.size, 0);
});

const resumable = { ...asking, stage_queue: ["build", "review"] };

Deno.test("with a resuming runner, sending an answer continues the halted run in place", async () => {
  const runs = new InMemoryRunStore().addPipeline("run-a", resumable);
  const context = fakeContext({ runs, settings: { resume: true } });
  const result = await replyToQuestion(context, "run-a", {
    answer: "use postgres",
    relaunch: true,
    repo: "/elsewhere",
  });
  assertEquals(context.launcher.started, [["--resume", "/runs/run-a"]]);
  assertEquals(result.replays, ["plan"]);
  assertEquals(result.delivered, true);
  assertEquals(result.delivery, "Answer sent: the run continues from plan in its own worktree.");
  assertEquals(runs.answers.get("run-a")?.length, 1, "the answer reaches the run through feedback.md");
});

Deno.test("a run the runner cannot resume still gets a fresh run carrying the answer", async () => {
  const runs = new InMemoryRunStore().addPipeline("run-a", asking);
  const context = fakeContext({ runs, settings: { resume: true } });
  const result = await replyToQuestion(context, "run-a", { answer: "use postgres", relaunch: true });
  assertEquals(context.launcher.started, [["PROJ-7", "--repo", "/repo", "--feedback", "use postgres"]]);
  assertEquals(result.replays, ["intake", "plan"]);
});

Deno.test("a runner that refuses to resume is reported, with the answer still recorded", async () => {
  const runs = new InMemoryRunStore().addPipeline("run-a", resumable);
  const launcher = new FakeLauncher();
  launcher.start = () =>
    Promise.reject(new LaunchFailedError("Resumed worktree left the pinned base commit"));
  const context = fakeContext({ runs, launcher, settings: { resume: true } });
  await assertRejects(
    () => replyToQuestion(context, "run-a", { answer: "ok", relaunch: true }),
    LaunchFailedError,
    "Your answer was recorded, but the run could not continue: Resumed worktree left the pinned base commit",
  );
  assertEquals(runs.answers.get("run-a")?.length, 1);
});
