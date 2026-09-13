import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { detailControls, documentsKey } from "../public/controls.js";

const stopped = { kind: "pipeline", status: "needs_input", retryable: true };
const question = { replays: ["intake", "plan"] };

Deno.test("with a launcher, a stopped run offers answer-and-re-run", () => {
  const controls = detailControls({ canLaunch: true }, stopped, question);
  assertEquals(controls.showReply, true);
  assertEquals(controls.showLaunch, true);
  assertEquals(controls.canRetry, true);
  assert(controls.warning.includes("replaying: intake, plan"));
});

Deno.test("without a launcher, nothing that launches is offered and the copy says so", () => {
  const controls = detailControls({ canLaunch: false }, stopped, question);
  assertEquals(controls.showReply, true, "answers can still be recorded");
  assertEquals(controls.showLaunch, false);
  assertEquals(controls.canRetry, false);
  assert(!controls.warning.includes("re-runs the team"), "must not promise a re-run it cannot do");
  assert(controls.warning.includes("no launcher is configured"));
});

Deno.test("an import has no reply panel and no launch controls", () => {
  const controls = detailControls({ canLaunch: true }, {
    kind: "import",
    status: "running",
    retryable: false,
  }, undefined);
  assertEquals(controls.showReply, false);
  assertEquals(controls.showLaunch, false);
  assertEquals(controls.warning, "");
});

Deno.test("a live run can be answered but not re-run", () => {
  const controls = detailControls(
    { canLaunch: true },
    { kind: "pipeline", status: "running", retryable: false },
    undefined,
  );
  assertEquals(controls.canRetry, false);
  assert(controls.warning.includes("picked up when it builds the next stage prompt"));
});

Deno.test("the document list reloads when the run moves on, not on every poll", () => {
  const run = { updatedAt: "2026-01-01T00:00:00Z", stages: [{}], files: ["state.json"] };
  assertEquals(documentsKey(run), documentsKey({ ...run }));
  assertNotEquals(documentsKey(run), documentsKey({ ...run, stages: [{}, {}] }));
  assertNotEquals(documentsKey(run), documentsKey({ ...run, updatedAt: "2026-01-01T00:00:05Z" }));
  assertNotEquals(documentsKey(run), documentsKey({ ...run, files: ["state.json", "feedback.md"] }));
  // An agent writing inside a stage folder moves activityAt without touching state.json.
  const live = { ...run, activityAt: "2026-01-01T00:00:00Z" };
  assertNotEquals(documentsKey(live), documentsKey({ ...live, activityAt: "2026-01-01T00:00:09Z" }));
});
