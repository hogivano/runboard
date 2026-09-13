/** WorkspaceScanner backed by `git status`: untracked files are the ones a run wrote. */
import type { WorkspaceScanner } from "../../application/ports.ts";

export class GitWorkspaceScanner implements WorkspaceScanner {
  async untrackedFiles(workspace: string): Promise<string[]> {
    let output: Deno.CommandOutput;
    try {
      output = await new Deno.Command("git", {
        args: ["-C", workspace, "status", "--porcelain", "--untracked-files=all"],
        stdin: "null",
        stdout: "piped",
        stderr: "null",
      }).output();
    } catch {
      // No git, or no permission to run it: the run folder's documents still list fine.
      return [];
    }
    if (!output.success) return [];
    return new TextDecoder().decode(output.stdout)
      .split("\n")
      .filter((line) => line.startsWith("?? "))
      .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  }
}
