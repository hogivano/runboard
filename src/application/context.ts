/** Everything a use case may depend on: ports, settings and a clock. Built once at startup. */
import type { StageSpec } from "../domain/stage.ts";
import type { DocumentStore, Launcher, RunStore, WorkspaceScanner } from "./ports.ts";

export interface AppSettings {
  title: string;
  /** Name of the task source, e.g. "Jira". */
  sourceLabel: string;
  /** An import with no result and no writes for this long is stale. */
  staleImportMs: number;
  /** Expected stage order and labels. */
  stages: readonly StageSpec[];
  /** The runner accepts `--resume <run-dir>` to continue a halted run. */
  resume: boolean;
}

export interface AppContext {
  runs: RunStore;
  documents: DocumentStore;
  workspaces: WorkspaceScanner;
  launcher: Launcher;
  settings: AppSettings;
  now(): Date;
}
