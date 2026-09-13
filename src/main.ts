/**
 * Composition root: the one place that knows every concrete adapter. It reads configuration,
 * builds the adapters, hands them to the application as ports, and serves HTTP.
 */
import { fromFileUrl } from "@std/path";
import { type Application, createApplication } from "./application/app.ts";
import { type Config, loadConfig } from "./adapters/config/config.ts";
import { FsDocumentStore } from "./adapters/filesystem/fs_document_store.ts";
import { FsRunStore } from "./adapters/filesystem/fs_run_store.ts";
import { createHttpHandler } from "./adapters/http/router.ts";
import { GitWorkspaceScanner } from "./adapters/process/git_workspace_scanner.ts";
import { ShellLauncher } from "./adapters/process/shell_launcher.ts";

const PUBLIC_DIR = fromFileUrl(new URL("../public", import.meta.url));

/** Wires the production adapters into the application. */
export function createApp(config: Config): Application {
  return createApplication({
    runs: new FsRunStore(config.runsRoot),
    documents: new FsDocumentStore(config.runsRoot),
    workspaces: new GitWorkspaceScanner(),
    launcher: new ShellLauncher(config.launcher, config.launchCwd),
    settings: {
      title: config.title,
      sourceLabel: config.sourceLabel,
      staleImportMs: config.staleImportMs,
      stages: config.stages,
    },
    now: () => new Date(),
  });
}

/** The HTTP handler for a configuration. Tests drive this without opening a socket. */
export function createHandler(config: Config): (request: Request) => Promise<Response> {
  return createHttpHandler(createApp(config), PUBLIC_DIR);
}

/** Starts the dashboard server. */
export function serve(config: Config): Deno.HttpServer {
  return Deno.serve(
    {
      hostname: config.host,
      port: config.port,
      onListen: ({ hostname, port }) => {
        console.log(`runboard: http://${hostname}:${port}`);
        console.log(`Runs root: ${config.runsRoot}`);
        console.log(`Launcher:  ${config.launcher ?? "none (read-only: cannot start runs)"}`);
      },
    },
    createHandler(config),
  );
}

if (import.meta.main) serve(loadConfig());
