/** Launcher that starts the runner CLI as a detached process. */
import type { Launcher, LaunchResult } from "../../application/ports.ts";
import { LauncherUnavailableError, LaunchFailedError } from "../../domain/errors.ts";

/**
 * `Deno.Command` has no `detached` option, so a plain spawn would put the run in runboard's
 * process group, and Ctrl-C in runboard's terminal would kill it mid-stage. `sh` ignores
 * SIGINT and SIGHUP, then `exec`s the runner; an ignored disposition survives exec.
 *
 * The runner's output goes to a log file rather than a pipe: runboard stops reading once the
 * launch is confirmed, and a runner writing into an abandoned pipe would die of SIGPIPE.
 */
const DETACH_SHELL = "/bin/sh";
const DETACH_SCRIPT = 'trap "" INT HUP; log=$1; shift; exec "$@" >>"$log" 2>&1';

/** How long a launch waits for a runner that refuses its arguments to exit. */
const DEFAULT_REFUSAL_WINDOW_MS = 2_000;
const LOG_TAIL_BYTES = 4_096;

export class ShellLauncher implements Launcher {
  /**
   * @param logDir where each launch's output is kept; created on first launch.
   * @param refusalWindowMs how long to wait for a runner that refuses to exit.
   */
  constructor(
    private readonly executable: string | null,
    private readonly cwd: string,
    private readonly logDir: string,
    private readonly refusalWindowMs = DEFAULT_REFUSAL_WINDOW_MS,
  ) {}

  get configured(): boolean {
    return this.executable !== null;
  }

  async ensureReady(): Promise<void> {
    await this.requireExecutable();
  }

  /**
   * Starts the runner and waits briefly for it to refuse. A runner validates its arguments
   * before doing any work — a run that cannot resume, a missing login — and exits at once;
   * without this wait the user would be told the answer was sent to a run that never began.
   */
  async start(args: string[]): Promise<LaunchResult> {
    const executable = await this.requireExecutable();
    await Deno.mkdir(this.logDir, { recursive: true });
    const log = await Deno.makeTempFile({ dir: this.logDir, prefix: "launch-", suffix: ".log" });
    const child = new Deno.Command(DETACH_SHELL, {
      // Arguments stay a list: nothing typed into the dashboard is ever parsed by a shell.
      args: ["-c", DETACH_SCRIPT, "runboard-launch", log, executable, ...args],
      cwd: this.cwd,
      stdin: "null",
      stdout: "null",
      stderr: "null",
    }).spawn();
    child.unref();
    // The run owns its lifetime; ignore a later exit so no unhandled rejection is left behind.
    const exited = child.status.catch(() => null);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const stillRunning = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), this.refusalWindowMs);
    });
    const status = await Promise.race([exited, stillRunning]);
    clearTimeout(timer);

    if (status && !status.success) {
      const output = await tail(log);
      throw new LaunchFailedError(
        `The runner exited with code ${status.code}` + (output ? `: ${output}` : ` (log: ${log})`),
      );
    }
    return { pid: child.pid, command: [executable, ...args], log };
  }

  /** Fails with a readable message rather than a shell exit code of 127. */
  private async requireExecutable(): Promise<string> {
    const executable = this.executable;
    if (!executable) {
      throw new LauncherUnavailableError(
        "No launcher is configured, so runboard cannot start runs. Set RUNBOARD_LAUNCHER or " +
          "`launcher` in runboard.config.json.",
      );
    }
    let info: Deno.FileInfo;
    try {
      info = await Deno.stat(executable);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new LauncherUnavailableError(
          `Launcher not found at ${executable}. Set RUNBOARD_LAUNCHER to the runner CLI path.`,
        );
      }
      throw error;
    }
    if (!info.isFile) throw new LauncherUnavailableError(`Launcher at ${executable} is not a file`);
    if (info.mode !== null && (info.mode & 0o111) === 0) {
      throw new LauncherUnavailableError(`Launcher at ${executable} is not executable`);
    }
    return executable;
  }
}

/** The last lines a refusing runner printed, which is where it says why. */
async function tail(path: string): Promise<string> {
  try {
    const text = await Deno.readTextFile(path);
    const lines = text.slice(-LOG_TAIL_BYTES).split("\n").map((line) => line.trim()).filter(Boolean);
    return lines.slice(-3).join(" ");
  } catch {
    return "";
  }
}
