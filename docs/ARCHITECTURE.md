# Architecture

runboard follows the Clean Architecture dependency rule: source code dependencies point inward only. Business
rules never know about the filesystem, git, processes or HTTP.

```
┌──────────────────────────────────────────────┐
│ main.ts            composition root          │
│  ┌────────────────────────────────────────┐  │
│  │ adapters/     http · filesystem ·      │  │
│  │               process · config         │  │
│  │  ┌──────────────────────────────────┐  │  │
│  │  │ application/  use cases · ports  │  │  │
│  │  │  ┌────────────────────────────┐  │  │  │
│  │  │  │ domain/  entities · rules  │  │  │  │
│  │  │  └────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────┘  │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

`tests/architecture_test.ts` enforces this: any import that points outward, and any use of `Deno.*` or an I/O
library in `domain/` or `application/`, fails the build.

## Layers

### `src/domain/` — entities and business rules

Plain TypeScript, no runtime APIs. What a run is and how it is interpreted:

| Module          | Rules                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `run.ts`        | The run record, statuses, run and import ids, which stage asked, which stages a re-run replays   |
| `stage.ts`      | Building the stage graph from history and configured stages; stage folder names                  |
| `import_log.ts` | Import status (completed / failed / running / stale) and its activity entries                    |
| `document.ts`   | Which documents may be served, document id parsing, symlink-safe containment                     |
| `rerun.ts`      | Re-run inputs (brief reuse, task re-read, repository), answer validation, what "delivered" means |
| `question.ts`   | Turning a waiting run into an open question                                                      |
| `errors.ts`     | `InvalidInputError`, `NotFoundError`, `ConflictError`, `LauncherUnavailableError`                |

Domain errors describe what went wrong, never an HTTP status.

### `src/application/` — use cases and ports

One module per use case in `use_cases/`: `list_runs`, `get_run`, `list_open_questions`, `list_documents`,
`read_document`, `start_run`, `retry_run`, `reply_to_question`. Each takes an `AppContext` and returns a view
model from `views.ts`.

`ports.ts` declares what the use cases need from outside, as interfaces:

| Port               | Responsibility                                                | Production adapter    |
| ------------------ | ------------------------------------------------------------- | --------------------- |
| `RunStore`         | Read run records, import streams and activity; append answers | `FsRunStore`          |
| `DocumentStore`    | List and read document files within a root                    | `FsDocumentStore`     |
| `WorkspaceScanner` | Untracked files in a run's worktree                           | `GitWorkspaceScanner` |
| `Launcher`         | Start the runner CLI                                          | `ShellLauncher`       |

`app.ts` binds every use case to its context and exposes the `Application` interface — the input boundary
driving adapters call.

### `src/adapters/` — interface adapters

- `http/` — `router.ts` parses requests, calls the `Application`, serialises results; `errors.ts` is the only
  place that maps errors to status codes.
- `filesystem/` — the run directory format (docs/RUN_FORMAT.md) read and written from disk.
- `process/` — the detached shell launcher and the git scanner.
- `config/` — configuration file and environment variables.

### `src/main.ts` — composition root

The only module that names concrete adapters. It builds them from configuration, passes them to
`createApplication`, and serves HTTP.

## Adding a feature

1. Put the rule in `domain/` with a pure unit test in `tests/domain/`.
2. Add a use case in `application/use_cases/`. If it needs something new from the outside world, add it to a
   port in `ports.ts` rather than calling `Deno` directly.
3. Test the use case against the in-memory fakes in `tests/support/fakes.ts`.
4. Implement the port in an adapter, and route to the use case in `adapters/http/router.ts`.
5. Wire any new adapter in `main.ts`.

## Tests

| Folder                       | What it covers                              | Uses                               |
| ---------------------------- | ------------------------------------------- | ---------------------------------- |
| `tests/domain/`              | Business rules                              | Plain values                       |
| `tests/application/`         | Use cases                                   | In-memory fakes, no filesystem     |
| `tests/integration/`         | Use cases with the real filesystem adapters | Copied fixture runs                |
| `tests/adapters/`            | HTTP routes and status codes, configuration | Copied fixture runs, stub launcher |
| `tests/ui/`                  | Client-side control logic                   | Plain values                       |
| `tests/architecture_test.ts` | The dependency rule                         | Source files                       |
