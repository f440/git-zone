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
    repoParent: root,
  };
}

describe("runAddCommand", () => {
  test("uses the PR head branch as the default local branch", async () => {
    const repo = await createRepoContext();
    const commands: string[] = [];
    const runner = createFakeRunner((args) => {
      commands.push(args.join(" "));
      if (args.join(" ") === "show-ref --verify --quiet refs/heads/feature/login-fix") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (args[0] === "worktree" && args[1] === "add") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    const target: ResolvedAddTarget = {
      kind: "pr",
      number: 123,
      commit: "abc123",
      remote: "origin",
      repository: { host: "github.com", owner: "f440", repo: "git-zone" },
      headBranch: "feature/login-fix",
    };

    const result = await runAddCommand({
      runner,
      repo,
      target,
      worktrees: [],
    });

    expect(result.lines).toEqual([
      `created worktree: ${path.join(repo.repoParent, ".zone", "repo", "feature-login-fix")}`,
      "checked out: feature/login-fix",
    ]);
    expect(result.hookContext.branch).toBe("feature/login-fix");
    expect(commands).toContain(
      `worktree add -b feature/login-fix ${path.join(repo.repoParent, ".zone", "repo", "feature-login-fix")} abc123`,
    );
  });

  test("rejects default PR branch collisions with a hint", async () => {
    const repo = await createRepoContext();
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "show-ref --verify --quiet refs/heads/feature/login-fix") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    const target: ResolvedAddTarget = {
      kind: "pr",
      number: 123,
      commit: "abc123",
      remote: "origin",
      repository: { host: "github.com", owner: "f440", repo: "git-zone" },
      headBranch: "feature/login-fix",
    };

    await expect(
      runAddCommand({
        runner,
        repo,
        target,
        worktrees: [],
      }),
    ).rejects.toThrow(UsageError);
  });

  test("allows overriding the default PR branch with -c", async () => {
    const repo = await createRepoContext();
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "show-ref --verify --quiet refs/heads/pr-123-review") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (args[0] === "worktree" && args[1] === "add") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    const target: ResolvedAddTarget = {
      kind: "pr",
      number: 123,
      commit: "abc123",
      remote: "origin",
      repository: { host: "github.com", owner: "f440", repo: "git-zone" },
      headBranch: "feature/login-fix",
    };

    const result = await runAddCommand({
      runner,
      repo,
      target,
      worktrees: [],
      createBranch: "pr-123-review",
    });

    expect(result.lines[1]).toBe("checked out: pr-123-review");
    expect(result.hookContext.branch).toBe("pr-123-review");
  });
});
