import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import pkg from "../package.json" with { type: "json" };

const textDecoder = new TextDecoder();
const completionPath = new URL("../completions/_git-zone", import.meta.url).pathname;

function spawnGit(args: string[], cwd: string): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test User",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test User",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed\n${textDecoder.decode(result.stderr)}`);
  }

  return textDecoder.decode(result.stdout).trim();
}

describe("zsh completion", () => {
  test("is included in published package files", () => {
    expect(pkg.files).toContain("completions");
  });

  test("has valid zsh syntax", () => {
    const result = Bun.spawnSync({
      cmd: ["zsh", "-n", completionPath],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(textDecoder.decode(result.stderr)).toBe("");
  });

  test("collects remove candidates without clobbering PATH", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "git-zone-completion-"));
    const repoPath = path.join(tempRoot, "repo");
    const worktreePath = path.join(tempRoot, "feature-remove-me");

    spawnGit(["init", repoPath], tempRoot);
    spawnGit(["config", "user.name", "Test User"], repoPath);
    spawnGit(["config", "user.email", "test@example.com"], repoPath);
    await fs.writeFile(path.join(repoPath, "README.md"), "seed\n", "utf8");
    spawnGit(["add", "README.md"], repoPath);
    spawnGit(["commit", "-m", "initial"], repoPath);
    spawnGit(["branch", "-M", "main"], repoPath);
    spawnGit(["worktree", "add", "-b", "feature/remove-me", worktreePath, "HEAD"], repoPath);

    const result = Bun.spawnSync({
      cmd: [
        "zsh",
        "-fc",
        `
          source <(sed '$d' "${completionPath}")
          _git_zone_collect_remove_candidates
          print -rl -- "\${_git_zone_remove_zone_cache[@]}"
          print -r -- --
          print -rl -- "\${_git_zone_remove_branch_cache[@]}"
          print -r -- --
          print -rl -- "\${_git_zone_remove_path_cache[@]}"
        `,
      ],
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);

    const [zonesRaw = "", branchesRaw = "", pathsRaw = ""] = textDecoder
      .decode(result.stdout)
      .trim()
      .split("\n--\n");

    expect(zonesRaw.split("\n")).toContain("feature-remove-me");
    expect(branchesRaw.split("\n")).toContain("feature/remove-me");
    expect(pathsRaw.split("\n")).toContain(worktreePath);
  });
});
