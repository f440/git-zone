import fs from "node:fs/promises";
import path from "node:path";

import { UsageError } from "../core/errors.js";
import type {
  AddCommandResult,
  GitRunner,
  RepoContext,
  ResolvedAddTarget,
  WorktreeEntry,
} from "../core/types.js";
import { buildZonePath } from "../core/zone-path.js";

export async function runAddCommand(options: {
  runner: GitRunner;
  repo: RepoContext;
  target: ResolvedAddTarget;
  createBranch?: string;
  worktrees: WorktreeEntry[];
}): Promise<AddCommandResult> {
  const { runner, repo, target, createBranch, worktrees } = options;
  const { zoneName, zonePath } = await buildZonePath(repo, target, createBranch);

  await fs.mkdir(path.dirname(zonePath), { recursive: true });

  if (target.kind === "branch" && !createBranch) {
    const inUse = worktrees.find((worktree) => worktree.branch === target.branch);
    if (inUse) {
      throw new UsageError(`branch '${target.branch}' is already checked out in another worktree`, {
        details: [`path: ${inUse.path}`],
      });
    }
  }

  if (createBranch) {
    const existingBranch = await runner(["show-ref", "--verify", "--quiet", `refs/heads/${createBranch}`], {
      cwd: repo.currentWorktreePath,
      allowFailure: true,
    });
    if (existingBranch.exitCode === 0) {
      throw new UsageError(`branch already exists: ${createBranch}`);
    }
    await runner(
      ["worktree", "add", "-b", createBranch, zonePath, target.commit],
      { cwd: repo.currentWorktreePath },
    );
    return {
      lines: [
        `created worktree: ${zonePath}`,
        `checked out: ${createBranch}`,
      ],
      hookContext: {
        event: "post-add",
        repoRoot: repo.mainWorktreePath,
        mainWorktree: repo.mainWorktreePath,
        worktreePath: zonePath,
        zoneName,
        branch: createBranch,
      },
    };
  }

  if (target.kind === "branch") {
    await runner(["worktree", "add", zonePath, target.branch], {
      cwd: repo.currentWorktreePath,
    });
    return {
      lines: [
        `created worktree: ${zonePath}`,
        `checked out: ${target.branch}`,
      ],
      hookContext: {
        event: "post-add",
        repoRoot: repo.mainWorktreePath,
        mainWorktree: repo.mainWorktreePath,
        worktreePath: zonePath,
        zoneName,
        branch: target.branch,
      },
    };
  }

  await runner(["worktree", "add", "--detach", zonePath, target.commit], {
    cwd: repo.currentWorktreePath,
  });

  return {
    lines: [
      `created worktree: ${zonePath}`,
      `checked out: detached at ${target.commit.slice(0, 7)}`,
    ],
    hookContext: {
      event: "post-add",
      repoRoot: repo.mainWorktreePath,
      mainWorktree: repo.mainWorktreePath,
      worktreePath: zonePath,
      zoneName,
      branch: "",
    },
  };
}
