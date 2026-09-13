import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { listDocuments, readDocument } from "../src/documents.ts";
import { HttpError } from "../src/errors.ts";
import { withFixtures } from "./helpers.ts";

Deno.test("listDocuments returns each stage's files tagged with the agent that wrote them", async () => {
  await using env = await withFixtures();
  const documents = await listDocuments(env.config, "run-question");

  const report = documents.find((doc) => doc.name === "report.json");
  assert(report, "the intake report should be listed");
  assertEquals(report.source, "stage");
  assertEquals(report.stage, "intake");
  assertEquals(report.role, "analyst");
  assertEquals(report.readable, true);

  assert(documents.some((doc) => doc.id === "run/state.json"));
  // events.jsonl has no readable extension, so it is listed but not servable.
  assertEquals(documents.find((doc) => doc.name === "events.jsonl")?.readable, false);
});

Deno.test("readDocument returns the content of an agent document", async () => {
  await using env = await withFixtures();
  const doc = await readDocument(env.config, "run-question", "stage/01-intake-analyst/report.json");
  assertEquals(doc.name, "report.json");
  assertEquals(doc.truncated, false);
  assertEquals(JSON.parse(doc.content).status, "needs_input");
});

Deno.test("readDocument refuses to escape the run or serve binary-ish files", async () => {
  await using env = await withFixtures();
  const cases: [string, number][] = [
    ["workspace/../../../etc/passwd", 400],
    ["run/../../escape.md", 400],
    ["bogus/notes.md", 400],
    ["run/events.jsonl", 400],
    ["run/missing.md", 404],
  ];
  for (const [documentId, status] of cases) {
    const error = await assertRejects(
      () => readDocument(env.config, "run-question", documentId),
      HttpError,
      undefined,
      `expected ${documentId} to be refused`,
    );
    assertEquals(error.status, status, documentId);
  }
});

Deno.test("readDocument follows a symlink but refuses one pointing outside the run", async () => {
  await using env = await withFixtures();
  const outside = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(outside, "secret.md"), "not yours");
    await Deno.symlink(join(outside, "secret.md"), join(env.runsRoot, "run-question/link.md"));

    const error = await assertRejects(
      () => readDocument(env.config, "run-question", "run/link.md"),
      HttpError,
    );
    assertEquals(error.status, 400);
  } finally {
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("listDocuments lists agent notes from the worktree but not tracked repo files", async () => {
  await using env = await withFixtures();
  const documents = await listDocuments(env.config, "run-recorded");
  const workspaceDocs = documents.filter((doc) => doc.source === "workspace");

  assertEquals(workspaceDocs.map((doc) => doc.name), ["NOTE_BUILDER_EXAMPLE.md"]);
  assert(
    !documents.some((doc) => doc.name === "CLAUDE.md"),
    "a tracked repo file is not an agent document",
  );

  const note = await readDocument(env.config, "run-recorded", workspaceDocs[0].id);
  assert(note.content.includes("retry twice"));
});

Deno.test("listDocuments works for a run with no workspace on disk", async () => {
  await using env = await withFixtures();
  const documents = await listDocuments(env.config, "run-legacy");
  assertEquals(documents.map((doc) => doc.id).sort(), ["run/events.jsonl", "run/state.json"]);
});
