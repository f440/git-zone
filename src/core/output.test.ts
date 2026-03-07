import { describe, expect, test } from "bun:test";

import { formatWorktreeTable } from "./output.js";

describe("formatWorktreeTable", () => {
  test("aligns rows into columns", () => {
    const output = formatWorktreeTable([
      {
        marker: "*",
        branchLabel: "main",
        shortHead: "abc1234",
        upstream: "origin/main",
        divergence: "=",
        dirty: "clean",
        path: "/repo",
      },
      {
        marker: " ",
        branchLabel: "detached",
        shortHead: "def5678",
        upstream: "-",
        divergence: "-",
        dirty: "dirty",
        path: "/repo/.zone/repo/pr-123",
      },
    ]);

    expect(output).toContain("*  main");
    expect(output).toContain("detached");
    expect(output).toContain("/repo/.zone/repo/pr-123");
  });
});
