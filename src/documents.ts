/**
 * Agent-authored documents for a run, from two places:
 *
 * 1. The run directory — each stage writes `prompt.md`, `report.json` and `output.log`.
 * 2. The run's git worktree — agents leave analysis and handoff notes at the repo root.
 *    Untracked files are exactly the ones this run wrote, which is the same signal
 *    the reference runner uses to describe a stage's changes, so repo files like CLAUDE.md are
 *    excluded without guessing from filenames.
 */
import { basename, dirname, join, resolve } from "@std/path";
import type { Config } from "./config.ts";
import { badRequest, notFound } from "./errors.ts";
import { readRunState, runDirectory } from "./runs.ts";
import type { RunState } from "./types.ts";

/** Readable text only; anything else is listed but never served as a document. */
const READABLE = new Set([".md", ".txt", ".json", ".log", ".diff", ".patch"]);
const MAX_DOCUMENT_BYTES = 512 * 1024;

export type DocumentSource = "stage" | "run" | "workspace";

export interface DocumentInfo {
  /** Opaque, URL-safe id: `<source>/<relative path>`. */
  id: string;
  source: DocumentSource;
  name: string;
  /** Stage folder the document belongs to, when it came from one. */
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

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/** Stage folders are named `NN-<stage>-<role>`, e.g. `01-intake-analyst`. */
function parseStageDir(name: string): { stage: string; role: string } | null {
  const match = /^(\d+)-(.+)-([a-z]+)$/.exec(name);
  return match ? { stage: match[2], role: match[3] } : null;
}

async function describe(
  id: string,
  source: DocumentSource,
  absolute: string,
  stage: string | null,
  role: string | null,
): Promise<DocumentInfo | null> {
  try {
    const info = await Deno.stat(absolute);
    if (!info.isFile) return null;
    return {
      id,
      source,
      name: basename(absolute),
      stage,
      role,
      size: info.size,
      modifiedAt: info.mtime?.toISOString() ?? null,
      readable: READABLE.has(extensionOf(absolute)),
    };
  } catch {
    return null;
  }
}

async function listDir(dir: string): Promise<Deno.DirEntry[]> {
  const out: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) out.push(entry);
  } catch {
    // Missing stage or run directory: nothing to list.
  }
  return out;
}

/**
 * Files this run left in its worktree. `git status --porcelain --untracked-files=all`
 * reports every untracked path; directories such as `node_modules` come back as a
 * single entry and are dropped by the file check in `describe`.
 */
async function workspaceNotes(workspace: string): Promise<DocumentInfo[]> {
  let output: Deno.CommandOutput;
  try {
    output = await new Deno.Command("git", {
      args: ["-C", workspace, "status", "--porcelain", "--untracked-files=all"],
      stdin: "null",
      stdout: "piped",
      stderr: "null",
    }).output();
  } catch {
    // No git, or no access to it: the run directory documents still list fine.
    return [];
  }
  if (!output.success) return [];

  const notes: DocumentInfo[] = [];
  for (const line of new TextDecoder().decode(output.stdout).split("\n")) {
    if (!line.startsWith("?? ")) continue;
    const relative = line.slice(3).trim().replace(/^"|"$/g, "");
    if (!relative || relative.includes("..")) continue;
    if (!READABLE.has(extensionOf(relative))) continue;
    const info = await describe(
      `workspace/${relative}`,
      "workspace",
      join(workspace, relative),
      null,
      null,
    );
    if (info) notes.push(info);
  }
  return notes;
}

/** Lists every document belonging to a run, newest stage last. */
export async function listDocuments(config: Config, id: string): Promise<DocumentInfo[]> {
  const dir = runDirectory(config, id);
  const documents: DocumentInfo[] = [];

  for (const entry of (await listDir(dir)).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile) {
      const info = await describe(`run/${entry.name}`, "run", join(dir, entry.name), null, null);
      if (info) documents.push(info);
      continue;
    }
    const stage = parseStageDir(entry.name);
    if (!stage) continue;
    for (const file of (await listDir(join(dir, entry.name))).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!file.isFile) continue;
      const info = await describe(
        `stage/${entry.name}/${file.name}`,
        "stage",
        join(dir, entry.name, file.name),
        stage.stage,
        stage.role,
      );
      if (info) documents.push(info);
    }
  }

  const state = await readRunState(config, id);
  if (state?.workspace) documents.push(...await workspaceNotes(state.workspace));
  return documents;
}

/**
 * Resolves a document id to a real path inside either the run directory or the run's
 * workspace. Symlinks are resolved before the containment check, so a link planted in
 * a worktree cannot reach outside it.
 */
async function resolveDocument(
  config: Config,
  id: string,
  documentId: string,
  state: RunState | null,
): Promise<{ absolute: string; source: DocumentSource; relative: string }> {
  if (documentId.includes("..") || documentId.startsWith("/")) {
    throw badRequest(`Invalid document path: ${documentId}`);
  }
  const [prefix, ...rest] = documentId.split("/");
  const relative = rest.join("/");
  if (!relative) throw badRequest("Document path is required");

  let root: string;
  let source: DocumentSource;
  if (prefix === "run" || prefix === "stage") {
    root = runDirectory(config, id);
    source = prefix;
  } else if (prefix === "workspace") {
    if (!state?.workspace) throw notFound("This run has no workspace");
    root = state.workspace;
    source = "workspace";
  } else {
    throw badRequest(`Unknown document source: ${prefix}`);
  }

  let realRoot: string;
  let realPath: string;
  try {
    realRoot = await Deno.realPath(root);
    realPath = await Deno.realPath(resolve(root, relative));
  } catch {
    throw notFound(`No document at ${documentId}`);
  }
  if (realPath !== realRoot && !realPath.startsWith(realRoot + "/")) {
    throw badRequest("Document path escapes the run");
  }
  return { absolute: realPath, source, relative };
}

/** Reads one document. Long files are truncated rather than refused. */
export async function readDocument(
  config: Config,
  id: string,
  documentId: string,
): Promise<DocumentContent> {
  const state = await readRunState(config, id);
  const { absolute, source, relative } = await resolveDocument(config, id, documentId, state);

  if (!READABLE.has(extensionOf(absolute))) {
    throw badRequest(`${basename(absolute)} is not a readable text document`);
  }
  const info = await Deno.stat(absolute);
  if (!info.isFile) throw notFound(`No document at ${documentId}`);

  const bytes = await Deno.readFile(absolute);
  const truncated = bytes.length > MAX_DOCUMENT_BYTES;
  const content = new TextDecoder().decode(
    truncated ? bytes.subarray(0, MAX_DOCUMENT_BYTES) : bytes,
  );
  const stage = source === "stage" ? parseStageDir(dirname(relative)) : null;

  return {
    id: documentId,
    source,
    name: basename(absolute),
    stage: stage?.stage ?? null,
    role: stage?.role ?? null,
    size: info.size,
    modifiedAt: info.mtime?.toISOString() ?? null,
    readable: true,
    path: absolute,
    content,
    truncated,
  };
}
