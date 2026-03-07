import { collectWorktreeStatus } from "../core/worktree.js";
import { formatWorktreeTable } from "../core/output.js";
import type { GitRunner, RepoContext, WorktreeEntry } from "../core/types.js";

export async function runListCommand(options: {
  runner: GitRunner;
  repo: RepoContext;
  worktrees: WorktreeEntry[];
  format?: "table" | "json";
}): Promise<string> {
  const sorted = [...options.worktrees].sort((left, right) => {
    if (left.path === options.repo.mainWorktreePath) {
      return -1;
    }
    if (right.path === options.repo.mainWorktreePath) {
      return 1;
    }
    return left.path.localeCompare(right.path);
  });

  const statuses = [];
  for (const worktree of sorted) {
    statuses.push(await collectWorktreeStatus(options.runner, worktree, options.repo.mainWorktreePath));
  }

  if (options.format === "json") {
    return JSON.stringify(statuses, null, 2);
  }

  return formatWorktreeTable(statuses);
}
