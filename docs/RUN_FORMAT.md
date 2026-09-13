# Run directory format

runboard does not run agents. It reads the directory a pipeline runner writes, and calls that runner's CLI to
start or re-run work. Any runner that writes this layout works with runboard. The format was extracted from a
private sequential multi-agent runner built on [Hermes Agent](https://github.com/NousResearch/hermes-agent);
this document is the contract, independent of it. `tests/fixtures/runs` holds a small conforming example.

Everything below is relative to the runs root (`RUNBOARD_RUNS_ROOT`).

```
<runs root>/
  <run-id>/                      one pipeline run
    state.json                   required — the run's current state
    events.jsonl                 optional — activity log, appended live
    NN-<stage>-<role>/           optional — one folder per executed stage
      prompt.md                  what the agent was asked
      report.json                what it reported (same shape as history[].report)
      output.log                 raw agent output
    feedback.md                  written by runboard, read by the runner
    answers.jsonl                written by runboard only
  .runboard/launches/            written by runboard: output of each runner it started
  imports/                       optional
    <source>-<task-id>-<suffix>/ one read of a task from its source
      output.jsonl               agent stream; ends with a {"type":"result"} line
      brief.md                   the brief the import produced
```

Run ids and import folder names must match `[A-Za-z0-9_-]+`.

## `state.json`

| Field                 | Type     | Required | Meaning                                                                            |
| --------------------- | -------- | -------- | ---------------------------------------------------------------------------------- |
| `status`              | string   | yes      | One of the run statuses below                                                      |
| `history`             | array    | yes      | One entry per executed stage, in order; a stage may repeat                         |
| `active_stage`        | string   | no       | Stage currently running, or the one that stopped the run                           |
| `stage_queue`         | array    | no       | Stages still queued after `active_stage`; recording it lets a halted run resume    |
| `started_at`          | ISO 8601 | no       | Run start                                                                          |
| `workspace`           | path     | no       | Git worktree the agents work in; its untracked files are listed as agent documents |
| `repository`          | path     | no       | Repository a re-run should use; if absent the user is asked                        |
| `brief_path`          | path     | no       | Brief a re-run can reuse                                                           |
| `input_source`        | object   | no       | `{ type, task_id, path }` — where the task came from; `path` is the import folder  |
| `stage_calls`         | number   | no       | Agent calls so far                                                                 |
| `runner_prompt_chars` | number   | no       | Prompt size so far                                                                 |
| `reason`              | string   | no       | Why the runner blocked, when it failed on an error rather than a report            |

### Run statuses

| Status                     | Meaning in runboard                                                           |
| -------------------------- | ----------------------------------------------------------------------------- |
| `running`                  | Live; cannot be re-run                                                        |
| `needs_input`              | An agent stopped to ask a question — listed under **Open questions**          |
| `blocked`                  | The run cannot continue — also listed under **Open questions**, with `reason` |
| `ready_for_manager_review` | Finished, waiting for a human to review                                       |

Anything else is shown as `unknown`.

### `history[]`

```json
{
  "stage": "intake",
  "role": "analyst",
  "engine": "claude",
  "model": "sonnet",
  "report": {
    "status": "needs_input",
    "summary": "Free text. The question, if any, lives here.",
    "artifacts": [],
    "issues": [],
    "acceptance_criteria": [],
    "test_cases": [],
    "evidence": []
  },
  "diff_stat": "3 files changed"
}
```

`report.status` is one of `pass`, `fail`, `needs_input`, `blocked`. Only `stage`, `role` and `report.status`
are used to draw the stage graph; `summary` is what an open question shows.

## `events.jsonl`

One JSON object per line: `{ "time": ISO 8601, "message": string, "stage"?, "role"?, "status"? }`. Lines that
fail to parse are skipped, so a line torn by a concurrent write is harmless.

## Imports

An import folder is a separate agent run that reads a task from a tracker before the pipeline starts. It is
`completed` once `output.jsonl` has a `result` line (`failed` when that line has `"is_error": true`), and
`stale` if it has neither a result nor any writes for `staleImportMinutes`. An import referenced by a run's
`input_source.path` is shown as part of that run instead of on its own.

## Written by runboard

- **`feedback.md`** — every answer is appended under a `## Answer <time>` heading. A runner should read this
  file when it builds each stage prompt. Answers written after the runner has exited are not read until the
  run is started again.
- **`answers.jsonl`** — `{ time, run, stage, status, answer }` per answer. Runners should not depend on it; it
  is the record of what was answered.

## Launcher contract

When a launcher is configured, runboard invokes it with an argument list (never a shell string):

| Action                          | Arguments                                          |
| ------------------------------- | -------------------------------------------------- |
| Start                           | `<task-url-or-id> [--repo <path>]`                 |
| Re-run, reusing the saved brief | `--brief <path> --repo <path> [--feedback <text>]` |
| Re-run, re-reading the task     | `<task-id> --repo <path> [--feedback <text>]`      |
| Resume a halted run (optional)  | `--resume <run-dir>`                               |

`--feedback` carries the user's answer into the new run.

**Resume** is used only when `resume` is enabled in runboard's configuration, for a run whose `status` is
`needs_input` or `blocked`, that names its `active_stage`, and that either records `stage_queue` or halted on
its first stage. The runner should run `active_stage` again in the run's existing directory and worktree, then
continue with `stage_queue`. No `--feedback` is passed: the answer is already appended to that run's
`feedback.md`, which the runner rereads for every stage.

A runner that cannot act on its arguments should exit non-zero within two seconds, printing the reason as its
last line. runboard reports that reason to the user and does not say the run started. The launcher is started
through `/bin/sh`, detached from runboard's signals, so stopping runboard does not stop the run.
