/**
 * Errors the business rules raise. They say what went wrong in domain terms; mapping them
 * to a transport (HTTP status codes) is the job of an adapter, not of the rules.
 */
export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The caller supplied something unusable: a bad id, an empty answer, an unreadable file type. */
export class InvalidInputError extends DomainError {}

/** The run, import or document does not exist. */
export class NotFoundError extends DomainError {}

/** The request is valid but conflicts with the run's current state, e.g. re-running a live run. */
export class ConflictError extends DomainError {}

/** An action needs the runner CLI and it is not configured or cannot be executed. */
export class LauncherUnavailableError extends DomainError {}

/** The runner started but exited at once with an error, so the run never began. */
export class LaunchFailedError extends DomainError {}
