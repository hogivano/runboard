/**
 * The application's input boundary: every use case, bound to its dependencies. Driving
 * adapters (HTTP, tests, a future CLI) talk to this and nothing below it.
 */
import type { DocumentContent, DocumentInfo } from "../domain/document.ts";
import type { OpenQuestion } from "../domain/question.ts";
import type { AppContext } from "./context.ts";
import type { LaunchResult } from "./ports.ts";
import { getRun } from "./use_cases/get_run.ts";
import { listDocuments } from "./use_cases/list_documents.ts";
import { listOpenQuestions } from "./use_cases/list_open_questions.ts";
import { listRuns } from "./use_cases/list_runs.ts";
import { readDocument } from "./use_cases/read_document.ts";
import { type ReplyInput, replyToQuestion } from "./use_cases/reply_to_question.ts";
import { retryRun, type RetryRunInput } from "./use_cases/retry_run.ts";
import { startRun, type StartRunInput } from "./use_cases/start_run.ts";
import type { PublicSettings, ReplyResult, RunDetail, RunSummary } from "./views.ts";

export interface Application {
  publicSettings(): PublicSettings;
  listRuns(): Promise<RunSummary[]>;
  getRun(id: string): Promise<RunDetail>;
  listOpenQuestions(): Promise<OpenQuestion[]>;
  listDocuments(runId: string): Promise<DocumentInfo[]>;
  readDocument(runId: string, documentId: string): Promise<DocumentContent>;
  startRun(input: StartRunInput): Promise<LaunchResult>;
  retryRun(runId: string, input: RetryRunInput): Promise<LaunchResult>;
  replyToQuestion(runId: string, input: ReplyInput): Promise<ReplyResult>;
}

export function createApplication(context: AppContext): Application {
  return {
    publicSettings: () => ({
      title: context.settings.title,
      sourceLabel: context.settings.sourceLabel,
      canLaunch: context.launcher.configured,
    }),
    listRuns: () => listRuns(context),
    getRun: (id) => getRun(context, id),
    listOpenQuestions: () => listOpenQuestions(context),
    listDocuments: (runId) => listDocuments(context, runId),
    readDocument: (runId, documentId) => readDocument(context, runId, documentId),
    startRun: (input) => startRun(context, input),
    retryRun: (runId, input) => retryRun(context, runId, input),
    replyToQuestion: (runId, input) => replyToQuestion(context, runId, input),
  };
}
