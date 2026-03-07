import { collectWorktreeStatus } from "../core/worktree.js";
import { formatWorktreeTable } from "../core/output.js";
import type { GitRunner, RepoContext, WorktreeEntry } from "../core/types.js";

export async function runListCommand(options: {
  runner: GitRunner;
  repo: RepoContext;
  worktrees: WorktreeEntry[];
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
    statuses.push(await collectWorktreeStatus(options.runner, worktree));
  }

  return formatWorktreeTable(statuses);
}
