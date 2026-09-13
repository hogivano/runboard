import { assertEquals, assertThrows } from "@std/assert";
import { isContained, isReadableDocument, parseDocumentId } from "../../src/domain/document.ts";
import { InvalidInputError } from "../../src/domain/errors.ts";

Deno.test("document ids split into a source and a relative path", () => {
  assertEquals(parseDocumentId("stage/01-intake-analyst/report.json"), {
    source: "stage",
    relative: "01-intake-analyst/report.json",
  });
  assertEquals(parseDocumentId("workspace/docs/NOTE.md"), { source: "workspace", relative: "docs/NOTE.md" });
});

Deno.test("unsafe or unreadable document ids are refused", () => {
  for (const id of ["run/../../x.md", "/etc/passwd.md", "bogus/notes.md", "run/archive.zip", "run/"]) {
    assertThrows(() => parseDocumentId(id), InvalidInputError, undefined, id);
  }
});

Deno.test("containment compares resolved paths, not prefixes that merely look alike", () => {
  assertEquals(isContained("/runs/run-a", "/runs/run-a/report.json"), true);
  assertEquals(isContained("/runs/run-a", "/runs/run-a"), true);
  assertEquals(isContained("/runs/run-a", "/runs/run-ab/secret.md"), false);
  assertEquals(isContained("/runs/run-a", "/etc/passwd"), false);
});

Deno.test("only text document types are readable", () => {
  assertEquals(["a.md", "a.JSONL", "dir.d/b.log"].map(isReadableDocument), [true, true, true]);
  assertEquals(["a.zip", "Makefile", "dir.md/binary"].map(isReadableDocument), [false, false, false]);
});
