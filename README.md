# runboard

[![CI](https://github.com/hogivano/runboard/actions/workflows/ci.yml/badge.svg)](https://github.com/hogivano/runboard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Deno 2](https://img.shields.io/badge/deno-2.x-000?logo=deno)](https://deno.com)

A local web dashboard for multi-agent pipeline runs. It shows each run's stages, lets you read everything the
agents wrote, and lets you answer an agent that stopped to ask a question.

runboard reads a [documented run directory format](docs/RUN_FORMAT.md). It works with any runner that writes
that format; it does not run agents itself.

> **Status:** the format was extracted from a private multi-agent runner built on
> [Hermes Agent](https://github.com/NousResearch/hermes-agent). No public runner emits it yet, so today
> runboard is for people writing their own runner — the spec is the contract to target. The synthetic runs in
> `tests/fixtures/runs` show what a conforming runner writes, and you can point runboard at them to try it.

> **Looking for a monitor of Hermes Agent itself** — sessions, token costs, cron, gateway? That is
> [hermesd](https://github.com/mudrii/hermesd). runboard covers a different layer: pipelines of agents built
> on top.

## What it writes and runs

Read this before pointing runboard at your machine. Unlike a read-only monitor, runboard:

- **writes** two files inside a run's directory when you answer a question: `feedback.md` and `answers.jsonl`.
  It never creates run directories.
- **starts a process** — your runner's CLI — when you start or re-run a run, **only if a launcher is
  configured**. With no launcher, runboard never starts your runner; it reads runs and records answers.
- **reads** files in each run's git worktree, limited to untracked text files the run created, and runs
  `git status` there to find them — even with no launcher configured. Paths are resolved and checked to stay
  inside the run or its worktree.
- listens on `127.0.0.1` only, with no authentication. Do not expose it on a network.

## Quick start

Requires [Deno](https://deno.com) 2.x.

```bash
git clone https://github.com/hogivano/runboard.git && cd runboard
RUNBOARD_RUNS_ROOT=tests/fixtures/runs deno task start   # try it on the sample runs
```

Open <http://127.0.0.1:4177>. Point `RUNBOARD_RUNS_ROOT` at your own runner's runs directory when you have
one.

To build a single self-contained binary:

```bash
deno task compile
./dist/runboard
```

## Configuration

Zero configuration reads `~/.runboard/runs` and never launches anything. To configure, copy
[`runboard.config.example.json`](runboard.config.example.json) to `runboard.config.json` (git-ignored) or
point `RUNBOARD_CONFIG` at a file. Environment variables override the file.

| Config file          | Environment                       | Default              | Purpose                                  |
| -------------------- | --------------------------------- | -------------------- | ---------------------------------------- |
| `runsRoot`           | `RUNBOARD_RUNS_ROOT`              | `~/.runboard/runs`   | Directory your runner writes runs into   |
| `launcher`           | `RUNBOARD_LAUNCHER`               | none                 | Runner CLI used to start and re-run runs |
| `launchCwd`          | `RUNBOARD_LAUNCH_CWD`             | working directory    | Directory the launcher runs in           |
| `title`              | `RUNBOARD_TITLE`                  | `runboard`           | Dashboard heading                        |
| `sourceLabel`        | `RUNBOARD_SOURCE_LABEL`           | `task`               | Name of your task source, e.g. `Jira`    |
| `stages`             | —                                 | from each run        | Stage order and labels; see below        |
| `staleImportMinutes` | `RUNBOARD_STALE_IMPORT_MINUTES`   | `10`                 | When a silent import counts as stale     |
| `host` / `port`      | `RUNBOARD_HOST` / `RUNBOARD_PORT` | `127.0.0.1` / `4177` | Bind address                             |

Paths accept `~`; relative paths in the config file resolve against the file's directory.

**Stages.** A run draws the stages it actually executed, labelled `role · stage`, so no configuration is
needed. List `stages` to fix their order, give them friendlier labels, and show stages a run has not reached
yet:

```json
{ "stages": ["intake", { "id": "build", "label": "Builder · code" }, "review"] }
```

## Answering an agent

A stage can report `needs_input` or `blocked`. Those runs appear under **Open questions** with the agent's own
words, and the reply box records your answer.

How an answer reaches an agent depends on whether the run is still going:

- **Live run** — the answer is appended to `feedback.md`, which the runner reads when it builds the next stage
  prompt.
- **Stopped run** — a runner that exits on a question has nothing left to read the file. Recording the answer
  stores it and nothing more. **Answer and re-run** starts a fresh run with the answer passed as `--feedback`.

runboard says which of the two happened instead of reporting success either way, and shows which stages a
re-run would replay before you click. A re-run reuses the brief the original import produced, so answering
does not pay for re-reading the task; tick _Re-read the task_ to refresh it.

## Agent documents

Each run lists the documents its agents wrote:

- every stage's `prompt.md`, `report.json` and `output.log`;
- notes left in the run's git worktree — its untracked files, which separates them from repository files like
  `CLAUDE.md` without guessing from filenames.

## Permissions

`deno task start` grants `--allow-read --allow-write --allow-run`, because the paths come from configuration
and `deno task` cannot scope a flag to a configured value. To tighten a fixed install, run it directly:

```bash
deno run --allow-env --allow-net=127.0.0.1 \
  --allow-read --allow-write=$HOME/.my-runner/runs \
  --allow-run=/bin/sh,git src/main.ts
```

`/bin/sh` starts the launcher detached from runboard, so stopping runboard with Ctrl-C does not kill a run
mid-stage. `git` lists worktree notes. A request the sandbox blocks answers `403` naming the missing
permission.

## Development

```bash
deno task dev     # watch mode
deno task test    # unit and API tests over synthetic fixture runs
deno task check   # type check, lint, format check
```

```
src/config.ts     config file + environment → Config
src/types.ts      the run format's shapes          ← update with docs/RUN_FORMAT.md
src/jsonl.ts      tolerant JSONL reading (logs are read while being appended)
src/runs.ts       run list, run detail, stage graph
src/questions.ts  open questions, and how an answer can reach an agent
src/documents.ts  agent documents from the run directory and worktree
src/actions.ts    start / reply / re-run, and the launcher spawn
src/server.ts     routing and error → HTTP status mapping
public/           dashboard page, styles and client script
tests/            tests over copied fixtures with a stub launcher
```

Tests copy `tests/fixtures` into a temporary directory and use a stub launcher that records its arguments, so
no test reads your real runs or starts a real agent.

## API

| Method | Path                              | Notes                                                                     |
| ------ | --------------------------------- | ------------------------------------------------------------------------- |
| `GET`  | `/api/config`                     | Title, source label and whether a launcher is configured                  |
| `GET`  | `/api/runs`                       | Summaries, newest activity first                                          |
| `GET`  | `/api/runs/<id>`                  | Detail, including the stage graph; ids containing `/` must be URL-encoded |
| `GET`  | `/api/questions`                  | Runs waiting on an answer, with the asking agent and replay cost          |
| `GET`  | `/api/runs/<id>/documents`        | Documents written by this run's agents                                    |
| `GET`  | `/api/runs/<id>/documents/<path>` | One document's text                                                       |
| `POST` | `/api/start`                      | `{ task, repo? }`                                                         |
| `POST` | `/api/runs/<id>/reply`            | `{ answer, relaunch?, repo?, refreshTask? }`                              |
| `POST` | `/api/runs/<id>/retry`            | `{ repo?, feedback?, refreshTask? }`                                      |

Errors are `{ "error": "..." }` with `400` (bad input or no launcher), `403` (sandbox), `404` (no such run) or
`409` (run still active).

## License

[MIT](LICENSE)
