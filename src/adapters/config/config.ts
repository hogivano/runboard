import { isAbsolute, join, resolve } from "@std/path";
import type { StageSpec } from "../../domain/stage.ts";

/** Everything runboard reads from the environment and config file, resolved once at boot. */
export interface Config {
  /** Heading shown in the dashboard. */
  title: string;
  /** Directory the runner writes run folders into. */
  runsRoot: string;
  /**
   * Runner CLI used to start and re-run runs. `null` disables every action that spawns a
   * process, so an unconfigured install only reads runs and records answers.
   */
  launcher: string | null;
  /**
   * The launcher accepts `--resume <run-dir>` to continue a halted run in place. Off by
   * default: answering then starts a fresh run carrying the answer.
   */
  resume: boolean;
  /** Working directory the launcher is spawned in. */
  launchCwd: string;
  host: string;
  port: number;
  /** An import with no result line and no file activity for this long is reported as stale. */
  staleImportMs: number;
  /** Name of the task source shown in the UI, e.g. "Jira" or "Linear". */
  sourceLabel: string;
  /**
   * Expected stage order. Runs always show the stages they actually executed; this only adds
   * ordering and labels, and lists stages that have not started yet.
   */
  stages: StageSpec[];
}

/** Shape of `runboard.config.json`. Every field is optional. */
export interface ConfigFile {
  title?: string;
  runsRoot?: string;
  launcher?: string | null;
  resume?: boolean;
  launchCwd?: string;
  host?: string;
  port?: number;
  staleImportMinutes?: number;
  sourceLabel?: string;
  stages?: (StageSpec | string)[];
}

type Env = (key: string) => string | undefined;

function home(env: Env): string {
  const value = env("HOME") ?? env("USERPROFILE");
  if (!value) throw new Error("HOME is not set; cannot resolve default paths");
  return value;
}

function expand(path: string, env: Env, base: string): string {
  const withHome = path === "~" || path.startsWith("~/") ? join(home(env), path.slice(1)) : path;
  return isAbsolute(withHome) ? withHome : resolve(base, withHome);
}

/** First non-empty value among the given environment variables. */
function pick(env: Env, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env(key);
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

/** A boolean environment value; undefined when unset, an error when it is not a boolean. */
function flag(env: Env, key: string): boolean | undefined {
  const value = pick(env, key);
  if (value === undefined) return undefined;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  throw new Error(`${key} must be true or false, got "${value}"`);
}

function readConfigFile(path: string): ConfigFile {
  try {
    return JSON.parse(Deno.readTextFileSync(path)) as ConfigFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return {};
    throw new Error(`Cannot read config file ${path}: ${(error as Error).message}`);
  }
}

function normaliseStages(stages: ConfigFile["stages"]): StageSpec[] {
  return (stages ?? []).map((stage) => typeof stage === "string" ? { id: stage } : stage)
    .filter((stage) => typeof stage.id === "string" && stage.id.length > 0);
}

/**
 * Resolves configuration. Precedence: environment, then the config file, then defaults.
 * The config file is `RUNBOARD_CONFIG` if set, otherwise `runboard.config.json` in the
 * working directory; a missing file is fine.
 */
export function loadConfig(env: Env = Deno.env.get, cwd: string = Deno.cwd()): Config {
  const configPath = expand(pick(env, "RUNBOARD_CONFIG") ?? "runboard.config.json", env, cwd);
  const file = readConfigFile(configPath);
  const base = configPath.slice(0, configPath.lastIndexOf("/")) || cwd;

  const runsRoot = pick(env, "RUNBOARD_RUNS_ROOT") ?? file.runsRoot;
  const launcher = pick(env, "RUNBOARD_LAUNCHER") ?? file.launcher ?? null;
  const launchCwd = pick(env, "RUNBOARD_LAUNCH_CWD") ?? file.launchCwd;
  const staleMinutes = pick(env, "RUNBOARD_STALE_IMPORT_MINUTES");

  return {
    title: pick(env, "RUNBOARD_TITLE") ?? file.title ?? "runboard",
    runsRoot: runsRoot ? expand(runsRoot, env, base) : join(home(env), ".runboard/runs"),
    launcher: launcher ? expand(launcher, env, base) : null,
    resume: flag(env, "RUNBOARD_RESUME") ?? file.resume === true,
    launchCwd: launchCwd ? expand(launchCwd, env, base) : cwd,
    host: pick(env, "RUNBOARD_HOST", "HOST") ?? file.host ?? "127.0.0.1",
    port: Number(pick(env, "RUNBOARD_PORT", "PORT") ?? file.port ?? 4177),
    staleImportMs: Number(staleMinutes ?? file.staleImportMinutes ?? 10) * 60_000,
    sourceLabel: pick(env, "RUNBOARD_SOURCE_LABEL") ?? file.sourceLabel ?? "task",
    stages: normaliseStages(file.stages),
  };
}
