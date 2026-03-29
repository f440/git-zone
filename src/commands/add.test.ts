import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runAddCommand } from "./add.js";
import { GitCommandError, UsageError } from "../core/errors.js";
import type { GitResult, GitRunner, RepoContext, ResolvedAddTarget } from "../core/types.js";

function createFakeRunner(resolver: (args: string[]) => GitResult): GitRunner {
  return async (args, options = {}) => {
    const result = resolver(args);
    if (result.exitCode !== 0 && !options.allowFailure) {
      throw new GitCommandError("git command failed", { gitResult: result });
    }
    return result;
  };
}

async function createRepoContext(): Promise<RepoContext> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "git-zone-add-"));
  const repoPath = path.join(root, "repo");
  await fs.mkdir(repoPath, { recursive: true });

  return {
    cwd: repoPath,
    currentWorktreePath: repoPath,
    mainWorktreePath: repoPath,
    commonGitDir: path.join(repoPath, ".git"),
    repoName: "repo",
  };
}

describe("runAddCommand", () => {
  test("uses the guessed remote branch name as the default local branch", async () => {
    const repo = await createRepoContext();
    const commands: string[] = [];
    const runner = createFakeRunner((args) => {
      commands.push(args.join(" "));
      if (args.join(" ") === "config --get zone.workspace.pathTemplate") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (args.join(" ") === "show-ref --verify --quiet refs/heads/feature/login-fix") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (args[0] === "worktree" && args[1] === "add") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    const target: ResolvedAddTarget = {
      kind: "remote",
      commit: "abc123",
      remoteBranch: "origin/feature/login-fix",
      guessedLocalBranch: "feature/login-fix",
    };

    const result = await runAddCommand({
      runner,
      repo,
      target,
      worktrees: [],
    });

    expect(result.lines).toEqual([
      `created worktree: ${path.join(path.dirname(repo.mainWorktreePath), ".zone", "repo", "feature-login-fix")}`,
      "checked out: feature/login-fix",
    ]);
    expect(result.hookContext.branch).toBe("feature/login-fix");
    expect(commands).toContain(
      `worktree add -b feature/login-fix --track ${path.join(path.dirname(repo.mainWorktreePath), ".zone", "repo", "feature-login-fix")} origin/feature/login-fix`,
    );
  });

  test("rejects guessed remote branch collisions", async () => {
    const repo = await createRepoContext();
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "config --get zone.workspace.pathTemplate") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (args.join(" ") === "show-ref --verify --quiet refs/heads/feature/login-fix") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    const target: ResolvedAddTarget = {
      kind: "remote",
      commit: "abc123",
      remoteBranch: "origin/feature/login-fix",
      guessedLocalBranch: "feature/login-fix",
    };

    await expect(async () =>
      runAddCommand({
        runner,
        repo,
        target,
        worktrees: [],
      }),
    ).toThrow(UsageError);
  });

  test("allows overriding the guessed remote branch with -b", async () => {
    const repo = await createRepoContext();
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "config --get zone.workspace.pathTemplate") {
        return { stdout: "worktrees/${workspace}\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      if (args.join(" ") === "show-ref --verify --quiet refs/heads/pr-123-review") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (args[0] === "worktree" && args[1] === "add") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    const target: ResolvedAddTarget = {
      kind: "remote",
      commit: "abc123",
      remoteBranch: "origin/feature/login-fix",
      guessedLocalBranch: "feature/login-fix",
    };

    const result = await runAddCommand({
      runner,
      repo,
      target,
      worktrees: [],
      branch: "pr-123-review",
      branchMode: "create",
    });

    expect(result.lines[1]).toBe("checked out: pr-123-review");
    expect(result.lines[0]).toBe(`created worktree: ${path.join(repo.mainWorktreePath, "worktrees", "pr-123-review")}`);
    expect(result.hookContext.branch).toBe("pr-123-review");
  });

  test("supports explicit detached add", async () => {
    const repo = await createRepoContext();
    const commands: string[] = [];
    const runner = createFakeRunner((args) => {
      commands.push(args.join(" "));
      if (args.join(" ") === "config --get zone.workspace.pathTemplate") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (args[0] === "worktree" && args[1] === "add") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    const result = await runAddCommand({
      runner,
      repo,
      target: { kind: "commit", rev: "HEAD", commit: "abc1234" },
      worktrees: [],
      detach: true,
    });

    expect(result.lines[1]).toBe("checked out: detached at abc1234");
    expect(commands).toContain(
      `worktree add --detach ${path.join(path.dirname(repo.mainWorktreePath), ".zone", "repo", "commit-abc1234")} abc1234`,
    );
  });

  test("skips the branch-in-use precheck and passes -f for existing branch checkout", async () => {
    const repo = await createRepoContext();
    const commands: string[] = [];
    const runner = createFakeRunner((args) => {
      commands.push(args.join(" "));
      if (args.join(" ") === "config --get zone.workspace.pathTemplate") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (args[0] === "worktree" && args[1] === "add") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    const result = await runAddCommand({
      runner,
      repo,
      target: { kind: "branch", branch: "main", commit: "abc1234" },
      worktrees: [
        {
          path: "/repo/elsewhere",
          head: "abc1234",
          branch: "main",
          detached: false,
          bare: false,
          locked: false,
          prunable: false,
          isCurrent: false,
        },
      ],
      force: true,
    });

    expect(result.lines[1]).toBe("checked out: main");
    expect(commands).toContain(`worktree add -f ${path.join(path.dirname(repo.mainWorktreePath), ".zone", "repo", "main")} main`);
  });

  test("does not let force bypass existing -b branch collisions", async () => {
    const repo = await createRepoContext();
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "config --get zone.workspace.pathTemplate") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (args.join(" ") === "show-ref --verify --quiet refs/heads/existing") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    await expect(async () =>
      runAddCommand({
        runner,
        repo,
        target: { kind: "branch", branch: "main", commit: "abc1234" },
        branch: "existing",
        branchMode: "create",
        force: true,
        worktrees: [],
      }),
    ).toThrow("branch already exists: existing");
  });

  test("does not let force bypass guessed remote branch collisions", async () => {
    const repo = await createRepoContext();
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "config --get zone.workspace.pathTemplate") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (args.join(" ") === "show-ref --verify --quiet refs/heads/feature/login-fix") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    await expect(async () =>
      runAddCommand({
        runner,
        repo,
        target: {
          kind: "remote",
          commit: "abc123",
          remoteBranch: "origin/feature/login-fix",
          guessedLocalBranch: "feature/login-fix",
        },
        force: true,
        worktrees: [],
      }),
    ).toThrow("branch already exists: feature/login-fix");
  });

  test("passes -f together with -B when resetting a branch", async () => {
    const repo = await createRepoContext();
    const commands: string[] = [];
    const runner = createFakeRunner((args) => {
      commands.push(args.join(" "));
      if (args.join(" ") === "config --get zone.workspace.pathTemplate") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (args.join(" ") === "show-ref --verify --quiet refs/heads/feature/reset-me") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      if (args[0] === "worktree" && args[1] === "add") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    const result = await runAddCommand({
      runner,
      repo,
      target: { kind: "commit", rev: "HEAD", commit: "abc1234" },
      branch: "feature/reset-me",
      branchMode: "reset",
      force: true,
      worktrees: [],
    });

    expect(result.lines[1]).toBe("checked out: feature/reset-me");
    expect(commands).toContain(
      `worktree add -f -B feature/reset-me ${path.join(path.dirname(repo.mainWorktreePath), ".zone", "repo", "feature-reset-me")} abc1234`,
    );
  });

  test("fails when configured template omits the workspace placeholder", async () => {
    const repo = await createRepoContext();
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "config --get zone.workspace.pathTemplate") {
        return { stdout: "../.zone/${repo}\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    await expect(async () =>
      runAddCommand({
        runner,
        repo,
        target: { kind: "branch", branch: "main", commit: "abc1234" },
        worktrees: [],
      }),
    ).toThrow("zone.workspace.pathTemplate must include ${workspace}");
  });

  test("fails when configured template does not end with the workspace segment", async () => {
    const repo = await createRepoContext();
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "config --get zone.workspace.pathTemplate") {
        return { stdout: "../.zone/${repo}-${workspace}\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    await expect(async () =>
      runAddCommand({
        runner,
        repo,
        target: { kind: "branch", branch: "main", commit: "abc1234" },
        worktrees: [],
      }),
    ).toThrow("zone.workspace.pathTemplate must place ${workspace} in the final path segment");
  });
});
