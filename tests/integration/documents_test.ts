import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { InvalidInputError, NotFoundError } from "../../src/domain/errors.ts";
import { withFixtures } from "../support/fixtures.ts";

Deno.test("listDocuments returns each stage's files tagged with the agent that wrote them", async () => {
  await using env = await withFixtures();
  const documents = await env.app.listDocuments("run-question");

  const report = documents.find((doc) => doc.name === "report.json");
  assert(report, "the intake report should be listed");
  assertEquals(report.source, "stage");
  assertEquals(report.stage, "intake");
  assertEquals(report.role, "analyst");
  assertEquals(report.readable, true);

  assert(documents.some((doc) => doc.id === "run/state.json"));
  // The activity log is text an operator wants to read.
  assertEquals(documents.find((doc) => doc.name === "events.jsonl")?.readable, true);
});

Deno.test("readDocument returns the content of an agent document", async () => {
  await using env = await withFixtures();
  const doc = await env.app.readDocument("run-question", "stage/01-intake-analyst/report.json");
  assertEquals(doc.name, "report.json");
  assertEquals(doc.truncated, false);
  assertEquals(JSON.parse(doc.content).status, "needs_input");
});

Deno.test("readDocument serves the JSONL activity log", async () => {
  await using env = await withFixtures();
  const doc = await env.app.readDocument("run-question", "run/events.jsonl");
  assert(doc.content.includes("analyst started intake"));
});

Deno.test("readDocument serves a log's raw bytes, malformed lines included", async () => {
  await using env = await withFixtures();
  // The run list skips unparseable JSONL; the document viewer must show the file as written.
  const doc = await env.app.readDocument("run-legacy", "run/events.jsonl");
  assert(doc.content.includes("{bad json"));
});

Deno.test("readDocument refuses to escape the run or serve binary-ish files", async () => {
  await using env = await withFixtures();
  const cases: [string, number][] = [
    ["workspace/../../../etc/passwd", 400],
    ["run/../../escape.md", 400],
    ["bogus/notes.md", 400],
    ["run/missing.md", 404],
    ["run/archive.zip", 400],
  ];
  for (const [documentId, status] of cases) {
    await assertRejects(
      () => env.app.readDocument("run-question", documentId),
      status === 404 ? NotFoundError : InvalidInputError,
      undefined,
      `expected ${documentId} to be refused with ${status}`,
    );
  }
});

Deno.test("readDocument follows a symlink but refuses one pointing outside the run", async () => {
  await using env = await withFixtures();
  const outside = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(outside, "secret.md"), "not yours");
    await Deno.symlink(join(outside, "secret.md"), join(env.runsRoot, "run-question/link.md"));

    await assertRejects(
      () => env.app.readDocument("run-question", "run/link.md"),
      InvalidInputError,
      "escapes the run",
    );
  } finally {
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("listDocuments lists agent notes from the worktree but not tracked repo files", async () => {
  await using env = await withFixtures();
  const documents = await env.app.listDocuments("run-recorded");
  const workspaceDocs = documents.filter((doc) => doc.source === "workspace");

  assertEquals(workspaceDocs.map((doc) => doc.name), ["NOTE_BUILDER_EXAMPLE.md"]);
  assert(
    !documents.some((doc) => doc.name === "CLAUDE.md"),
    "a tracked repo file is not an agent document",
  );

  const note = await env.app.readDocument("run-recorded", workspaceDocs[0].id);
  assert(note.content.includes("retry twice"));
});

Deno.test("listDocuments works for a run with no workspace on disk", async () => {
  await using env = await withFixtures();
  const documents = await env.app.listDocuments("run-legacy");
  assertEquals(documents.map((doc) => doc.id).sort(), ["run/events.jsonl", "run/state.json"]);
});
