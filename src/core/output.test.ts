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
});
