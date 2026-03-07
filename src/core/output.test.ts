import { describe, expect, test } from "bun:test";

import { formatWorktreeTable } from "./output.js";

describe("formatWorktreeTable", () => {
  test("aligns rows into columns", () => {
    const output = formatWorktreeTable([
      {
        path: "/repo",
        zoneName: null,
        current: true,
        main: true,
        missing: false,
        branch: "main",
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
        head: "abc1234deadbeef",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        dirty: false,
      },
      {
        path: "/repo/.zone/repo/pr-123",
        zoneName: "pr-123",
        current: false,
        main: false,
        missing: false,
        branch: null,
        detached: true,
        bare: false,
        locked: false,
        prunable: false,
        head: "def5678deadbeef",
        upstream: null,
        ahead: null,
        behind: null,
        dirty: true,
      },
    ]);

    expect(output).toContain("*  main");
    expect(output).toContain("detached");
    expect(output).toContain("/repo/.zone/repo/pr-123");
  });

  test("shows missing for prunable worktrees whose directories are gone", () => {
    const output = formatWorktreeTable([
      {
        path: "/repo/.zone/repo/old-branch",
        zoneName: "old-branch",
        current: false,
        main: false,
        missing: true,
        branch: "old-branch",
        detached: false,
        bare: false,
        locked: false,
        prunable: true,
        head: "def5678deadbeef",
        upstream: null,
        ahead: null,
        behind: null,
        dirty: false,
      },
    ]);

    expect(output).toContain("missing");
  });
});
