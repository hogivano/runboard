import { assert, assertEquals } from "@std/assert";
import { canResume, recordedAnswerDelivery, rerunPlan, resumeArgs } from "../../src/domain/rerun.ts";
import type { RunRecord } from "../../src/domain/run.ts";

const pass = { status: "pass" as const };
const halted: RunRecord = {
  status: "needs_input",
  active_stage: "plan",
  stage_queue: ["build", "review"],
  history: [
    { stage: "intake", role: "analyst", report: pass },
    { stage: "plan", role: "lead", report: { status: "needs_input" } },
  ],
};

Deno.test("a halt that recorded its queue can be resumed", () => {
  assertEquals(canResume(halted), true);
  assertEquals(canResume({ ...halted, status: "blocked" }), true);
});

Deno.test("only a halted run with a named stage can be resumed", () => {
  assertEquals(canResume({ ...halted, status: "running" }), false);
  assertEquals(canResume({ ...halted, status: "ready_for_manager_review" }), false);
  assertEquals(canResume({ ...halted, active_stage: undefined }), false);
});

Deno.test("a run without a saved queue resumes only from its first stage", () => {
  const legacy = { ...halted, stage_queue: undefined };
  assertEquals(canResume(legacy), false, "a later halt would lose the stages queued after it");
  assertEquals(
    canResume({
      status: "needs_input",
      active_stage: "intake",
      history: [{ stage: "intake", role: "analyst", report: { status: "needs_input" } }],
    }),
    true,
  );
  assertEquals(canResume({ status: "blocked", active_stage: "intake", history: [] }), true);
});

Deno.test("the plan resumes only the halted stage, or replays when resume is unavailable", () => {
  assertEquals(rerunPlan(halted, true), { mode: "resume", stages: ["plan"] });
  assertEquals(rerunPlan(halted, false), { mode: "replay", stages: ["intake", "plan"] });
  assertEquals(rerunPlan({ ...halted, stage_queue: undefined }, true), {
    mode: "replay",
    stages: ["intake", "plan"],
  });
});

Deno.test("resume passes only the run directory: the answer is already in feedback.md", () => {
  assertEquals(resumeArgs("/runs/run-a"), ["--resume", "/runs/run-a"]);
});

Deno.test("a recorded answer on a resumable run points at continuing, not re-running", () => {
  assert(recordedAnswerDelivery(halted, true, true).delivery.includes("continue the run"));
  assert(recordedAnswerDelivery(halted, true, false).delivery.includes("re-run the team"));
});
