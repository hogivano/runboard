/** Maps failures to HTTP responses. The only place that knows about status codes. */
import {
  ConflictError,
  InvalidInputError,
  LauncherUnavailableError,
  LaunchFailedError,
  NotFoundError,
} from "../../domain/errors.ts";

/** A request the router itself cannot accept: bad JSON, unknown endpoint. */
export class BadRequest extends Error {}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function statusFor(error: unknown): number | null {
  if (error instanceof BadRequest) return 400;
  if (error instanceof InvalidInputError) return 400;
  if (error instanceof LauncherUnavailableError) return 400;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  // The runner is the upstream here: it was reached and refused.
  if (error instanceof LaunchFailedError) return 502;
  return null;
}

export function errorResponse(error: unknown): Response {
  const status = statusFor(error);
  if (status !== null) return json({ error: (error as Error).message }, status);
  if (error instanceof Deno.errors.NotCapable) {
    // Started with narrower --allow-* flags than the configured runs root or launcher needs.
    return json({ error: `Permission denied by Deno sandbox: ${error.message}` }, 403);
  }
  console.error("Unhandled request error:", error);
  return json({ error: "Internal server error" }, 500);
}
