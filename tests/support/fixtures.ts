import { copy } from "@std/fs";
import { fromFileUrl, join } from "@std/path";
import type { Application } from "../../src/application/app.ts";
import type { Config } from "../../src/adapters/config/config.ts";
import { createApp } from "../../src/main.ts";

const FIXTURE_RUNS = fromFileUrl(new URL("../fixtures/runs", import.meta.url));
const FIXTURE_WORKSPACE = fromFileUrl(new URL("../fixtures/workspace", import.meta.url));

export interface TestEnv extends AsyncDisposable {
  config: Config;
  /** The application wired with production adapters over the throwaway runs root. */
  app: Application;
  /** Absolute path of the throwaway runs root, safe to write into. */
  runsRoot: string;
  /** Git worktree used by `run-recorded`, holding one tracked and one untracked file. */
  workspace: string;
  /** Brief recorded by `run-recorded`; exists until a test removes it. */
  briefPath: string;
  /**
   * Arguments captured by the stub launcher, one entry per launch. Pass `expect` to
   * wait for that many launches instead of racing the detached child.
   */
  launchedArgs(options?: { expect?: number; timeoutMs?: number }): Promise<string[][]>;
}

/**
 * Copies the fixture runs into a temp directory and points the config at a stub
 * launcher, so no test can write into the real Hermes runs dir or start an agent.
 */
export async function withFixtures(overrides: Partial<Config> = {}): Promise<TestEnv> {
  const base = await Deno.makeTempDir({ prefix: "runboard-test-" });
  const runsRoot = join(base, "runs");
  await copy(FIXTURE_RUNS, runsRoot);

  // mtimes do not survive git or `copy`, so age the abandoned import explicitly:
  // its staleness is what the fixture is there to express.
  const longAgo = new Date(Date.now() - 24 * 60 * 60_000);
  await Deno.utime(join(runsRoot, "imports/tracker-demo42-dead00/output.jsonl"), longAgo, longAgo);

  // A git worktree for the run that has one: CLAUDE.md is committed (a repo file) and
  // the agent note is left untracked, which is how documents.ts tells them apart.
  const workspace = join(base, "workspace");
  await copy(FIXTURE_WORKSPACE, workspace);
  const git = (...args: string[]) =>
    new Deno.Command("git", { args: ["-C", workspace, ...args], stdout: "null", stderr: "null" })
      .output();
  await git("init", "-q");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "test");
  await git("add", "CLAUDE.md");
  await git("commit", "-qm", "repo file");

  const recordedState = join(runsRoot, "run-recorded/state.json");
  const recorded = JSON.parse(await Deno.readTextFile(recordedState));
  recorded.workspace = workspace;
  // A real brief inside the sandbox, so a re-run test never depends on a global /tmp file.
  const briefPath = join(base, "brief.md");
  await Deno.writeTextFile(briefPath, "# Brief\n\nExport retries.\n");
  recorded.brief_path = briefPath;
  await Deno.writeTextFile(recordedState, JSON.stringify(recorded, null, 2));

  const launchLog = join(base, "launched.jsonl");
  const launcher = join(base, "stub-launcher");
  await Deno.writeTextFile(
    launcher,
    `#!/bin/sh\nprintf '%s\\n' "$(printf '"%s",' "$@")" >> ${launchLog}\n`,
  );
  await Deno.chmod(launcher, 0o755);

  const config: Config = {
    runsRoot,
    launcher,
    launchCwd: base,
    host: "127.0.0.1",
    port: 0,
    staleImportMs: 10 * 60_000,
    title: "runboard test",
    sourceLabel: "tracker",
    stages: [],
    ...overrides,
  };

  return {
    runsRoot,
    workspace,
    briefPath,
    config,
    app: createApp(config),
    async launchedArgs({ expect = 0, timeoutMs = 5000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      let launches: string[][] = [];
      do {
        const raw = await Deno.readTextFile(launchLog).catch(() => "");
        launches = raw.split("\n").filter(Boolean).map((line) =>
          line.split(",").filter(Boolean).map((part) => part.replace(/^"|"$/g, ""))
        );
        if (launches.length >= expect) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      } while (Date.now() < deadline);
      return launches;
    },
    async [Symbol.asyncDispose]() {
      // A detached stub launcher can still be appending to its log when a test ends; on
      // Linux that makes a recursive remove fail with ENOTEMPTY, so retry briefly.
      for (let attempt = 0;; attempt++) {
        try {
          await Deno.remove(base, { recursive: true });
          return;
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) return;
          if (attempt >= 20) throw error;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
    },
  };
}
