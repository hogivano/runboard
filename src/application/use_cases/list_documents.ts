import { type DocumentInfo, isListableWorkspaceNote, isReadableDocument } from "../../domain/document.ts";
import { parseStageFolder } from "../../domain/stage.ts";
import type { AppContext } from "../context.ts";
import { requireRunId } from "./run_summaries.ts";

/**
 * Lists every document a run's agents wrote: files in the run folder, files in its stage
 * folders, and the notes left untracked in its git worktree.
 */
export async function listDocuments(context: AppContext, rawId: string): Promise<DocumentInfo[]> {
  const id = requireRunId(rawId);
  const documents: DocumentInfo[] = [];

  for (const file of await context.documents.listRunFolder(id)) {
    const stage = file.folder === null ? null : parseStageFolder(file.folder);
    if (file.folder !== null && !stage) continue;
    documents.push({
      id: file.folder === null ? `run/${file.name}` : `stage/${file.folder}/${file.name}`,
      source: file.folder === null ? "run" : "stage",
      name: file.name,
      stage: stage?.stage ?? null,
      role: stage?.role ?? null,
      size: file.size,
      modifiedAt: file.modifiedAt?.toISOString() ?? null,
      readable: isReadableDocument(file.name),
    });
  }

  const workspace = (await context.runs.readPipeline(id))?.record.workspace;
  if (!workspace) return documents;

  for (const relative of await context.workspaces.untrackedFiles(workspace)) {
    if (!isListableWorkspaceNote(relative)) continue;
    const facts = await context.documents.describeWorkspaceFile(workspace, relative);
    if (!facts) continue;
    documents.push({
      id: `workspace/${relative}`,
      source: "workspace",
      name: relative.split("/").pop() ?? relative,
      stage: null,
      role: null,
      size: facts.size,
      modifiedAt: facts.modifiedAt?.toISOString() ?? null,
      readable: true,
    });
  }
  return documents;
}
