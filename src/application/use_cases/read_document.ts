import {
  baseName,
  type DocumentContent,
  isReadableDocument,
  MAX_DOCUMENT_BYTES,
  parseDocumentId,
} from "../../domain/document.ts";
import { InvalidInputError, NotFoundError } from "../../domain/errors.ts";
import { parseStageFolder } from "../../domain/stage.ts";
import type { AppContext } from "../context.ts";
import type { DocumentRoot } from "../ports.ts";
import { requireRunId } from "./run_summaries.ts";

/** Reads one of a run's documents. Long files are truncated rather than refused. */
export async function readDocument(
  context: AppContext,
  rawId: string,
  documentId: string,
): Promise<DocumentContent> {
  const { source, relative } = parseDocumentId(documentId);
  const id = requireRunId(rawId);

  let root: DocumentRoot;
  if (source === "workspace") {
    const workspace = (await context.runs.readPipeline(id))?.record.workspace;
    if (!workspace) throw new NotFoundError("This run has no workspace");
    root = { kind: "workspace", path: workspace };
  } else {
    root = { kind: "run", runId: id };
  }

  const stored = await context.documents.read(root, relative, MAX_DOCUMENT_BYTES);
  if (!stored) throw new NotFoundError(`No document at ${documentId}`);
  // A symlink can resolve to a different file type than the name that was requested.
  if (!isReadableDocument(stored.path)) {
    throw new InvalidInputError(`${baseName(stored.path)} is not a readable text document`);
  }

  const folder = relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : "";
  const stage = source === "stage" ? parseStageFolder(folder) : null;
  return {
    id: documentId,
    source,
    name: baseName(stored.path),
    stage: stage?.stage ?? null,
    role: stage?.role ?? null,
    size: stored.size,
    modifiedAt: stored.modifiedAt?.toISOString() ?? null,
    readable: true,
    path: stored.path,
    content: stored.content,
    truncated: stored.truncated,
  };
}
