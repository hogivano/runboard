/** RunStore over a runs directory in the run directory format (docs/RUN_FORMAT.md). */
import { join } from "@std/path";
import type { AnswerEntry, RunStore, StoredImport, StoredPipeline } from "../../application/ports.ts";
import { IMPORTS_PREFIX, type RunRecord } from "../../domain/run.ts";
import { isStageFolder } from "../../domain/stage.ts";
import { isFile, listEntries, modifiedAt, readJson } from "./fs.ts";
import { parseJsonLines, readTail } from "./jsonl.ts";

/** Enough of an import stream to reach its trailing `result` line without reading it whole. */
const LIST_TAIL_BYTES = 64 * 1024;
const DETAIL_TAIL_BYTES = 512 * 1024;

export class FsRunStore implements RunStore {
  constructor(private readonly runsRoot: string) {}

  runDirectory(id: string): string {
    return this.dir(id);
  }

  private dir(id: string): string {
    return join(this.runsRoot, id);
  }

  async listPipelines(): Promise<StoredPipeline[]> {
    const pipelines: StoredPipeline[] = [];
    for (const entry of await listEntries(this.runsRoot)) {
      if (!entry.isDirectory || entry.name === IMPORTS_PREFIX) continue;
      const stored = await this.readPipeline(entry.name);
      if (stored) pipelines.push(stored);
    }
    return pipelines;
  }

  async listImportIds(): Promise<string[]> {
    return (await listEntries(join(this.runsRoot, IMPORTS_PREFIX)))
      .filter((entry) => entry.isDirectory)
      .map((entry) => `${IMPORTS_PREFIX}/${entry.name}`);
  }

  async readImport(id: string, detail: boolean): Promise<StoredImport | null> {
    const dir = this.dir(id);
    const dirWrittenAt = await modifiedAt(dir);
    if (!dirWrittenAt) return null;
    const log = join(dir, "output.jsonl");
    const raw = await readTail(log, detail ? DETAIL_TAIL_BYTES : LIST_TAIL_BYTES);
    return {
      id,
      lines: parseJsonLines(raw) as Record<string, unknown>[],
      lastWrite: await modifiedAt(log) ?? dirWrittenAt,
    };
  }

  async readPipeline(id: string): Promise<StoredPipeline | null> {
    const path = join(this.dir(id), "state.json");
    const record = await readJson<RunRecord>(path);
    return record ? { id, record, recordWrittenAt: await modifiedAt(path) } : null;
  }

  async readEventLines(id: string): Promise<unknown[]> {
    return parseJsonLines(await readTail(join(this.dir(id), "events.jsonl"), DETAIL_TAIL_BYTES));
  }

  async listRunFiles(id: string): Promise<string[]> {
    return (await listEntries(this.dir(id))).filter((entry) => entry.isFile).map((entry) => entry.name)
      .sort();
  }

  /**
   * Latest write in the run folder, its files, each stage folder and the files inside it.
   * The record alone misses an agent writing its report or output mid-stage.
   */
  async latestActivity(id: string): Promise<Date | null> {
    const dir = this.dir(id);
    let latest = 0;
    const consider = async (path: string) => {
      const mtime = await modifiedAt(path);
      if (mtime && mtime.getTime() > latest) latest = mtime.getTime();
    };
    await consider(dir);
    for (const entry of await listEntries(dir)) {
      const path = join(dir, entry.name);
      await consider(path);
      if (!entry.isDirectory || !isStageFolder(entry.name)) continue;
      for (const file of await listEntries(path)) await consider(join(path, file.name));
    }
    return latest ? new Date(latest) : null;
  }

  hasAnswers(id: string): Promise<boolean> {
    return isFile(join(this.dir(id), "answers.jsonl"));
  }

  async appendAnswer(
    id: string,
    entry: AnswerEntry,
  ): Promise<{ answersPath: string; feedbackPath: string }> {
    const answersPath = join(this.dir(id), "answers.jsonl");
    const feedbackPath = join(this.dir(id), "feedback.md");
    await Deno.writeTextFile(answersPath, `${JSON.stringify(entry)}\n`, { append: true });
    // The runner pastes this whole file into the next stage prompt, so answers accumulate:
    // overwriting would drop an earlier answer a live run has not read yet.
    await Deno.writeTextFile(feedbackPath, `## Answer ${entry.time}\n\n${entry.answer}\n\n`, {
      append: true,
    });
    return { answersPath, feedbackPath };
  }

  briefExists(path: string): Promise<boolean> {
    return isFile(path);
  }
}
