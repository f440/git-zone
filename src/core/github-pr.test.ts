import { describe, expect, test } from "bun:test";

import { GitCommandError, PullRequestResolutionError } from "./errors.js";
import {
  listBaseResolvedRemoteNames,
  listGitHubRemotes,
  parseGitHubRepoUrl,
  parsePullRequestUrl,
  resolvePullRequestMetadata,
  resolvePullRequestRemoteForNumber,
  resolvePullRequestRemoteForUrl,
} from "./github-pr.js";
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

describe("remote discovery", () => {
  test("lists GitHub remotes from git config", async () => {
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "config --get-regexp ^remote\\..*\\.url$") {
        return {
          stdout: "remote.origin.url https://github.com/f440/git-zone.git\nremote.fork.url git@github.com:f440/git-zone.git\nremote.local.url /tmp/repo\n",
          stderr: "",
          exitCode: 0,
          command: ["git", ...args],
        };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    await expect(listGitHubRemotes(runner, "/repo")).resolves.toEqual([
      {
        name: "origin",
        repository: { host: "github.com", owner: "f440", repo: "git-zone" },
      },
      {
        name: "fork",
        repository: { host: "github.com", owner: "f440", repo: "git-zone" },
      },
    ]);
  });

  test("lists gh-resolved base remotes", async () => {
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "config --get-regexp ^remote\\..*\\.gh-resolved$") {
        return {
          stdout: "remote.origin.gh-resolved base\nremote.fork.gh-resolved head\n",
          stderr: "",
          exitCode: 0,
          command: ["git", ...args],
        };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    await expect(listBaseResolvedRemoteNames(runner, "/repo")).resolves.toEqual(["origin"]);
  });
});

describe("resolvePullRequestRemoteForNumber", () => {
  test("prefers a single gh-resolved base remote", async () => {
    const runner = createFakeRunner((args) => {
      const command = args.join(" ");
      if (command === "config --get-regexp ^remote\\..*\\.url$") {
        return {
          stdout: "remote.origin.url https://github.com/f440/git-zone.git\nremote.upstream.url https://github.com/acme/git-zone.git\n",
          stderr: "",
          exitCode: 0,
          command: ["git", ...args],
        };
      }
      if (command === "config --get-regexp ^remote\\..*\\.gh-resolved$") {
        return {
          stdout: "remote.upstream.gh-resolved base\n",
          stderr: "",
          exitCode: 0,
          command: ["git", ...args],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(resolvePullRequestRemoteForNumber(runner, "/repo")).resolves.toEqual({
      name: "upstream",
      repository: { host: "github.com", owner: "acme", repo: "git-zone" },
    });
  });

  test("falls back to origin", async () => {
    const runner = createFakeRunner((args) => {
      const command = args.join(" ");
      if (command === "config --get-regexp ^remote\\..*\\.url$") {
        return {
          stdout: "remote.origin.url https://github.com/f440/git-zone.git\n",
          stderr: "",
          exitCode: 0,
          command: ["git", ...args],
        };
      }
      if (command === "config --get-regexp ^remote\\..*\\.gh-resolved$") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(resolvePullRequestRemoteForNumber(runner, "/repo")).resolves.toEqual({
      name: "origin",
      repository: { host: "github.com", owner: "f440", repo: "git-zone" },
    });
  });

  test("rejects multiple base remotes", async () => {
    const runner = createFakeRunner((args) => {
      const command = args.join(" ");
      if (command === "config --get-regexp ^remote\\..*\\.url$") {
        return {
          stdout: "remote.origin.url https://github.com/f440/git-zone.git\nremote.upstream.url https://github.com/acme/git-zone.git\n",
          stderr: "",
          exitCode: 0,
          command: ["git", ...args],
        };
      }
      if (command === "config --get-regexp ^remote\\..*\\.gh-resolved$") {
        return {
          stdout: "remote.origin.gh-resolved base\nremote.upstream.gh-resolved base\n",
          stderr: "",
          exitCode: 0,
          command: ["git", ...args],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(async () => resolvePullRequestRemoteForNumber(runner, "/repo")).toThrow(PullRequestResolutionError);
  });
});

describe("resolvePullRequestRemoteForUrl", () => {
  test("matches a single remote by owner/repo", async () => {
    const runner = createFakeRunner((args) => {
      const command = args.join(" ");
      if (command === "config --get-regexp ^remote\\..*\\.url$") {
        return {
          stdout: "remote.origin.url https://github.com/f440/git-zone.git\nremote.upstream.url https://github.com/acme/other.git\n",
          stderr: "",
          exitCode: 0,
          command: ["git", ...args],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(
      resolvePullRequestRemoteForUrl(runner, "/repo", {
        host: "github.com",
        owner: "f440",
        repo: "git-zone",
      }),
    ).resolves.toEqual({
      name: "origin",
      repository: { host: "github.com", owner: "f440", repo: "git-zone" },
    });
  });

  test("prefers gh-resolved base when multiple remotes match", async () => {
    const runner = createFakeRunner((args) => {
      const command = args.join(" ");
      if (command === "config --get-regexp ^remote\\..*\\.url$") {
        return {
          stdout: "remote.origin.url https://github.com/f440/git-zone.git\nremote.upstream.url git@github.com:f440/git-zone.git\n",
          stderr: "",
          exitCode: 0,
          command: ["git", ...args],
        };
      }
      if (command === "config --get-regexp ^remote\\..*\\.gh-resolved$") {
        return {
          stdout: "remote.upstream.gh-resolved base\n",
          stderr: "",
          exitCode: 0,
          command: ["git", ...args],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(
      resolvePullRequestRemoteForUrl(runner, "/repo", {
        host: "github.com",
        owner: "f440",
        repo: "git-zone",
      }),
    ).resolves.toEqual({
      name: "upstream",
      repository: { host: "github.com", owner: "f440", repo: "git-zone" },
    });
  });

  test("rejects URLs that do not match any remote", async () => {
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "config --get-regexp ^remote\\..*\\.url$") {
        return {
          stdout: "remote.origin.url https://github.com/f440/git-zone.git\n",
          stderr: "",
          exitCode: 0,
          command: ["git", ...args],
        };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    await expect(async () =>
      resolvePullRequestRemoteForUrl(runner, "/repo", {
        host: "github.com",
        owner: "other",
        repo: "repo",
      }),
    ).toThrow(PullRequestResolutionError);
  });
});

describe("resolvePullRequestMetadata", () => {
  test("resolves number input to head branch metadata and fetched commit", async () => {
    const runner = createFakeRunner((args) => {
      const command = args.join(" ");
      if (command === "config --get-regexp ^remote\\..*\\.url$") {
        return {
          stdout: "remote.origin.url https://github.com/f440/git-zone.git\n",
          stderr: "",
          exitCode: 0,
          command: ["git", ...args],
        };
      }
      if (command === "config --get-regexp ^remote\\..*\\.gh-resolved$") {
        return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
      }
      if (command === "fetch origin refs/pull/123/head") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      if (command === "rev-parse FETCH_HEAD^{commit}") {
        return { stdout: "abc123\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const viewer = async () => ({
      headRefName: "feature/login-fix",
      headRefOid: "def456",
    });

    await expect(resolvePullRequestMetadata(runner, repo, "123", viewer)).resolves.toEqual({
      number: 123,
      repository: { host: "github.com", owner: "f440", repo: "git-zone" },
      remote: "origin",
      headBranch: "feature/login-fix",
      headCommit: "abc123",
    });
  });

  test("resolves URL input through a matching remote", async () => {
    const runner = createFakeRunner((args) => {
      const command = args.join(" ");
      if (command === "config --get-regexp ^remote\\..*\\.url$") {
        return {
          stdout: "remote.origin.url https://github.com/f440/git-zone.git\n",
          stderr: "",
          exitCode: 0,
          command: ["git", ...args],
        };
      }
      if (command === "fetch origin refs/pull/456/head") {
        return { stdout: "", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      if (command === "rev-parse FETCH_HEAD^{commit}") {
        return { stdout: "fedcba\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const viewer = async () => ({
      headRefName: "feature/from-url",
      headRefOid: "fedcba",
    });

    await expect(
      resolvePullRequestMetadata(runner, repo, "https://github.com/f440/git-zone/pull/456", viewer),
    ).resolves.toEqual({
      number: 456,
      repository: { host: "github.com", owner: "f440", repo: "git-zone" },
      remote: "origin",
      headBranch: "feature/from-url",
      headCommit: "fedcba",
    });
  });
});
