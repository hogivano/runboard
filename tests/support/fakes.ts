/**
 * In-memory implementations of the application ports. Use case tests run against these,
 * with no filesystem, git or processes — which is what the ports are for.
 */
import type { AppContext, AppSettings } from "../../src/application/context.ts";
import type {
  AnswerEntry,
  DocumentStore,
  Launcher,
  LaunchResult,
  RunStore,
  StoredImport,
  StoredPipeline,
  WorkspaceScanner,
} from "../../src/application/ports.ts";
import { LauncherUnavailableError } from "../../src/domain/errors.ts";
import type { RunRecord } from "../../src/domain/run.ts";

export const NOW = new Date("2026-01-10T12:00:00Z");

export class InMemoryRunStore implements RunStore {
  pipelines = new Map<string, StoredPipeline>();
  imports = new Map<string, StoredImport>();
  answers = new Map<string, AnswerEntry[]>();
  briefs = new Set<string>();

  addPipeline(id: string, record: RunRecord, writtenAt = NOW): this {
    this.pipelines.set(id, { id, record, recordWrittenAt: writtenAt });
    return this;
  }

  addImport(id: string, lines: Record<string, unknown>[], lastWrite: Date | null): this {
    this.imports.set(id, { id, lines, lastWrite });
    return this;
  }

  listPipelines() {
    return Promise.resolve([...this.pipelines.values()]);
  }
  listImportIds() {
    return Promise.resolve([...this.imports.keys()]);
  }
  readImport(id: string) {
    return Promise.resolve(this.imports.get(id) ?? null);
  }
  readPipeline(id: string) {
    return Promise.resolve(this.pipelines.get(id) ?? null);
  }
  readEventLines() {
    return Promise.resolve([]);
  }
  listRunFiles() {
    return Promise.resolve([]);
  }
  latestActivity() {
    return Promise.resolve(null);
  }
  hasAnswers(id: string) {
    return Promise.resolve((this.answers.get(id) ?? []).length > 0);
  }
  appendAnswer(id: string, entry: AnswerEntry) {
    this.answers.set(id, [...(this.answers.get(id) ?? []), entry]);
    return Promise.resolve({
      answersPath: `mem://${id}/answers.jsonl`,
      feedbackPath: `mem://${id}/feedback.md`,
    });
  }
  briefExists(path: string) {
    return Promise.resolve(this.briefs.has(path));
  }
  runDirectory(id: string) {
    return `/runs/${id}`;
  }
}

export class FakeLauncher implements Launcher {
  started: string[][] = [];
  constructor(readonly configured = true, private readonly unavailable: string | null = null) {}

  ensureReady(): Promise<void> {
    if (!this.configured) return Promise.reject(new LauncherUnavailableError("No launcher is configured"));
    if (this.unavailable) return Promise.reject(new LauncherUnavailableError(this.unavailable));
    return Promise.resolve();
  }

  async start(args: string[]): Promise<LaunchResult> {
    await this.ensureReady();
    this.started.push(args);
    return { pid: 4242, command: ["runner", ...args] };
  }
}

const noDocuments: DocumentStore = {
  listRunFolder: () => Promise.resolve([]),
  describeWorkspaceFile: () => Promise.resolve(null),
  read: () => Promise.resolve(null),
};

const noWorkspaces: WorkspaceScanner = { untrackedFiles: () => Promise.resolve([]) };

export function fakeContext(parts: {
  runs?: InMemoryRunStore;
  launcher?: FakeLauncher;
  documents?: DocumentStore;
  workspaces?: WorkspaceScanner;
  settings?: Partial<AppSettings>;
} = {}): AppContext & { runs: InMemoryRunStore; launcher: FakeLauncher } {
  return {
    runs: parts.runs ?? new InMemoryRunStore(),
    launcher: parts.launcher ?? new FakeLauncher(),
    documents: parts.documents ?? noDocuments,
    workspaces: parts.workspaces ?? noWorkspaces,
    settings: {
      title: "test",
      sourceLabel: "tracker",
      staleImportMs: 10 * 60_000,
      stages: [],
      resume: false,
      ...parts.settings,
    },
    now: () => NOW,
  };
}
