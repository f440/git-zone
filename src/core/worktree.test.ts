import { describe, expect, test } from "bun:test";

import { parseWorktreeList } from "./worktree.js";

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
