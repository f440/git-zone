import { describe, expect, test } from "bun:test";

import { runListCommand } from "./list.js";
import { GitCommandError } from "../core/errors.js";
import type { GitResult, GitRunner, RepoContext, WorktreeEntry } from "../core/types.js";

function createFakeRunner(
  resolver: (args: string[], cwd: string | undefined) => GitResult,
): GitRunner {
  return async (args, options = {}) => {
    const result = resolver(args, options.cwd);
    if (result.exitCode !== 0 && !options.allowFailure) {
      throw new GitCommandError("git command failed", { gitResult: result });
    }
    return result;
  };
}

describe("runListCommand", () => {
  test("preserves sorted output order while collecting statuses concurrently", async () => {
    const repo: RepoContext = {
      cwd: "/repo",
      currentWorktreePath: "/repo",
      mainWorktreePath: "/repo",
      commonGitDir: "/repo/.git",
      repoName: "repo",
    };
    const worktrees: WorktreeEntry[] = [
      {
        path: "/repo/.zone/repo/zeta",
        head: "ccccccc3333333",
        branch: "zeta",
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
        isCurrent: false,
      },
      {
        path: "/repo",
        head: "aaaaaaa1111111",
        branch: "main",
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
        isCurrent: true,
      },
      {
        path: "/repo/.zone/repo/alpha",
        head: "bbbbbbb2222222",
        branch: "alpha",
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
        isCurrent: false,
      },
      {
        path: "/definitely/missing/path",
        head: "ddddddd4444444",
        branch: "stale",
        detached: false,
        bare: false,
        locked: false,
        prunable: true,
        isCurrent: false,
      },
    ];

    const delays = new Map<string, number>([
      ["/repo", 30],
      ["/repo/.zone/repo/alpha", 10],
      ["/repo/.zone/repo/zeta", 0],
    ]);

    const runner = createFakeRunner((args, cwd) => {
      const command = args.join(" ");
      if (!cwd) {
        throw new Error("cwd is required");
      }

      if (command === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }

      if (command === "status --porcelain") {
        const delay = delays.get(cwd) ?? 0;
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
          command: ["git", ...args],
          get delayed() {
            return delay;
          },
        } as GitResult;
      }

      throw new Error(`unexpected command: ${command}`);
    });

    const delayedRunner: GitRunner = async (args, options = {}) => {
      const result = await runner(args, options);
      const maybeDelayed = result as GitResult & { delayed?: number };
      if (maybeDelayed.delayed) {
        await new Promise((resolve) => setTimeout(resolve, maybeDelayed.delayed));
      }
      return result;
    };

    const output = await runListCommand({
      runner: delayedRunner,
      repo,
      worktrees,
      format: "json",
    });

    const parsed = JSON.parse(output) as Array<{ path: string }>;
    expect(parsed.map((entry) => entry.path)).toEqual([
      "/repo",
      "/definitely/missing/path",
      "/repo/.zone/repo/alpha",
      "/repo/.zone/repo/zeta",
    ]);

    const missingEntry = parsed.find((entry) => entry.path === "/definitely/missing/path") as
      | { missing?: boolean; upstream?: string | null; ahead?: number | null; behind?: number | null; dirty?: boolean }
      | undefined;
    expect(missingEntry?.missing).toBe(true);
    expect(missingEntry?.upstream).toBeNull();
    expect(missingEntry?.ahead).toBeNull();
    expect(missingEntry?.behind).toBeNull();
    expect(missingEntry?.dirty).toBe(false);
  });
});
