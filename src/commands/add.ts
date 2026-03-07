import fs from "node:fs/promises";
import path from "node:path";

import { UsageError } from "../core/errors.js";
import type {
  AddBranchMode,
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
  branch?: string;
  branchMode?: AddBranchMode;
  detach?: boolean;
  force?: boolean;
  worktrees: WorktreeEntry[];
}): Promise<AddCommandResult> {
  const {
    runner,
    repo,
    target,
    branch,
    branchMode,
    detach = false,
    force = false,
    worktrees,
  } = options;

  const implicitBranch =
    !detach
      ? branch
        ?? (target.kind === "pr" ? target.headBranch : undefined)
        ?? (target.kind === "remote" ? target.guessedLocalBranch : undefined)
      : undefined;
  const { zoneName, zonePath } = await buildZonePath(repo, target, implicitBranch);

  await fs.mkdir(path.dirname(zonePath), { recursive: true });

  if (target.kind === "branch" && !branch && !detach && !force) {
    const inUse = worktrees.find((worktree) => worktree.branch === target.branch);
    if (inUse) {
      throw new UsageError(`branch '${target.branch}' is already checked out in another worktree`, {
        details: [`path: ${inUse.path}`],
      });
    }
  }

  if (implicitBranch) {
    const existingBranch = await runner(["show-ref", "--verify", "--quiet", `refs/heads/${implicitBranch}`], {
      cwd: repo.currentWorktreePath,
      allowFailure: true,
    });

    if (existingBranch.exitCode === 0 && branchMode !== "reset") {
      if (target.kind === "pr" && !branch) {
        throw new UsageError(`local branch already exists: ${implicitBranch}`, {
          details: ["hint: specify -b <branch-name> explicitly"],
        });
      }
      throw new UsageError(`branch already exists: ${implicitBranch}`);
    }

    const addArgs = ["worktree", "add"];
    if (force) {
      addArgs.push("-f");
    }
    if (branchMode === "reset") {
      addArgs.push("-B", implicitBranch);
    } else {
      addArgs.push("-b", implicitBranch);
    }

    let startPoint = target.commit;
    if (target.kind === "remote") {
      addArgs.push("--track");
      startPoint = target.remoteBranch;
    }

    addArgs.push(zonePath, startPoint);
    await runner(addArgs, { cwd: repo.currentWorktreePath });
    return {
      lines: [
        `created worktree: ${zonePath}`,
        `checked out: ${implicitBranch}`,
      ],
      hookContext: {
        event: "post-add",
        mainWorktree: repo.mainWorktreePath,
        worktreePath: zonePath,
        zoneName,
        branch: implicitBranch,
      },
    };
  }

  if (target.kind === "branch") {
    const addArgs = ["worktree", "add"];
    if (force) {
      addArgs.push("-f");
    }
    addArgs.push(zonePath, target.branch);
    await runner(addArgs, {
      cwd: repo.currentWorktreePath,
    });
    return {
      lines: [
        `created worktree: ${zonePath}`,
        `checked out: ${target.branch}`,
      ],
      hookContext: {
        event: "post-add",
        mainWorktree: repo.mainWorktreePath,
        worktreePath: zonePath,
        zoneName,
        branch: target.branch,
      },
    };
  }

  const addArgs = ["worktree", "add"];
  if (force) {
    addArgs.push("-f");
  }
  addArgs.push("--detach", zonePath, target.commit);
  await runner(addArgs, {
    cwd: repo.currentWorktreePath,
  });

  return {
    lines: [
      `created worktree: ${zonePath}`,
      `checked out: detached at ${target.commit.slice(0, 7)}`,
    ],
    hookContext: {
      event: "post-add",
      mainWorktree: repo.mainWorktreePath,
      worktreePath: zonePath,
      zoneName,
      branch: "",
    },
  };
}
