import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runAddCommand } from "../commands/add.js";
import { runListCommand } from "../commands/list.js";
import { runRemoveCommand } from "../commands/remove.js";
import { git } from "../core/git.js";
import { resolveRepoContext } from "../core/repo.js";
import { resolveAddTarget } from "../core/resolve-target.js";
import { getWorktreeEntries } from "../core/worktree.js";

const textDecoder = new TextDecoder();

function spawnGit(args: string[], cwd: string, env: Record<string, string> = {}): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed\n${textDecoder.decode(result.stderr)}`,
    );
  }

  return textDecoder.decode(result.stdout).trim();
}

async function writeFile(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
}

async function setupRepositoryFixture(): Promise<{
  root: string;
  repoPath: string;
  zoneRoot: string;
}> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "git-zone-integration-"));
  const root = await fs.realpath(tempRoot);
  const remotePath = path.join(root, "remote.git");
  const seedPath = path.join(root, "seed");
  const repoPath = path.join(root, "repo");
  const env = {
    GIT_AUTHOR_NAME: "Test User",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test User",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };

  spawnGit(["init", "--bare", remotePath], root, env);
  spawnGit(["clone", remotePath, seedPath], root, env);
  spawnGit(["config", "user.name", "Test User"], seedPath, env);
  spawnGit(["config", "user.email", "test@example.com"], seedPath, env);
  await writeFile(path.join(seedPath, "README.md"), "seed\n");
  spawnGit(["add", "README.md"], seedPath, env);
  spawnGit(["commit", "-m", "initial"], seedPath, env);
  spawnGit(["branch", "-M", "main"], seedPath, env);
  spawnGit(["push", "-u", "origin", "main"], seedPath, env);
  spawnGit(["checkout", "-b", "feature/remote"], seedPath, env);
  await writeFile(path.join(seedPath, "remote.txt"), "remote branch\n");
  spawnGit(["add", "remote.txt"], seedPath, env);
  spawnGit(["commit", "-m", "remote branch"], seedPath, env);
  spawnGit(["push", "-u", "origin", "feature/remote"], seedPath, env);
  spawnGit(["checkout", "main"], seedPath, env);
  spawnGit(["tag", "v1.2.3"], seedPath, env);
  spawnGit(["push", "origin", "v1.2.3"], seedPath, env);
  spawnGit(["symbolic-ref", "HEAD", "refs/heads/main"], remotePath, env);

  spawnGit(["clone", remotePath, repoPath], root, env);
  spawnGit(["config", "user.name", "Test User"], repoPath, env);
  spawnGit(["config", "user.email", "test@example.com"], repoPath, env);
  spawnGit(["checkout", "-b", "feature/local"], repoPath, env);
  await writeFile(path.join(repoPath, "local.txt"), "local branch\n");
  spawnGit(["add", "local.txt"], repoPath, env);
  spawnGit(["commit", "-m", "local branch"], repoPath, env);
  spawnGit(["checkout", "main"], repoPath, env);

  return {
    root,
    repoPath,
    zoneRoot: path.join(root, ".zone", "repo"),
  };
}

async function repoState(repoPath: string) {
  const repo = await resolveRepoContext(repoPath, git);
  const worktrees = await getWorktreeEntries(git, repo.currentWorktreePath, repo.currentWorktreePath);
  return { repo, worktrees };
}

describe("integration: add/list/remove", () => {
  test("adds worktrees for local branch, remote branch, tag, commit, and create-branch", async () => {
    const fixture = await setupRepositoryFixture();
    const initial = await repoState(fixture.repoPath);

    const localTarget = await resolveAddTarget(git, initial.repo, "feature/local");
    const localLines = await runAddCommand({
      runner: git,
      repo: initial.repo,
      target: localTarget,
      worktrees: initial.worktrees,
    });
    expect(localLines[0]).toBe(`created worktree: ${path.join(fixture.zoneRoot, "feature-local")}`);
    expect(spawnGit(["rev-parse", "--abbrev-ref", "HEAD"], path.join(fixture.zoneRoot, "feature-local"))).toBe(
      "feature/local",
    );

    const afterLocal = await repoState(fixture.repoPath);
    const remoteTarget = await resolveAddTarget(git, afterLocal.repo, "origin/feature/remote");
    await runAddCommand({
      runner: git,
      repo: afterLocal.repo,
      target: remoteTarget,
      worktrees: afterLocal.worktrees,
    });
    expect(spawnGit(["rev-parse", "--abbrev-ref", "HEAD"], path.join(fixture.zoneRoot, "origin-feature-remote"))).toBe(
      "HEAD",
    );

    const afterRemote = await repoState(fixture.repoPath);
    const tagTarget = await resolveAddTarget(git, afterRemote.repo, "v1.2.3");
    await runAddCommand({
      runner: git,
      repo: afterRemote.repo,
      target: tagTarget,
      worktrees: afterRemote.worktrees,
    });
    expect(spawnGit(["rev-parse", "--abbrev-ref", "HEAD"], path.join(fixture.zoneRoot, "v1.2.3"))).toBe("HEAD");

    const commit = spawnGit(["rev-parse", "HEAD"], fixture.repoPath);
    const afterTag = await repoState(fixture.repoPath);
    const commitTarget = await resolveAddTarget(git, afterTag.repo, commit);
    await runAddCommand({
      runner: git,
      repo: afterTag.repo,
      target: commitTarget,
      worktrees: afterTag.worktrees,
    });
    expect(spawnGit(["rev-parse", "--abbrev-ref", "HEAD"], path.join(fixture.zoneRoot, `commit-${commit.slice(0, 7)}`))).toBe(
      "HEAD",
    );

    const afterCommit = await repoState(fixture.repoPath);
    const createBranchTarget = await resolveAddTarget(git, afterCommit.repo, "main");
    await runAddCommand({
      runner: git,
      repo: afterCommit.repo,
      target: createBranchTarget,
      createBranch: "spike/new-idea",
      worktrees: afterCommit.worktrees,
    });
    expect(
      spawnGit(["rev-parse", "--abbrev-ref", "HEAD"], path.join(fixture.zoneRoot, "spike-new-idea")),
    ).toBe("spike/new-idea");
  });

  test("rejects zone path collisions and branches already checked out", async () => {
    const fixture = await setupRepositoryFixture();
    const firstState = await repoState(fixture.repoPath);
    const firstTarget = await resolveAddTarget(git, firstState.repo, "feature/local");
    await runAddCommand({
      runner: git,
      repo: firstState.repo,
      target: firstTarget,
      worktrees: firstState.worktrees,
    });

    const secondState = await repoState(fixture.repoPath);
    const secondTarget = await resolveAddTarget(git, secondState.repo, "feature/local");
    await expect(
      runAddCommand({
        runner: git,
        repo: secondState.repo,
        target: secondTarget,
        worktrees: secondState.worktrees,
      }),
    ).rejects.toThrow();

    await fs.mkdir(path.join(fixture.zoneRoot, "main"), { recursive: true });
    const collisionState = await repoState(fixture.repoPath);
    const collisionTarget = await resolveAddTarget(git, collisionState.repo, "main");
    await expect(
      runAddCommand({
        runner: git,
        repo: collisionState.repo,
        target: collisionTarget,
        worktrees: collisionState.worktrees,
      }),
    ).rejects.toThrow("zone path already exists");
  });

  test("lists worktrees with main first and dirty state", async () => {
    const fixture = await setupRepositoryFixture();
    const initial = await repoState(fixture.repoPath);
    const target = await resolveAddTarget(git, initial.repo, "origin/feature/remote");
    await runAddCommand({
      runner: git,
      repo: initial.repo,
      target,
      worktrees: initial.worktrees,
    });

    await writeFile(path.join(fixture.repoPath, "dirty.txt"), "dirty\n");
    const listed = await repoState(fixture.repoPath);
    const output = await runListCommand({
      runner: git,
      repo: listed.repo,
      worktrees: listed.worktrees,
    });

    const lines = output.split("\n");
    expect(lines[0]?.startsWith("*")).toBe(true);
    expect(lines[0]).toContain("origin/main");
    expect(lines[0]).toContain("dirty");
    expect(output).toContain(path.join(fixture.zoneRoot, "origin-feature-remote"));
  });

  test("removes worktrees, deletes branches, rejects main removal, and continues on mixed outcomes", async () => {
    const fixture = await setupRepositoryFixture();
    const initial = await repoState(fixture.repoPath);
    const createBranchTarget = await resolveAddTarget(git, initial.repo, "main");
    await runAddCommand({
      runner: git,
      repo: initial.repo,
      target: createBranchTarget,
      createBranch: "spike/remove-me",
      worktrees: initial.worktrees,
    });

    const afterCreate = await repoState(fixture.repoPath);
    const removeResult = await runRemoveCommand({
      runner: git,
      repo: afterCreate.repo,
      worktrees: afterCreate.worktrees,
      inputs: ["spike/remove-me"],
      deleteBranch: true,
      force: false,
    });
    expect(removeResult.failures).toBe(0);
    expect(removeResult.lines).toContain(`removed: ${path.join(fixture.zoneRoot, "spike-remove-me")}`);
    expect(removeResult.lines).toContain("deleted branch: spike/remove-me");

    const branchLookup = Bun.spawnSync({
      cmd: ["git", "show-ref", "--verify", "--quiet", "refs/heads/spike/remove-me"],
      cwd: fixture.repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(branchLookup.exitCode).toBe(1);

    const currentState = await repoState(fixture.repoPath);
    const mixedResult = await runRemoveCommand({
      runner: git,
      repo: currentState.repo,
      worktrees: currentState.worktrees,
      inputs: ["main", "missing-target"],
      deleteBranch: false,
      force: false,
    });
    expect(mixedResult.failures).toBe(2);
    expect(mixedResult.lines.join("\n")).toContain("main worktree cannot be removed");
    expect(mixedResult.lines.join("\n")).toContain("could not resolve remove target 'missing-target'");
  });
});
