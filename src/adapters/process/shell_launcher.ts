/** Launcher that starts the runner CLI as a detached process. */
import type { Launcher, LaunchResult } from "../../application/ports.ts";
import { LauncherUnavailableError } from "../../domain/errors.ts";

/**
 * `Deno.Command` has no `detached` option, so a plain spawn would put the run in runboard's
 * process group, and Ctrl-C in runboard's terminal would kill it mid-stage. `sh` ignores
 * SIGINT and SIGHUP, then `exec`s the runner; an ignored disposition survives exec.
 */
const DETACH_SHELL = "/bin/sh";
const DETACH_SCRIPT = 'trap "" INT HUP; exec "$@"';

export class ShellLauncher implements Launcher {
  constructor(private readonly executable: string | null, private readonly cwd: string) {}

  get configured(): boolean {
    return this.executable !== null;
  }

  async ensureReady(): Promise<void> {
    await this.requireExecutable();
  }

  async start(args: string[]): Promise<LaunchResult> {
    const executable = await this.requireExecutable();
    const child = new Deno.Command(DETACH_SHELL, {
      // Arguments stay a list: nothing typed into the dashboard is ever parsed by a shell.
      args: ["-c", DETACH_SCRIPT, "runboard-launch", executable, ...args],
      cwd: this.cwd,
      stdin: "null",
      stdout: "null",
      stderr: "null",
    }).spawn();
    child.unref();
    // The run owns its lifetime; ignore its exit so no unhandled rejection is left behind.
    child.status.catch(() => {});
    return { pid: child.pid, command: [executable, ...args] };
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
