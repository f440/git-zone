import { describe, expect, test } from "bun:test";

import { GitCommandError, PullRequestResolutionError } from "./errors.js";
import { parseGitHubRepoUrl, parsePullRequestUrl, resolvePullRequestCommit } from "./github-pr.js";
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

describe("parsePullRequestUrl", () => {
  test("accepts GitHub pull request URLs", () => {
    expect(parsePullRequestUrl("https://github.com/f440/git-zone/pull/123/files")).toEqual({
      host: "github.com",
      owner: "f440",
      repo: "git-zone",
      number: 123,
    });
  });

  test("rejects non GitHub URLs", () => {
    expect(() => parsePullRequestUrl("https://example.com/f440/git-zone/pull/123")).toThrow(
      PullRequestResolutionError,
    );
  });
});

describe("parseGitHubRepoUrl", () => {
  test("parses https and ssh remotes", () => {
    expect(parseGitHubRepoUrl("https://github.com/f440/git-zone.git")).toEqual({
      host: "github.com",
      owner: "f440",
      repo: "git-zone",
    });
    expect(parseGitHubRepoUrl("git@github.com:f440/git-zone.git")).toEqual({
      host: "github.com",
      owner: "f440",
      repo: "git-zone",
    });
  });
});

describe("resolvePullRequestCommit", () => {
  test("uses ls-remote result when commit is already local", async () => {
    const runner = createFakeRunner((args) => {
      const command = args.join(" ");
      if (command === "remote get-url origin") {
        return { stdout: "https://github.com/f440/git-zone.git\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      if (command === "ls-remote origin refs/pull/123/head") {
        return { stdout: "abc123 refs/pull/123/head\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      if (command === "cat-file -e abc123^{commit}") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(resolvePullRequestCommit(runner, repo, 123)).resolves.toEqual({
      commit: "abc123",
      remote: "origin",
    });
  });

  test("rejects URL and origin repository mismatch", async () => {
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "remote get-url origin") {
        return { stdout: "https://github.com/f440/git-zone.git\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    await expect(
      resolvePullRequestCommit(runner, repo, 123, {
        host: "github.com",
        owner: "other",
        repo: "repo",
      }),
    ).rejects.toThrow(PullRequestResolutionError);
  });
});
