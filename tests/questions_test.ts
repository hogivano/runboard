import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withFixtures } from "./helpers.ts";

Deno.test("listOpenQuestions surfaces the agent that stopped and what it said", async () => {
  await using env = await withFixtures();
  const questions = await env.app.listOpenQuestions();

  assertEquals(questions.map((question) => question.runId), ["run-question"]);
  const [question] = questions;
  assertEquals(question.status, "needs_input");
  assertEquals(question.stage, "intake");
  assertEquals(question.role, "analyst");
  assertEquals(question.answered, false);
  // The agent's own words are passed through: the qualifiers are what make it answerable.
  assert(question.detail.length > 0);
  // The run has exited, so an answer only reaches an agent through a fresh run.
  assertEquals(question.channel, "relaunch");
  assertEquals(question.replays, ["intake"]);
});

Deno.test("listOpenQuestions ignores runs that are not waiting", async () => {
  await using env = await withFixtures();
  const ids = (await env.app.listOpenQuestions()).map((question) => question.runId);
  assert(!ids.includes("run-legacy"), "ready_for_manager_review is not a question");
  assert(!ids.includes("run-recorded"));
});

Deno.test("listOpenQuestions reports a run blocked by an exception with its reason", async () => {
  await using env = await withFixtures();
  const statePath = join(env.runsRoot, "run-legacy/state.json");
  const state = JSON.parse(await Deno.readTextFile(statePath));
  state.status = "blocked";
  state.reason = "Fix-round budget exhausted; escalate to manager";
  await Deno.writeTextFile(statePath, JSON.stringify(state));

  const question = (await env.app.listOpenQuestions()).find((q) => q.runId === "run-legacy");
  assert(question, "a blocked run needs an answer too");
  assertEquals(question.reason, "Fix-round budget exhausted; escalate to manager");
});

Deno.test("listOpenQuestions marks a question that already has a recorded answer", async () => {
  await using env = await withFixtures();
  await Deno.writeTextFile(
    join(env.runsRoot, "run-question/answers.jsonl"),
    '{"answer":"zero"}\n',
  );
  const [question] = await env.app.listOpenQuestions();
  assertEquals(question.answered, true);
});
