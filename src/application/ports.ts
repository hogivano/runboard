/**
 * Ports: what the use cases need from the outside world, stated as interfaces. Adapters
 * implement them (filesystem, git, process); tests can implement them in memory. Nothing
 * in the application layer knows which implementation it runs against.
 */
import type { RunEvent, RunRecord } from "../domain/run.ts";

/** A pipeline run as stored: its record and when that record was last written. */
export interface StoredPipeline {
  id: string;
  record: RunRecord;
  recordWrittenAt: Date | null;
}

/** An import as stored: the parsed tail of its agent stream and its last write. */
export interface StoredImport {
  id: string;
  lines: Record<string, unknown>[];
  lastWrite: Date | null;
}

export interface AnswerEntry {
  time: string;
  run: string;
  stage: string | null;
  status: string | null;
  answer: string;
}

/** Where runs live and how answers are written next to them. */
export interface RunStore {
  /** Every pipeline run with a readable record. Folders without one are skipped. */
  listPipelines(): Promise<StoredPipeline[]>;
  /** Import ids in storage order. */
  listImportIds(): Promise<string[]>;
  /** `detail` reads more of the stream. Null when the import does not exist. */
  readImport(id: string, detail: boolean): Promise<StoredImport | null>;
  /** Null when the run does not exist or has no readable record. */
  readPipeline(id: string): Promise<StoredPipeline | null>;
  /** Raw activity log lines, malformed lines already skipped. */
  readEventLines(id: string): Promise<unknown[]>;
  /** Names of the files directly inside the run folder, sorted. */
  listRunFiles(id: string): Promise<string[]>;
  /** Latest write anywhere in the run folder and its stage folders. */
  latestActivity(id: string): Promise<Date | null>;
  hasAnswers(id: string): Promise<boolean>;
  /** Appends to the answer log and to the feedback the runner reads. */
  appendAnswer(id: string, entry: AnswerEntry): Promise<{ answersPath: string; feedbackPath: string }>;
  /** Whether a recorded brief path points at an existing file. */
  briefExists(path: string): Promise<boolean>;
  /** Absolute path of a run's directory, as a runner on this machine names it. */
  runDirectory(id: string): string;
}

/** A file found in a run folder: directly in it (`folder` null) or inside a subfolder. */
export interface RunFolderFile {
  folder: string | null;
  name: string;
  size: number;
  modifiedAt: Date | null;
}

export interface FileFacts {
  size: number;
  modifiedAt: Date | null;
}

/** Where a document is read from: a run folder, or a run's worktree. */
export type DocumentRoot = { kind: "run"; runId: string } | { kind: "workspace"; path: string };

export interface StoredDocument extends FileFacts {
  /** Resolved path, symlinks followed. */
  path: string;
  content: string;
  truncated: boolean;
}

/** Reads document files. Implementations must refuse any path that resolves outside its root. */
export interface DocumentStore {
  /** Files in a run folder and one level of subfolders, ordered by name. */
  listRunFolder(runId: string): Promise<RunFolderFile[]>;
  /** Facts about a regular file in a worktree, or null when it is not one. */
  describeWorkspaceFile(workspace: string, relative: string): Promise<FileFacts | null>;
  /**
   * Reads a file inside a root, at most `maxBytes`. Null when it does not exist or is not a
   * regular file. Throws `InvalidInputError` when the resolved path leaves the root.
   */
  read(root: DocumentRoot, relative: string, maxBytes: number): Promise<StoredDocument | null>;
}

/** Finds the files a run wrote in its git worktree. */
export interface WorkspaceScanner {
  /** Untracked paths relative to the worktree; empty when it is not a readable repository. */
  untrackedFiles(workspace: string): Promise<string[]>;
}

export interface LaunchResult {
  pid: number;
  command: string[];
  /** File the runner's own output goes to, when the launcher keeps one. */
  log?: string;
}

/** The pipeline runner's CLI. */
export interface Launcher {
  /** False when no runner is configured: nothing can be started. */
  readonly configured: boolean;
  /** Throws `LauncherUnavailableError` when the runner cannot be executed. */
  ensureReady(): Promise<void>;
  /**
   * Starts the runner detached with an argument list, never a shell string. Throws
   * `LaunchFailedError` when the runner exits with an error straight away.
   */
  start(args: string[]): Promise<LaunchResult>;
}

/** Re-exported for adapters that produce activity entries. */
export type { RunEvent };
