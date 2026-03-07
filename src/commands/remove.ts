import path from "node:path";

import { CliError, UsageError } from "../core/errors.js";
import { resolveRemoveTarget } from "../core/resolve-remove-target.js";
import type { GitRunner, RemoveCommandResult, RepoContext, WorktreeEntry } from "../core/types.js";

export async function runRemoveCommand(options: {
  runner: GitRunner;
  repo: RepoContext;
  worktrees: WorktreeEntry[];
  inputs: string[];
  deleteBranch: boolean;
  force: boolean;
}): Promise<RemoveCommandResult> {
  const { runner, repo, worktrees, inputs, deleteBranch, force } = options;
  const results: RemoveCommandResult["results"] = [];
  let failures = 0;
  const remainingWorktrees = [...worktrees];

  for (const input of inputs) {
    try {
      const resolution = resolveRemoveTarget(input, repo.cwd, remainingWorktrees);
      const targetPath = resolution.worktree.path;

      if (targetPath === repo.mainWorktreePath) {
        throw new UsageError("main worktree cannot be removed");
      }

      const removeArgs = ["worktree", "remove"];
      if (force) {
        removeArgs.push("-f");
      }
      removeArgs.push(targetPath);
      await runner(removeArgs, { cwd: repo.currentWorktreePath });
      const lines = [`removed: ${targetPath}`];

      const index = remainingWorktrees.findIndex((worktree) => worktree.path === targetPath);
      const removedWorktree = index >= 0 ? remainingWorktrees.splice(index, 1)[0]! : resolution.worktree;

      if (deleteBranch && removedWorktree.branch) {
        const stillUsed = remainingWorktrees.some((worktree) => worktree.branch === removedWorktree.branch);
        if (stillUsed) {
          throw new UsageError(`branch is still in use: ${removedWorktree.branch}`);
        }

        const branchArgs = ["branch", force ? "-D" : "-d", removedWorktree.branch];
        await runner(branchArgs, { cwd: repo.currentWorktreePath });
        lines.push(`deleted branch: ${removedWorktree.branch}`);
      }

      results.push({
        ok: true,
        lines,
        hookContext: {
          event: "post-remove",
          mainWorktree: repo.mainWorktreePath,
          worktreePath: targetPath,
          zoneName: resolution.kind === "zone" ? resolution.zoneName : path.basename(targetPath),
          branch: removedWorktree.branch ?? "",
        },
      });
    } catch (error) {
      failures += 1;
      if (error instanceof CliError) {
        results.push({ ok: false, lines: [error.format()] });
      } else if (error instanceof Error) {
        results.push({ ok: false, lines: [`error: ${error.message}`] });
      } else {
        results.push({ ok: false, lines: ["error: remove failed"] });
      }
    }
  }

  return { results, failures };
}
