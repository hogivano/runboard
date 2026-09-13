import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createHandler } from "../src/server.ts";
import { withFixtures } from "./helpers.ts";

const IMPORT_ID = "imports/tracker-demo42-a1b2c3";

function get(path: string) {
  return new Request(`http://localhost${path}`);
}

function post(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("GET /api/runs/<encoded import id> resolves instead of returning null", async () => {
  await using env = await withFixtures();
  const handler = createHandler(env.config);
  const response = await handler(get(`/api/runs/${encodeURIComponent(IMPORT_ID)}`));
  assertEquals(response.status, 200);
  const detail = await response.json();
  assertEquals(detail.id, IMPORT_ID);
  assertEquals(detail.kind, "import");
});

Deno.test("POST reply records the answer and says it was not delivered", async () => {
  await using env = await withFixtures();
  const handler = createHandler(env.config);
  const response = await handler(
    post("/api/runs/run-question/reply", { answer: "  retry twice with backoff  " }),
  );
  assertEquals(response.status, 200);

  const result = await response.json();
  assertEquals(result.recorded, true);
  // run-question stopped on needs_input, so nothing will read this until a re-run.
  assertEquals(result.delivered, false);
  assertEquals(result.launch, null);
  assertEquals(result.replays, ["intake"]);

  assert(
    (await Deno.readTextFile(join(env.runsRoot, "run-question/feedback.md")))
      .includes("retry twice with backoff"),
  );
  const recorded = JSON.parse(
    (await Deno.readTextFile(join(env.runsRoot, "run-question/answers.jsonl"))).trim(),
  );
  assertEquals(recorded.answer, "retry twice with backoff");
  assertEquals(recorded.stage, "intake");
  assertEquals(await env.launchedArgs(), [], "recording an answer must not start a run");
});

Deno.test("POST reply with relaunch sends the answer and reuses the saved brief", async () => {
  await using env = await withFixtures();
  const handler = createHandler(env.config);
  const briefPath = join(env.runsRoot, "imports/tracker-demo42-a1b2c3/brief.md");
  await Deno.writeTextFile(briefPath, "# brief\n");
  // The fixture's recorded import path is absolute; point it at this copy.
  const statePath = join(env.runsRoot, "run-question/state.json");
  const state = JSON.parse(await Deno.readTextFile(statePath));
  state.input_source.path = join(env.runsRoot, "imports/tracker-demo42-a1b2c3");
  await Deno.writeTextFile(statePath, JSON.stringify(state));

  const response = await handler(
    post("/api/runs/run-question/reply", { answer: "zero", relaunch: true, repo: "/tmp/repo" }),
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).delivered, true);

  assertEquals(await env.launchedArgs({ expect: 1 }), [[
    "--brief",
    briefPath,
    "--repo",
    "/tmp/repo",
    "--feedback",
    "zero",
  ]], "a reply must reuse the existing brief instead of re-importing the task");
});

Deno.test("a second answer is added to feedback.md, never replacing the first", async () => {
  await using env = await withFixtures();
  const handler = createHandler(env.config);
  await handler(post("/api/runs/run-question/reply", { answer: "first answer" }));
  await handler(post("/api/runs/run-question/reply", { answer: "second answer" }));

  // The runner pastes this whole file into the next stage prompt, so an overwrite would
  // drop an answer a live run had not read yet.
  const feedback = await Deno.readTextFile(join(env.runsRoot, "run-question/feedback.md"));
  assert(feedback.includes("first answer"), "the first answer must survive");
  assert(feedback.includes("second answer"));

  const answers = (await Deno.readTextFile(join(env.runsRoot, "run-question/answers.jsonl")))
    .trim().split("\n").map((line) => JSON.parse(line).answer);
  assertEquals(answers, ["first answer", "second answer"]);
});

Deno.test("the detail template carries every field the client asks for", async () => {
  const here = new URL("../public/", import.meta.url);
  const [html, app] = await Promise.all([
    Deno.readTextFile(new URL("index.html", here)),
    Deno.readTextFile(new URL("app.js", here)),
  ]);
  const required = [...app.matchAll(/field\("([a-z-]+)"\)/g)].map((match) => match[1]);
  assert(required.length > 5, "expected the client to read several template fields");
  for (const name of new Set(required)) {
    assert(html.includes(`data-field="${name}"`), `index.html is missing [data-field="${name}"]`);
  }
});

Deno.test("POST reply is rejected for unknown runs, imports and empty text", async () => {
  await using env = await withFixtures();
  const handler = createHandler(env.config);
  const cases: [Request, number][] = [
    [post("/api/runs/run-missing/reply", { answer: "hi" }), 404],
    [post(`/api/runs/${encodeURIComponent(IMPORT_ID)}/reply`, { answer: "hi" }), 400],
    [post("/api/runs/run-question/reply", { answer: "   " }), 400],
  ];
  for (const [request, status] of cases) {
    const response = await handler(request);
    assertEquals(response.status, status);
    assert((await response.json()).error, "error responses must carry a message");
  }
});

Deno.test("POST retry reports why it cannot run instead of spawning blindly", async () => {
  await using env = await withFixtures();
  const handler = createHandler(env.config);

  // No repository in state and none supplied: actionable 400, not a spawn.
  const missingRepo = await handler(post("/api/runs/run-legacy/retry", {}));
  assertEquals(missingRepo.status, 400);
  assert((await missingRepo.json()).error.includes("repository"));

  // No reusable task or brief: 400.
  const noInput = await handler(post("/api/runs/run-legacy/retry", { repo: "/tmp/repo" }));
  assertEquals(noInput.status, 400);

  assertEquals(await env.launchedArgs(), [], "no launcher should have run");
});

Deno.test("POST retry re-reads the task only when asked", async () => {
  await using env = await withFixtures();
  const handler = createHandler(env.config);
  const response = await handler(
    post("/api/runs/run-question/retry", {
      repo: "/tmp/repo",
      feedback: "redo intake",
      refreshTask: true,
    }),
  );
  assertEquals(response.status, 200);
  assert((await response.json()).pid > 0);

  assertEquals(await env.launchedArgs({ expect: 1 }), [[
    "demo42",
    "--repo",
    "/tmp/repo",
    "--feedback",
    "redo intake",
  ]]);
});

Deno.test("POST retry reuses the repository and brief the run recorded", async () => {
  await using env = await withFixtures();
  const handler = createHandler(env.config);
  const response = await handler(post("/api/runs/run-recorded/retry", {}));
  assertEquals(response.status, 200);

  assertEquals(await env.launchedArgs({ expect: 1 }), [[
    "--brief",
    "/tmp/brief.md",
    "--repo",
    "/tmp/recorded-repo",
  ]]);
});

Deno.test("POST retry refuses a run that is still active", async () => {
  await using env = await withFixtures();
  const handler = createHandler(env.config);
  const response = await handler(post("/api/runs/run-question/retry", { repo: "/tmp/repo" }));
  assertEquals(response.status, 200, "needs_input runs are retryable");
  // Let the launched stub finish writing before the test tears its directory down.
  assertEquals((await env.launchedArgs({ expect: 1 })).length, 1);

  await Deno.writeTextFile(
    join(env.runsRoot, "run-recorded/state.json"),
    JSON.stringify({ status: "running", repository: "/tmp/recorded-repo", brief_path: "/tmp/b.md" }),
  );
  const active = await handler(post("/api/runs/run-recorded/retry", {}));
  assertEquals(active.status, 409);
  assert((await active.json()).error.includes("still active"));
});

Deno.test("a missing launcher yields an error response and leaves the server usable", async () => {
  await using env = await withFixtures({ launcher: "/nonexistent/runner" });
  const handler = createHandler(env.config);
  const failed = await handler(post("/api/start", { task: "demo42" }));
  assertEquals(failed.status, 400);
  assert((await failed.json()).error.includes("RUNBOARD_LAUNCHER"));

  const stillUp = await handler(get("/api/runs"));
  assertEquals(stillUp.status, 200);
  assert(Array.isArray(await stillUp.json()));
});

Deno.test("a non-executable launcher is reported, not spawned", async () => {
  await using env = await withFixtures();
  await Deno.chmod(env.config.launcher!, 0o644);
  const handler = createHandler(env.config);

  const response = await handler(post("/api/start", { task: "demo42" }));
  assertEquals(response.status, 400);
  assert((await response.json()).error.includes("not executable"));
  assertEquals(await env.launchedArgs(), []);
});

Deno.test("POST /api/start requires a task and passes an optional repo through", async () => {
  await using env = await withFixtures();
  const handler = createHandler(env.config);
  assertEquals((await handler(post("/api/start", { task: "" }))).status, 400);

  const started = await handler(post("/api/start", { task: "demo42", repo: "/tmp/repo" }));
  assertEquals(started.status, 200);
  // The reported command names the launcher, not the shell used to detach from it.
  assertEquals((await started.json()).command, [env.config.launcher, "demo42", "--repo", "/tmp/repo"]);
  assertEquals(await env.launchedArgs({ expect: 1 }), [["demo42", "--repo", "/tmp/repo"]]);
});

Deno.test("without a launcher, runboard reads and records but never starts a run", async () => {
  await using env = await withFixtures({ launcher: null });
  const handler = createHandler(env.config);

  const config = await (await handler(get("/api/config"))).json();
  assertEquals(config.canLaunch, false);

  for (
    const request of [
      post("/api/start", { task: "demo42" }),
      post("/api/runs/run-recorded/retry", {}),
      post("/api/runs/run-question/reply", { answer: "yes", relaunch: true, repo: "/tmp/repo" }),
    ]
  ) {
    const response = await handler(request);
    assertEquals(response.status, 400);
    assert((await response.json()).error.includes("No launcher is configured"));
  }

  // Recording an answer needs no launcher.
  const recorded = await handler(post("/api/runs/run-question/reply", { answer: "yes" }));
  assertEquals(recorded.status, 200);
  assertEquals((await handler(get("/api/runs"))).status, 200);
});

Deno.test("GET /api/config exposes labels, never filesystem paths", async () => {
  await using env = await withFixtures();
  const body = await (await createHandler(env.config)(get("/api/config"))).text();
  assertEquals(JSON.parse(body), { title: "runboard test", sourceLabel: "tracker", canLaunch: true });
  assert(!body.includes(env.runsRoot) && !body.includes(env.config.launcher!));
});

Deno.test("run detail carries a derived stage graph", async () => {
  await using env = await withFixtures();
  const detail = await (await createHandler(env.config)(get("/api/runs/run-question"))).json();
  assertEquals(detail.stages, [{
    id: "intake",
    label: "analyst · intake",
    role: "analyst",
    status: "needs_input",
    diffStat: "no working-tree diff yet",
    artifacts: [],
  }]);
});

Deno.test("unknown API routes and bad bodies answer with JSON errors", async () => {
  await using env = await withFixtures();
  const handler = createHandler(env.config);
  assertEquals((await handler(get("/api/nope"))).status, 400);
  assertEquals((await handler(post("/api/runs/run-legacy/explode", {}))).status, 400);

  const badJson = new Request("http://localhost/api/start", { method: "POST", body: "{oops" });
  assertEquals((await handler(badJson)).status, 400);
});

Deno.test("the dashboard page and its assets are served", async () => {
  await using env = await withFixtures();
  const handler = createHandler(env.config);
  for (const path of ["/", "/app.js", "/styles.css"]) {
    const response = await handler(get(path));
    assertEquals(response.status, 200, `${path} should be served`);
    await response.body?.cancel();
  }
});
