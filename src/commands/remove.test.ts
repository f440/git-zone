import { describe, expect, test } from "bun:test";

import { runRemoveCommand } from "./remove.js";
import { GitCommandError, HookExecutionError } from "../core/errors.js";
import type { GitResult, GitRunner, RepoContext, WorktreeEntry } from "../core/types.js";

function createFakeRunner(resolver: (args: string[]) => GitResult): GitRunner {
  return async (args, options = {}) => {
    const result = resolver(args);
    if (result.exitCode !== 0 && !options.allowFailure) {
      throw new GitCommandError("git command failed", { gitResult: result });
    }
    return result;
  };
}

const repo: RepoContext = {
  cwd: "/repo",
  currentWorktreePath: "/repo",
  mainWorktreePath: "/repo",
  commonGitDir: "/repo/.git",
  repoName: "repo",
};

const worktrees: WorktreeEntry[] = [
  {
    path: "/repo",
    head: "abc",
    branch: "main",
    detached: false,
    bare: false,
    locked: false,
    prunable: false,
    isCurrent: true,
  },
  {
    path: "/repo/.zone/repo/feature-remove-me",
    head: "def",
    branch: "feature/remove-me",
    detached: false,
    bare: false,
    locked: false,
    prunable: false,
    isCurrent: false,
  },
];

describe("runRemoveCommand", () => {
  test("runs pre-remove hook before removing the worktree", async () => {
    const commands: string[] = [];
    const hookEvents: string[] = [];
    const runner = createFakeRunner((args) => {
      commands.push(args.join(" "));
      if (args.join(" ") === "worktree remove /repo/.zone/repo/feature-remove-me") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    const result = await runRemoveCommand({
      runner,
      repo,
      worktrees,
      inputs: ["feature/remove-me"],
      deleteBranch: false,
      force: false,
      runPreRemoveHook: async (context) => {
        hookEvents.push(context.event);
      },
    });

    expect(result.failures).toBe(0);
    expect(hookEvents).toEqual(["pre-remove"]);
    expect(commands).toEqual(["worktree remove /repo/.zone/repo/feature-remove-me"]);
  });

  test("stops removal when pre-remove hook fails", async () => {
    const commands: string[] = [];
    const runner = createFakeRunner((args) => {
      commands.push(args.join(" "));
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    const result = await runRemoveCommand({
      runner,
      repo,
      worktrees,
      inputs: ["feature/remove-me"],
      deleteBranch: false,
      force: false,
      runPreRemoveHook: async () => {
        throw new HookExecutionError("pre-remove", 7, "./scripts/zone-pre-remove");
      },
    });

    expect(result.failures).toBe(1);
    expect(result.results[0]?.ok).toBe(false);
    expect(result.results[0]?.lines.join("\n")).toContain("pre-remove hook failed with exit code 7");
    expect(commands).toEqual([]);
  });

  test("explains when the worktree is already removed but branch deletion fails", async () => {
    const runner = createFakeRunner((args) => {
      const command = args.join(" ");
      if (command === "worktree remove /repo/.zone/repo/feature-remove-me") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      if (command === "branch -d feature/remove-me") {
        return {
          stdout: "",
          stderr: "error: the branch 'feature/remove-me' is not fully merged",
          exitCode: 1,
          command: ["git", ...args],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const result = await runRemoveCommand({
      runner,
      repo,
      worktrees,
      inputs: ["feature/remove-me"],
      deleteBranch: true,
      force: false,
      runPreRemoveHook: async () => {},
    });

    expect(result.failures).toBe(1);
    expect(result.results[0]?.ok).toBe(false);
    expect(result.results[0]?.lines.join("\n")).toContain(
      "failed to delete branch after removing worktree: feature/remove-me",
    );
    expect(result.results[0]?.lines.join("\n")).toContain(
      "worktree already removed: /repo/.zone/repo/feature-remove-me",
    );
    expect(result.results[0]?.lines.join("\n")).toContain("branch remains: feature/remove-me");
  });
});
