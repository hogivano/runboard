/** DocumentStore over the local filesystem, with symlink-safe containment. */
import { join, resolve } from "@std/path";
import type {
  DocumentRoot,
  DocumentStore,
  FileFacts,
  RunFolderFile,
  StoredDocument,
} from "../../application/ports.ts";
import { isContained } from "../../domain/document.ts";
import { InvalidInputError } from "../../domain/errors.ts";
import { byName, listEntries, stat } from "./fs.ts";

export class FsDocumentStore implements DocumentStore {
  constructor(private readonly runsRoot: string) {}

  async listRunFolder(runId: string): Promise<RunFolderFile[]> {
    const dir = join(this.runsRoot, runId);
    const files: RunFolderFile[] = [];
    for (const entry of (await listEntries(dir)).sort(byName)) {
      if (entry.isFile) {
        const facts = await this.facts(join(dir, entry.name));
        if (facts) files.push({ folder: null, name: entry.name, ...facts });
        continue;
      }
      if (!entry.isDirectory) continue;
      for (const inner of (await listEntries(join(dir, entry.name))).sort(byName)) {
        if (!inner.isFile) continue;
        const facts = await this.facts(join(dir, entry.name, inner.name));
        if (facts) files.push({ folder: entry.name, name: inner.name, ...facts });
      }
    }
    return files;
  }

  describeWorkspaceFile(workspace: string, relative: string): Promise<FileFacts | null> {
    return this.facts(join(workspace, relative));
  }

  async read(root: DocumentRoot, relative: string, maxBytes: number): Promise<StoredDocument | null> {
    const rootPath = root.kind === "run" ? join(this.runsRoot, root.runId) : root.path;
    let realRoot: string;
    let realPath: string;
    try {
      // Resolve symlinks on both sides first, or a link planted in a worktree escapes it.
      realRoot = await Deno.realPath(rootPath);
      realPath = await Deno.realPath(resolve(rootPath, relative));
    } catch {
      return null;
    }
    if (!isContained(realRoot, realPath)) throw new InvalidInputError("Document path escapes the run");

    const facts = await this.facts(realPath);
    if (!facts) return null;
    const bytes = await Deno.readFile(realPath);
    const truncated = bytes.length > maxBytes;
    return {
      ...facts,
      path: realPath,
      content: new TextDecoder().decode(truncated ? bytes.subarray(0, maxBytes) : bytes),
      truncated,
    };
  }

  /** Size and modification time of a regular file, or null. */
  private async facts(path: string): Promise<FileFacts | null> {
    const info = await stat(path);
    return info?.isFile ? { size: info.size, modifiedAt: info.mtime } : null;
  }
}
