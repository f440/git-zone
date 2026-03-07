import { describe, expect, test } from "bun:test";

import { AmbiguousTargetError, TargetNotFoundError } from "./errors.js";
import { resolveRemoveTarget } from "./resolve-remove-target.js";
import type { WorktreeEntry } from "./types.js";

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
    path: "/repo/.zone/repo/feature-login",
    head: "def",
    branch: "feature/login",
    detached: false,
    bare: false,
    locked: false,
    prunable: false,
    isCurrent: false,
  },
  {
    path: "/repo/.zone/repo/main",
    head: "ghi",
    branch: null,
    detached: true,
    bare: false,
    locked: false,
    prunable: false,
    isCurrent: false,
  },
];

describe("resolveRemoveTarget", () => {
  test("prefers path matches", () => {
    const result = resolveRemoveTarget("/repo/.zone/repo/feature-login", "/repo", worktrees);
    expect(result.kind).toBe("path");
    expect(result.worktree.path).toBe("/repo/.zone/repo/feature-login");
  });

  test("deduplicates same worktree matches", () => {
    const result = resolveRemoveTarget("feature-login", "/repo", worktrees);
    expect(result.kind).toBe("zone");
    expect(result.worktree.path).toBe("/repo/.zone/repo/feature-login");
  });

  test("reports ambiguity across different worktrees", () => {
    expect(() => resolveRemoveTarget("main", "/repo", worktrees)).toThrow(AmbiguousTargetError);
  });

  test("reports missing targets", () => {
    expect(() => resolveRemoveTarget("missing", "/repo", worktrees)).toThrow(TargetNotFoundError);
  });
});
