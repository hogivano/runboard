import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { loadConfig } from "../../src/adapters/config/config.ts";

function envOf(values: Record<string, string>) {
  return (key: string) => values[key];
}

Deno.test("loadConfig defaults to a read-only install under the home directory", () => {
  const dir = Deno.makeTempDirSync();
  try {
    const config = loadConfig(envOf({ HOME: "/home/alex" }), dir);
    assertEquals(config.runsRoot, "/home/alex/.runboard/runs");
    assertEquals(config.launcher, null, "no launcher unless one is configured");
    assertEquals(config.stages, []);
    assertEquals(config.port, 4177);
    assertEquals(config.host, "127.0.0.1");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("loadConfig reads runboard.config.json, expanding ~ and relative paths", () => {
  const dir = Deno.makeTempDirSync();
  try {
    Deno.writeTextFileSync(
      join(dir, "runboard.config.json"),
      JSON.stringify({
        title: "Platform team",
        runsRoot: "~/pipelines/runs",
        launcher: "./bin/run-team",
        sourceLabel: "Jira",
        stages: ["intake", { id: "build", label: "Builder · code" }],
      }),
    );
    const config = loadConfig(envOf({ HOME: "/home/alex" }), dir);
    assertEquals(config.title, "Platform team");
    assertEquals(config.runsRoot, "/home/alex/pipelines/runs");
    assertEquals(config.launcher, join(dir, "bin/run-team"));
    assertEquals(config.sourceLabel, "Jira");
    assertEquals(config.stages, [{ id: "intake" }, { id: "build", label: "Builder · code" }]);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("environment variables override the config file", () => {
  const dir = Deno.makeTempDirSync();
  try {
    Deno.writeTextFileSync(
      join(dir, "runboard.config.json"),
      JSON.stringify({ runsRoot: "/from/file", port: 5000 }),
    );
    const config = loadConfig(
      envOf({ HOME: "/home/alex", RUNBOARD_RUNS_ROOT: "/from/env", RUNBOARD_PORT: "6000" }),
      dir,
    );
    assertEquals(config.runsRoot, "/from/env");
    assertEquals(config.port, 6000);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("RUNBOARD_CONFIG points at a config file elsewhere", () => {
  const dir = Deno.makeTempDirSync();
  try {
    const file = join(dir, "team.json");
    Deno.writeTextFileSync(file, JSON.stringify({ title: "From RUNBOARD_CONFIG" }));
    const config = loadConfig(envOf({ HOME: "/home/alex", RUNBOARD_CONFIG: file }), "/");
    assertEquals(config.title, "From RUNBOARD_CONFIG");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("a malformed config file fails loudly instead of silently using defaults", () => {
  const dir = Deno.makeTempDirSync();
  try {
    Deno.writeTextFileSync(join(dir, "runboard.config.json"), "{ not json");
    assertThrows(() => loadConfig(envOf({ HOME: "/home/alex" }), dir), Error, "Cannot read config file");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("resume is off unless the config file or RUNBOARD_RESUME turns it on", () => {
  const dir = Deno.makeTempDirSync();
  try {
    assertEquals(loadConfig(envOf({ HOME: "/home/alex" }), dir).resume, false);
    Deno.writeTextFileSync(join(dir, "runboard.config.json"), JSON.stringify({ resume: true }));
    assertEquals(loadConfig(envOf({ HOME: "/home/alex" }), dir).resume, true);
    assertEquals(loadConfig(envOf({ HOME: "/home/alex", RUNBOARD_RESUME: "false" }), dir).resume, false);
    assertThrows(
      () => loadConfig(envOf({ HOME: "/home/alex", RUNBOARD_RESUME: "sometimes" }), dir),
      Error,
      "RUNBOARD_RESUME must be true or false",
    );
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
