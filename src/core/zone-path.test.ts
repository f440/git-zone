import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PathAlreadyExistsError, UsageError } from "./errors.js";
import { DEFAULT_WORKSPACE_PATH_TEMPLATE } from "./config.js";
import { buildZonePath, normalizeZoneName, resolveZonePathTemplate } from "./zone-path.js";
import type { RepoContext, ResolvedAddTarget } from "./types.js";

function createRepoContext(repoParent: string): RepoContext {
  const mainWorktreePath = path.join(repoParent, "repo");
  return {
    cwd: mainWorktreePath,
    currentWorktreePath: mainWorktreePath,
    mainWorktreePath,
    commonGitDir: path.join(mainWorktreePath, ".git"),
    repoName: "repo",
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

    const result = await buildZonePath(repo, target, DEFAULT_WORKSPACE_PATH_TEMPLATE, "fix/pr-123");

    expect(result.zoneName).toBe("fix-pr-123");
    expect(result.zonePath).toBe(path.join(repoParent, ".zone", "repo", "fix-pr-123"));
  });

  test("fails when zone path already exists", async () => {
    const repoParent = await fs.mkdtemp(path.join(os.tmpdir(), "git-zone-path-exists-"));
    const repo = createRepoContext(repoParent);
    const existingPath = path.join(repoParent, ".zone", "repo", "main");
    await fs.mkdir(existingPath, { recursive: true });

    try {
      await buildZonePath(repo, { kind: "branch", branch: "main", commit: "abc1234" }, DEFAULT_WORKSPACE_PATH_TEMPLATE);
      throw new Error("expected buildZonePath to fail");
    } catch (error) {
      expect(error).toMatchObject({
        name: PathAlreadyExistsError.name,
        message: `zone path already exists: ${existingPath}`,
        details: [
          "requested zone name: main",
          "normalized zone name: main",
        ],
      });
    }
  });

  test("explains zone name normalization on collision", async () => {
    const repoParent = await fs.mkdtemp(path.join(os.tmpdir(), "git-zone-path-normalized-"));
    const repo = createRepoContext(repoParent);
    const existingPath = path.join(repoParent, ".zone", "repo", "feature-login");
    await fs.mkdir(existingPath, { recursive: true });

    try {
      await buildZonePath(repo, { kind: "branch", branch: "feature/login", commit: "abc1234" }, DEFAULT_WORKSPACE_PATH_TEMPLATE);
      throw new Error("expected buildZonePath to fail");
    } catch (error) {
      expect(error).toMatchObject({
        name: PathAlreadyExistsError.name,
        message: `zone path already exists: ${existingPath}`,
        details: [
          "requested zone name: feature/login",
          "normalized zone name: feature-login",
        ],
      });
    }
  });
});

describe("resolveZonePathTemplate", () => {
  test("expands environment variables in absolute paths", () => {
    const repo = createRepoContext("/tmp/root");
    const originalHome = process.env.HOME;
    process.env.HOME = "/tmp/home-dir";

    try {
      expect(resolveZonePathTemplate(repo, "${HOME}/zones/${workspace}", "feature-login")).toBe(
        path.join("/tmp/home-dir", "zones", "feature-login"),
      );
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });

  test("expands environment variables in relative paths", () => {
    const repo = createRepoContext("/tmp/root");
    const originalZoneRoot = process.env.ZONE_ROOT;
    process.env.ZONE_ROOT = ".cache/zones";

    try {
      expect(resolveZonePathTemplate(repo, "${ZONE_ROOT}/${repo}/${workspace}", "feature-login")).toBe(
        path.join("/tmp/root", "repo", ".cache", "zones", "repo", "feature-login"),
      );
    } finally {
      if (originalZoneRoot === undefined) {
        delete process.env.ZONE_ROOT;
      } else {
        process.env.ZONE_ROOT = originalZoneRoot;
      }
    }
  });

  test("prefers reserved placeholders over environment variables", () => {
    const repo = createRepoContext("/tmp/root");
    const originalRepo = process.env.repo;
    const originalWorkspace = process.env.workspace;
    process.env.repo = "env-repo";
    process.env.workspace = "env-workspace";

    try {
      expect(resolveZonePathTemplate(repo, "../.zone/${repo}/${workspace}", "feature-login")).toBe(
        path.join("/tmp/root", ".zone", "repo", "feature-login"),
      );
    } finally {
      if (originalRepo === undefined) {
        delete process.env.repo;
      } else {
        process.env.repo = originalRepo;
      }
      if (originalWorkspace === undefined) {
        delete process.env.workspace;
      } else {
        process.env.workspace = originalWorkspace;
      }
    }
  });

  test("fails when an environment variable is undefined", () => {
    const repo = createRepoContext("/tmp/root");
    const originalZoneRoot = process.env.ZONE_ROOT;
    delete process.env.ZONE_ROOT;

    try {
      expect(() => resolveZonePathTemplate(repo, "${ZONE_ROOT}/${workspace}", "feature-login")).toThrow(
        new UsageError("zone.workspace.pathTemplate references undefined environment variable: ${ZONE_ROOT}"),
      );
    } finally {
      if (originalZoneRoot === undefined) {
        delete process.env.ZONE_ROOT;
      } else {
        process.env.ZONE_ROOT = originalZoneRoot;
      }
    }
  });

  test("resolves relative paths from the main worktree", () => {
    const repo = createRepoContext("/tmp/root");

    expect(resolveZonePathTemplate(repo, "../.zone/${repo}/${workspace}", "feature-login")).toBe(
      path.join("/tmp/root", ".zone", "repo", "feature-login"),
    );
  });

  test("keeps absolute paths absolute", () => {
    const repo = createRepoContext("/tmp/root");

    expect(resolveZonePathTemplate(repo, "/tmp/zones/${workspace}", "feature-login")).toBe(
      path.join("/tmp/zones", "feature-login"),
    );
  });

  test("requires the workspace placeholder", () => {
    const repo = createRepoContext("/tmp/root");

    expect(() => resolveZonePathTemplate(repo, "../.zone/${repo}", "feature-login")).toThrow(
      new UsageError("zone.workspace.pathTemplate must include ${workspace}"),
    );
  });

  test("requires the workspace placeholder to be the final path segment", () => {
    const repo = createRepoContext("/tmp/root");

    expect(() => resolveZonePathTemplate(repo, "/tmp/zones/${repo}-${workspace}", "feature-login")).toThrow(
      new UsageError("zone.workspace.pathTemplate must place ${workspace} in the final path segment"),
    );
    expect(() => resolveZonePathTemplate(repo, "/tmp/zones/${workspace}/tree", "feature-login")).toThrow(
      new UsageError("zone.workspace.pathTemplate must place ${workspace} in the final path segment"),
    );
  });
});
