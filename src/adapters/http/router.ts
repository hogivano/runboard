/**
 * HTTP adapter: turns requests into use case calls and results into JSON. It holds no
 * business rules; everything it does is parsing, dispatch and serialisation.
 */
import { serveDir } from "@std/http/file-server";
import type { Application } from "../../application/app.ts";
import { BadRequest, errorResponse, json } from "./errors.ts";

const API_RUNS = "/api/runs/";
const DOCUMENTS = "/documents";
const MAX_BODY_BYTES = 32_000;

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new BadRequest("Request body is too large");
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequest("Request body must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new BadRequest("Request body must be a JSON object");
  return parsed as Record<string, unknown>;
}

/** `/api/runs/imports/jira-x/retry` → `{ id: "imports/jira-x", action: "retry" }`. */
function splitRunAction(path: string): { id: string; action: string } {
  const segments = path.slice(API_RUNS.length).split("/").filter(Boolean);
  const action = segments.pop();
  if (!action || segments.length === 0) throw new BadRequest("Expected /api/runs/<id>/<action>");
  return { id: segments.join("/"), action };
}

async function route(request: Request, app: Application, publicDir: string): Promise<Response> {
  // The pathname keeps `%2F` from ids like `imports/jira-x`; decode before matching.
  const path = decodeURIComponent(new URL(request.url).pathname);
  const { method } = request;

  if (method === "GET" && path === "/api/config") return json(app.publicSettings());
  if (method === "GET" && path === "/api/runs") return json(await app.listRuns());
  if (method === "GET" && path === "/api/questions") return json(await app.listOpenQuestions());
  if (method === "GET" && path.startsWith(API_RUNS)) {
    const rest = path.slice(API_RUNS.length);
    // Document ids contain slashes, so they are split off before the run id is read.
    const marker = rest.indexOf(DOCUMENTS);
    if (marker === -1) return json(await app.getRun(rest));
    const runId = rest.slice(0, marker);
    const documentId = rest.slice(marker + DOCUMENTS.length).replace(/^\//, "");
    return json(
      documentId ? await app.readDocument(runId, documentId) : await app.listDocuments(runId),
    );
  }
  if (method === "POST" && path === "/api/start") {
    return json(await app.startRun(await readBody(request)));
  }
  if (method === "POST" && path.startsWith(API_RUNS)) {
    const { id, action } = splitRunAction(path);
    const body = await readBody(request);
    if (action === "retry") return json(await app.retryRun(id, body));
    if (action === "reply") return json(await app.replyToQuestion(id, body));
    throw new BadRequest(`Unknown run action: ${action}`);
  }
  if (path.startsWith("/api/")) throw new BadRequest(`Unknown endpoint: ${path}`);

  return await serveDir(request, { fsRoot: publicDir, quiet: true, headers: ["cache-control: no-store"] });
}

/** Builds the request handler for an application and the directory of static UI files. */
export function createHttpHandler(
  app: Application,
  publicDir: string,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await route(request, app, publicDir);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
