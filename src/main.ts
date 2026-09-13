/** Entry point: resolves configuration and serves the dashboard on the loopback interface. */
import { loadConfig } from "./config.ts";
import { createHandler } from "./server.ts";

if (import.meta.main) {
  const config = loadConfig();
  Deno.serve(
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
