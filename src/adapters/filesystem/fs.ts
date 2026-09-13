/** Small filesystem helpers shared by the filesystem adapters. Missing paths are not errors. */

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
  } catch {
    return null;
  }
}

/** Entries of a directory; empty when it is missing or unreadable. */
export async function listEntries(dir: string): Promise<Deno.DirEntry[]> {
  const out: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) out.push(entry);
  } catch {
    // A missing runs root or run folder is an empty listing, not a failure.
  }
  return out;
}

export async function stat(path: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.stat(path);
  } catch {
    return null;
  }
}

export async function modifiedAt(path: string): Promise<Date | null> {
  return (await stat(path))?.mtime ?? null;
}

export async function isFile(path: string): Promise<boolean> {
  return (await stat(path))?.isFile ?? false;
}

export function byName(a: Deno.DirEntry, b: Deno.DirEntry): number {
  return a.name.localeCompare(b.name);
}
