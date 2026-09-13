/** An error carrying the HTTP status the API should answer with. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message: string) => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

/** Run ids are path segments under the runs root: `run-abc123` or `imports/<source>-<task>-<suffix>`. */
const RUN_ID = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?$/;

/** Validates an id before it is joined onto the runs root. Rejects `.`, `..` and absolute paths. */
export function assertRunId(id: string): string {
  if (!RUN_ID.test(id)) throw badRequest(`Invalid run id: ${JSON.stringify(id)}`);
  return id;
}
