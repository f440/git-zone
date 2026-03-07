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
  const effectiveCreateBranch = createBranch ?? (target.kind === "pr" ? target.headBranch : undefined);
  const { zoneName, zonePath } = await buildZonePath(repo, target, effectiveCreateBranch);

  await fs.mkdir(path.dirname(zonePath), { recursive: true });

  if (target.kind === "branch" && !createBranch) {
    const inUse = worktrees.find((worktree) => worktree.branch === target.branch);
    if (inUse) {
      throw new UsageError(`branch '${target.branch}' is already checked out in another worktree`, {
        details: [`path: ${inUse.path}`],
      });
    }
  }

  if (effectiveCreateBranch) {
    const existingBranch = await runner(["show-ref", "--verify", "--quiet", `refs/heads/${effectiveCreateBranch}`], {
      cwd: repo.currentWorktreePath,
      allowFailure: true,
    });
    if (existingBranch.exitCode === 0) {
      if (target.kind === "pr" && !createBranch) {
        throw new UsageError(`local branch already exists: ${effectiveCreateBranch}`, {
          details: ["hint: specify -c <branch-name> explicitly"],
        });
      }
      throw new UsageError(`branch already exists: ${effectiveCreateBranch}`);
    }
    await runner(
      ["worktree", "add", "-b", effectiveCreateBranch, zonePath, target.commit],
      { cwd: repo.currentWorktreePath },
    );
    return {
      lines: [
        `created worktree: ${zonePath}`,
        `checked out: ${effectiveCreateBranch}`,
      ],
      hookContext: {
        event: "post-add",
        repoRoot: repo.mainWorktreePath,
        mainWorktree: repo.mainWorktreePath,
        worktreePath: zonePath,
        zoneName,
        branch: effectiveCreateBranch,
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
