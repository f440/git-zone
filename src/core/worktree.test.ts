import { describe, expect, test } from "bun:test";
import process from "node:process";

import { GitCommandError } from "./errors.js";
import { collectWorktreeStatus, parseWorktreeList } from "./worktree.js";
import type { GitResult, GitRunner, WorktreeEntry } from "./types.js";

function createFakeRunner(resolver: (args: string[]) => GitResult): GitRunner {
  return async (args, options = {}) => {
    const result = resolver(args);
    if (result.exitCode !== 0 && !options.allowFailure) {
      throw new GitCommandError("git command failed", { gitResult: result });
    }
    return result;
  };
}

describe("parseWorktreeList", () => {
  test("parses porcelain output", () => {
    const output = `worktree /repo
HEAD abcdef1234567890
branch refs/heads/main

worktree /repo/.zone/repo/pr-123
HEAD 1234567890abcdef
detached
`;

    const entries = parseWorktreeList(output, "/repo");

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      path: "/repo",
      head: "abcdef1234567890",
      branch: "main",
      detached: false,
      bare: false,
      locked: false,
      prunable: false,
      isCurrent: true,
    });
    expect(entries[1]?.detached).toBe(true);
    expect(entries[1]?.branch).toBeNull();
  });
});

describe("collectWorktreeStatus", () => {
  test("reuses the parsed HEAD without calling rev-parse HEAD", async () => {
    const entry: WorktreeEntry = {
      path: process.cwd(),
      head: "abcdef1234567890",
      branch: "main",
      detached: false,
      bare: false,
      locked: false,
      prunable: false,
      isCurrent: true,
    };
    const commands: string[] = [];
    const runner = createFakeRunner((args) => {
      const command = args.join(" ");
      commands.push(command);

      if (command === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (command === "status --porcelain") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }

      throw new Error(`unexpected command: ${command}`);
    });

    const status = await collectWorktreeStatus(runner, entry, process.cwd());

    expect(status.head).toBe("abcdef1234567890");
    expect(status.missing).toBe(false);
    expect(commands).not.toContain("rev-parse HEAD");
  });

  test("skips git commands for missing prunable worktrees", async () => {
    const entry: WorktreeEntry = {
      path: "/definitely/missing/path",
      head: "abcdef1234567890",
      branch: "gone-branch",
      detached: false,
      bare: false,
      locked: false,
      prunable: true,
      isCurrent: false,
    };
    const commands: string[] = [];
    const runner = createFakeRunner((args) => {
      commands.push(args.join(" "));
      throw new Error("runner should not be called for missing worktrees");
    });

    const status = await collectWorktreeStatus(runner, entry, "/repo");

    expect(status.missing).toBe(true);
    expect(status.upstream).toBeNull();
    expect(status.ahead).toBeNull();
    expect(status.behind).toBeNull();
    expect(status.dirty).toBe(false);
    expect(commands).toEqual([]);
  });
});
