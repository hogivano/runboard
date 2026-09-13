/**
 * Agent documents: the files a run's agents wrote, from its run directory and its git
 * worktree. These rules decide what may be listed and served; reading bytes is an adapter's job.
 */
import { InvalidInputError } from "./errors.ts";

export type DocumentSource = "stage" | "run" | "workspace";

export interface DocumentInfo {
  /** Opaque, URL-safe id: `<source>/<relative path>`. */
  id: string;
  source: DocumentSource;
  name: string;
  /** Stage the document belongs to, when it came from a stage folder. */
  stage: string | null;
  role: string | null;
  size: number;
  modifiedAt: string | null;
  readable: boolean;
}

export interface DocumentContent extends DocumentInfo {
  path: string;
  content: string;
  truncated: boolean;
}

/** Longer documents are truncated rather than refused. */
export const MAX_DOCUMENT_BYTES = 512 * 1024;

/** Readable text only; anything else is listed but never served. */
const READABLE = new Set([".md", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".log", ".diff", ".patch"]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  const slash = name.lastIndexOf("/");
  return dot === -1 || dot < slash ? "" : name.slice(dot).toLowerCase();
}

export function isReadableDocument(name: string): boolean {
  return READABLE.has(extensionOf(name));
}

export function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Splits and validates a document id. Refuses traversal and unreadable types before any
 * file is touched, so the answer never depends on whether such a file exists.
 */
export function parseDocumentId(documentId: string): { source: DocumentSource; relative: string } {
  if (!isReadableDocument(documentId)) {
    throw new InvalidInputError(`${baseName(documentId)} is not a readable text document`);
  }
  if (documentId.includes("..") || documentId.startsWith("/")) {
    throw new InvalidInputError(`Invalid document path: ${documentId}`);
  }
  const [prefix, ...rest] = documentId.split("/");
  const relative = rest.join("/");
  if (!relative) throw new InvalidInputError("Document path is required");
  if (prefix !== "run" && prefix !== "stage" && prefix !== "workspace") {
    throw new InvalidInputError(`Unknown document source: ${prefix}`);
  }
  return { source: prefix, relative };
}

/**
 * Whether a fully resolved path stays inside a fully resolved root. Both must already have
 * symlinks resolved, or a link planted in a worktree could reach outside it.
 */
export function isContained(realRoot: string, realPath: string): boolean {
  return realPath === realRoot || realPath.startsWith(realRoot + "/");
}

/**
 * A worktree path from `git status` that may be listed as a note: relative, no traversal,
 * readable type.
 */
export function isListableWorkspaceNote(relative: string): boolean {
  return Boolean(relative) && !relative.includes("..") && isReadableDocument(relative);
}
