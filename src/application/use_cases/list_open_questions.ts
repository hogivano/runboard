import { type OpenQuestion, toOpenQuestion } from "../../domain/question.ts";
import { isWaitingStatus } from "../../domain/run.ts";
import type { AppContext } from "../context.ts";
import { byRecentActivity, pipelineSummary } from "./run_summaries.ts";

/** Every run waiting on a human answer, most recent first. */
export async function listOpenQuestions(context: AppContext): Promise<OpenQuestion[]> {
  const waiting = (await context.runs.listPipelines())
    .map((stored) => ({ stored, summary: pipelineSummary(stored) }))
    .filter(({ summary }) => isWaitingStatus(summary.status))
    .sort((a, b) => byRecentActivity(a.summary, b.summary));

  const questions: OpenQuestion[] = [];
  for (const { stored, summary } of waiting) {
    questions.push(
      toOpenQuestion(
        summary,
        stored.record,
        await context.runs.hasAnswers(summary.id),
        context.settings.resume,
      ),
    );
  }
  return questions;
}
