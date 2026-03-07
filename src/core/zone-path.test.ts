import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PathAlreadyExistsError, UsageError } from "./errors.js";
import { buildZonePath, normalizeZoneName } from "./zone-path.js";
import type { RepoContext, ResolvedAddTarget } from "./types.js";

function createRepoContext(repoParent: string): RepoContext {
  const mainWorktreePath = path.join(repoParent, "repo");
  return {
    cwd: mainWorktreePath,
    currentWorktreePath: mainWorktreePath,
    mainWorktreePath,
    commonGitDir: path.join(mainWorktreePath, ".git"),
    repoName: "repo",
    repoParent,
  };
}

describe("normalizeZoneName", () => {
  test("normalizes separators and symbols", () => {
    expect(normalizeZoneName("feature/login-fix")).toBe("feature-login-fix");
    expect(normalizeZoneName("fix/pr-123")).toBe("fix-pr-123");
    expect(normalizeZoneName("release/v1.2.0")).toBe("release-v1.2.0");
    expect(normalizeZoneName("a@@@b")).toBe("a-b");
  });

  test("rejects empty normalized names", () => {
    expect(() => normalizeZoneName("////")).toThrow(UsageError);
  });
});

describe("buildZonePath", () => {
  test("uses create branch name when present", async () => {
    const repoParent = await fs.mkdtemp(path.join(os.tmpdir(), "git-zone-path-"));
    const repo = createRepoContext(repoParent);
    const target: ResolvedAddTarget = {
      kind: "pr",
      number: 123,
      commit: "abc1234",
      remote: "origin",
      repository: { host: "github.com", owner: "f440", repo: "repo" },
      headBranch: "feature/login-fix",
    };

    const result = await buildZonePath(repo, target, "fix/pr-123");

    expect(result.zoneName).toBe("fix-pr-123");
    expect(result.zonePath).toBe(path.join(repoParent, ".zone", "repo", "fix-pr-123"));
  });

  test("fails when zone path already exists", async () => {
    const repoParent = await fs.mkdtemp(path.join(os.tmpdir(), "git-zone-path-exists-"));
    const repo = createRepoContext(repoParent);
    const existingPath = path.join(repoParent, ".zone", "repo", "main");
    await fs.mkdir(existingPath, { recursive: true });

    await expect(buildZonePath(repo, { kind: "branch", branch: "main", commit: "abc1234" })).rejects.toMatchObject({
      name: PathAlreadyExistsError.name,
      message: `zone path already exists: ${existingPath}`,
      details: [
        "requested zone name: main",
        "normalized zone name: main",
      ],
    });
  });

  test("explains zone name normalization on collision", async () => {
    const repoParent = await fs.mkdtemp(path.join(os.tmpdir(), "git-zone-path-normalized-"));
    const repo = createRepoContext(repoParent);
    const existingPath = path.join(repoParent, ".zone", "repo", "feature-login");
    await fs.mkdir(existingPath, { recursive: true });

    await expect(
      buildZonePath(repo, { kind: "branch", branch: "feature/login", commit: "abc1234" }),
    ).rejects.toMatchObject({
      name: PathAlreadyExistsError.name,
      message: `zone path already exists: ${existingPath}`,
      details: [
        "requested zone name: feature/login",
        "normalized zone name: feature-login",
      ],
    });
  });
});
