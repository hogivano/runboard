/** HTTP routing. Everything here maps a request to a call in `runs.ts` or `actions.ts`. */
import { serveDir } from "@std/http/file-server";
import { fromFileUrl } from "@std/path";
import { replyToQuestion, retryRun, startRun } from "./actions.ts";
import { listDocuments, readDocument } from "./documents.ts";
import { listOpenQuestions } from "./questions.ts";
import type { Config } from "./config.ts";
import { badRequest, HttpError } from "./errors.ts";
import { getRun, listRuns } from "./runs.ts";

const PUBLIC_DIR = fromFileUrl(new URL("../public", import.meta.url));
const API_RUNS = "/api/runs/";
const DOCUMENTS = "/documents";
const MAX_BODY_BYTES = 32_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw badRequest("Request body is too large");
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw badRequest("Request body must be a JSON object");
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw badRequest("Request body must be valid JSON");
  }
}

/** `/api/runs/imports/jira-x/retry` → `{ id: "imports/jira-x", action: "retry" }`. */
function splitRunAction(path: string): { id: string; action: string } {
  const segments = path.slice(API_RUNS.length).split("/").filter(Boolean);
  const action = segments.pop();
  if (!action || segments.length === 0) throw badRequest("Expected /api/runs/<id>/<action>");
  return { id: segments.join("/"), action };
}

async function route(request: Request, config: Config): Promise<Response> {
  const url = new URL(request.url);
  // The pathname keeps `%2F` from ids like `imports/jira-x`; decode before matching.
  const path = decodeURIComponent(url.pathname);

  if (request.method === "GET" && path === "/api/runs") {
    return json(await listRuns(config));
  }
  if (request.method === "GET" && path === "/api/config") {
    // Only what the UI needs to label itself; never paths or launcher location.
    return json({
      title: config.title,
      sourceLabel: config.sourceLabel,
      canLaunch: config.launcher !== null,
    });
  }
  if (request.method === "GET" && path === "/api/questions") {
    return json(await listOpenQuestions(config));
  }
  if (request.method === "GET" && path.startsWith(API_RUNS)) {
    const rest = path.slice(API_RUNS.length);
    // Document ids contain slashes, so they are split off before the run id is read.
    const marker = rest.indexOf(DOCUMENTS);
    if (marker !== -1) {
      const runId = rest.slice(0, marker);
      const documentId = rest.slice(marker + DOCUMENTS.length).replace(/^\//, "");
      return json(
        documentId ? await readDocument(config, runId, documentId) : await listDocuments(config, runId),
      );
    }
    return json(await getRun(config, rest));
  }
  if (request.method === "POST" && path === "/api/start") {
    return json(await startRun(config, await readBody(request)));
  }
  if (request.method === "POST" && path.startsWith(API_RUNS)) {
    const { id, action } = splitRunAction(path);
    const body = await readBody(request);
    if (action === "retry") return json(await retryRun(config, id, body));
    if (action === "reply") return json(await replyToQuestion(config, id, body));
    throw badRequest(`Unknown run action: ${action}`);
  }
  if (path.startsWith("/api/")) throw badRequest(`Unknown endpoint: ${path}`);

  return await serveDir(request, {
    fsRoot: PUBLIC_DIR,
    quiet: true,
    headers: ["cache-control: no-store"],
  });
}

/** Builds the request handler. Exported separately from `main.ts` so tests can drive it directly. */
export function createHandler(config: Config): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      return await route(request, config);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      if (error instanceof Deno.errors.NotCapable) {
        // The process was started with narrower --allow-* flags than the configured
        // runs root or launcher needs. Say so instead of returning an opaque 500.
        return json({ error: `Permission denied by Deno sandbox: ${error.message}` }, 403);
      }
      console.error("Unhandled request error:", error);
      return json({ error: "Internal server error" }, 500);
    }
  };
}
