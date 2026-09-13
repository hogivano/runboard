/**
 * JSONL readers. Logs are read while the writer is still appending, so a torn
 * final line is normal and must never fail a request.
 */

/** Parses every complete JSON line, silently skipping blank and malformed ones. */
export function parseJsonLines(raw: string): unknown[] {
  const out: unknown[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Torn or partially flushed line: skip it rather than failing the whole read.
    }
  }
  return out;
}

/**
 * Reads at most the last `maxBytes` of a file. Import logs reach hundreds of KB
 * and are polled every few seconds, so the list view never reads them whole.
 * A partial leading line is dropped by `parseJsonLines`.
 */
export async function readTail(path: string, maxBytes: number): Promise<string> {
  let file: Deno.FsFile;
  try {
    file = await Deno.open(path, { read: true });
  } catch {
    return "";
  }
  try {
    const size = (await file.stat()).size;
    const start = Math.max(0, size - maxBytes);
    if (start > 0) await file.seek(start, Deno.SeekMode.Start);
    const bytes = new Uint8Array(size - start);
    let read = 0;
    while (read < bytes.length) {
      const n = await file.read(bytes.subarray(read));
      if (n === null) break;
      read += n;
    }
    return new TextDecoder().decode(bytes.subarray(0, read));
  } finally {
    file.close();
  }
}
