import { describe, expect, test } from "bun:test";

import { AmbiguousTargetError, GitCommandError } from "./errors.js";
import { resolveAddTarget } from "./resolve-target.js";
import type { GitResult, GitRunner, RepoContext } from "./types.js";

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
  repoParent: "/",
};

describe("resolveAddTarget", () => {
  test("resolves local branches before generic revisions", async () => {
    const runner = createFakeRunner((args) => {
      const command = args.join(" ");
      if (command === "show-ref --verify --quiet refs/heads/main") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      if (
        command === "show-ref --verify --quiet refs/remotes/main"
        || command === "show-ref --verify --quiet refs/tags/main"
      ) {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (command === "rev-parse refs/heads/main^{commit}") {
        return { stdout: "abc123\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(resolveAddTarget(runner, repo, "main")).resolves.toEqual({
      kind: "branch",
      branch: "main",
      commit: "abc123",
    });
  });

  test("rejects ambiguous ref names", async () => {
    const runner = createFakeRunner((args) => {
      const command = args.join(" ");
      if (
        command === "show-ref --verify --quiet refs/heads/release"
        || command === "show-ref --verify --quiet refs/tags/release"
      ) {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      if (command === "show-ref --verify --quiet refs/remotes/release") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(resolveAddTarget(runner, repo, "release")).rejects.toThrow(AmbiguousTargetError);
  });

  test("resolves generic commits when no exact refs match", async () => {
    const runner = createFakeRunner((args) => {
      const command = args.join(" ");
      if (
        command === "show-ref --verify --quiet refs/heads/abc1234"
        || command === "show-ref --verify --quiet refs/remotes/abc1234"
        || command === "show-ref --verify --quiet refs/tags/abc1234"
      ) {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (command === "for-each-ref --format=%(refname:short) refs/remotes/*/abc1234") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      if (command === "rev-parse --verify abc1234^{commit}") {
        return { stdout: "abc1234deadbeef\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(resolveAddTarget(runner, repo, "abc1234")).resolves.toEqual({
      kind: "commit",
      rev: "abc1234",
      commit: "abc1234deadbeef",
    });
  });

  test("guesses a unique remote-tracking branch when local branch is missing", async () => {
    const runner = createFakeRunner((args) => {
      const command = args.join(" ");
      if (
        command === "show-ref --verify --quiet refs/heads/topic"
        || command === "show-ref --verify --quiet refs/remotes/topic"
        || command === "show-ref --verify --quiet refs/tags/topic"
      ) {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (command === "for-each-ref --format=%(refname:short) refs/remotes/*/topic") {
        return { stdout: "origin/topic\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      if (command === "config --get checkout.defaultRemote") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (command === "rev-parse refs/remotes/origin/topic^{commit}") {
        return { stdout: "feedface\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(resolveAddTarget(runner, repo, "topic")).resolves.toEqual({
      kind: "remote",
      remoteBranch: "origin/topic",
      guessedLocalBranch: "topic",
      commit: "feedface",
    });
  });
});
