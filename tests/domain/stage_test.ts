import { assertEquals } from "@std/assert";
import type { RunRecord } from "../../src/domain/run.ts";
import { buildStageGraph } from "../../src/domain/stage.ts";

const state: RunRecord = {
  status: "running",
  active_stage: "review",
  history: [
    { stage: "intake", role: "analyst", report: { status: "pass" } },
    { stage: "build", role: "builder", report: { status: "fail" }, diff_stat: "3 files changed" },
    { stage: "build", role: "builder", report: { status: "pass" }, diff_stat: "4 files changed" },
  ],
};

Deno.test("with no configured stages, a run draws exactly the stages it ran", () => {
  const stages = buildStageGraph(state, []);
  assertEquals(stages.map((stage) => stage.id), ["intake", "build", "review"]);
  assertEquals(stages[0].label, "analyst · intake");
  // A repeated stage (a fix round) shows its latest outcome.
  assertEquals(stages[1].status, "pass");
  assertEquals(stages[1].diffStat, "4 files changed");
  assertEquals(stages[2].status, "active");
});

Deno.test("configured stages set order and labels and show stages not started yet", () => {
  const stages = buildStageGraph(state, [
    { id: "intake", label: "Requirements" },
    { id: "build" },
    { id: "review", label: "Code review" },
    { id: "release", label: "Release" },
  ]);
  assertEquals(stages.map((stage) => [stage.id, stage.label, stage.status]), [
    ["intake", "Requirements", "pass"],
    ["build", "builder · build", "pass"],
    ["review", "Code review", "active"],
    ["release", "Release", "pending"],
  ]);
});

Deno.test("a stage the runner invented is still shown after the configured ones", () => {
  const stages = buildStageGraph(state, [{ id: "intake" }]);
  assertEquals(stages.map((stage) => stage.id), ["intake", "build", "review"]);
});
