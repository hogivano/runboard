import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ShellLauncher } from "../../src/adapters/process/shell_launcher.ts";
import { LaunchFailedError } from "../../src/domain/errors.ts";

async function withRunner(script: string, test: (runner: string, dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir({ prefix: "runboard-launcher-" });
  try {
    const runner = join(dir, "runner");
    await Deno.writeTextFile(runner, `#!/bin/sh\n${script}\n`);
    await Deno.chmod(runner, 0o755);
    await test(runner, dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("a runner still working after the refusal window counts as started", async () => {
  await withRunner("echo started; sleep 1", async (runner, dir) => {
    const began = Date.now();
    const result = await new ShellLauncher(runner, dir, join(dir, "logs"), 100).start([
      "--resume",
      "/runs/a",
    ]);
    assert(Date.now() - began < 900, "start must not wait for the run to finish");
    assertEquals(result.command, [runner, "--resume", "/runs/a"]);
    assert(result.log?.startsWith(join(dir, "logs")));
  });
});

Deno.test("a runner that exits with an error at once is a failed launch, with its reason", async () => {
  await withRunner(
    "echo 'Cannot start: Only a halted run can be resumed' >&2; exit 2",
    async (runner, dir) => {
      await assertRejects(
        () => new ShellLauncher(runner, dir, join(dir, "logs"), 2_000).start([]),
        LaunchFailedError,
        "The runner exited with code 2: Cannot start: Only a halted run can be resumed",
      );
    },
  );
});

Deno.test("a runner that finishes cleanly at once is not an error, and its output is kept", async () => {
  await withRunner('echo "args: $*"', async (runner, dir) => {
    const result = await new ShellLauncher(runner, dir, join(dir, "logs"), 2_000).start(["a b", "c"]);
    // Arguments reach the runner as a list, never re-split by a shell.
    assertEquals((await Deno.readTextFile(result.log!)).trim(), "args: a b c");
  });
});
