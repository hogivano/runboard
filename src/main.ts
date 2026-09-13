/** Entry point: resolves configuration and serves the dashboard on the loopback interface. */
import { type Config, loadConfig } from "./config.ts";
import { createHandler } from "./server.ts";

/** Starts the dashboard server. Exported so the demo can run it on a copy of the sample runs. */
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
