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
const cliPath = new URL("../cli.ts", import.meta.url).pathname;

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

function runCli(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["bun", "run", cliPath, ...args],
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: textDecoder.decode(result.stdout),
    stderr: textDecoder.decode(result.stderr),
  };
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
  test("adds worktrees for local branch, remote branch, tag, commit, and -b branch creation", async () => {
    const fixture = await setupRepositoryFixture();
    const initial = await repoState(fixture.repoPath);

    const localTarget = await resolveAddTarget(git, initial.repo, "feature/local");
    const localResult = await runAddCommand({
      runner: git,
      repo: initial.repo,
      target: localTarget,
      worktrees: initial.worktrees,
    });
    expect(localResult.lines[0]).toBe(`created worktree: ${path.join(fixture.zoneRoot, "feature-local")}`);
    expect(localResult.hookContext.branch).toBe("feature/local");
    expect(spawnGit(["rev-parse", "--abbrev-ref", "HEAD"], path.join(fixture.zoneRoot, "feature-local"))).toBe(
      "feature/local",
    );

    const afterLocal = await repoState(fixture.repoPath);
    const remoteTarget = await resolveAddTarget(git, afterLocal.repo, "origin/feature/remote");
    await runAddCommand({
      runner: git,
      repo: afterLocal.repo,
      target: remoteTarget,
      detach: true,
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
    const branchTarget = await resolveAddTarget(git, afterCommit.repo, "main");
    await runAddCommand({
      runner: git,
      repo: afterCommit.repo,
      target: branchTarget,
      branch: "spike/new-idea",
      branchMode: "create",
      worktrees: afterCommit.worktrees,
    });
    expect(
      spawnGit(["rev-parse", "--abbrev-ref", "HEAD"], path.join(fixture.zoneRoot, "spike-new-idea")),
    ).toBe("spike/new-idea");
  });

  test("creates a local branch by default for pull request targets", async () => {
    const fixture = await setupRepositoryFixture();
    const initial = await repoState(fixture.repoPath);
    const commit = spawnGit(["rev-parse", "HEAD"], fixture.repoPath);

    const result = await runAddCommand({
      runner: git,
      repo: initial.repo,
      target: {
        kind: "pr",
        number: 123,
        commit,
        remote: "origin",
        repository: { host: "github.com", owner: "f440", repo: "repo" },
        headBranch: "feature/pr-default",
      },
      worktrees: initial.worktrees,
    });

    expect(result.lines[1]).toBe("checked out: feature/pr-default");
    expect(
      spawnGit(["rev-parse", "--abbrev-ref", "HEAD"], path.join(fixture.zoneRoot, "feature-pr-default")),
    ).toBe("feature/pr-default");
  });

  test("creates a tracking branch from a unique remote branch name", async () => {
    const fixture = await setupRepositoryFixture();
    const initial = await repoState(fixture.repoPath);

    const target = await resolveAddTarget(git, initial.repo, "feature/remote");
    const result = await runAddCommand({
      runner: git,
      repo: initial.repo,
      target,
      worktrees: initial.worktrees,
    });

    expect(result.lines[1]).toBe("checked out: feature/remote");
    expect(
      spawnGit(["rev-parse", "--abbrev-ref", "HEAD"], path.join(fixture.zoneRoot, "feature-remote")),
    ).toBe("feature/remote");
    expect(
      spawnGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], path.join(fixture.zoneRoot, "feature-remote")),
    ).toBe("origin/feature/remote");
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

  test("lists worktrees as stable JSON for machine consumers", async () => {
    const fixture = await setupRepositoryFixture();
    expect(runCli(["add", "origin/feature/remote", "--detach"], fixture.repoPath).exitCode).toBe(0);
    await writeFile(path.join(fixture.repoPath, "dirty.txt"), "dirty\n");

    const result = runCli(["list", "--json"], fixture.repoPath);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as Array<{
      path: string;
      zoneName: string | null;
      current: boolean;
      main: boolean;
      branch: string | null;
      detached: boolean;
      upstream: string | null;
      ahead: number | null;
      behind: number | null;
      dirty: boolean;
    }>;

    expect(parsed[0]?.main).toBe(true);
    expect(parsed[0]?.current).toBe(true);
    expect(parsed[0]?.path).toBe(fixture.repoPath);
    expect(parsed[0]?.branch).toBe("main");
    expect(parsed[0]?.dirty).toBe(true);

    const detached = parsed.find((worktree) => worktree.zoneName === "origin-feature-remote");
    expect(detached?.detached).toBe(true);
    expect(detached?.branch).toBeNull();
    expect(detached?.upstream).toBeNull();
    expect(detached?.ahead).toBeNull();
    expect(detached?.behind).toBeNull();
  });

  test("removes worktrees, deletes branches, rejects main removal, and continues on mixed outcomes", async () => {
    const fixture = await setupRepositoryFixture();
    const initial = await repoState(fixture.repoPath);
    const branchTarget = await resolveAddTarget(git, initial.repo, "main");
    await runAddCommand({
      runner: git,
      repo: initial.repo,
      target: branchTarget,
      branch: "spike/remove-me",
      branchMode: "create",
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
    const firstResult = removeResult.results[0];
    expect(firstResult?.ok).toBe(true);
    if (firstResult?.ok) {
      expect(firstResult.lines).toContain(`removed: ${path.join(fixture.zoneRoot, "spike-remove-me")}`);
      expect(firstResult.lines).toContain("deleted branch: spike/remove-me");
      expect(firstResult.hookContext.branch).toBe("spike/remove-me");
    }

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
    expect(mixedResult.results.flatMap((item) => item.lines).join("\n")).toContain("main worktree cannot be removed");
    expect(mixedResult.results.flatMap((item) => item.lines).join("\n")).toContain("could not resolve remove target 'missing-target'");
  });

  test("runs postAdd hooks from the main worktree and passes hook env", async () => {
    const fixture = await setupRepositoryFixture();
    const outputPath = path.join(fixture.root, "hook-post-add.txt");

    await fs.mkdir(path.join(fixture.repoPath, "scripts"), { recursive: true });
    await writeFile(
      path.join(fixture.repoPath, "scripts", "zone-post-add"),
      `#!/bin/sh
set -eu
printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$PWD" "$ZONE_EVENT" "$ZONE_MAIN_WORKTREE" "$ZONE_WORKTREE_PATH" "$ZONE_ZONE_NAME" "$ZONE_BRANCH" > "${outputPath}"
`,
    );
    spawnGit(["config", "zone.hooks.postAdd", "./scripts/zone-post-add"], fixture.repoPath);
    await fs.chmod(path.join(fixture.repoPath, "scripts", "zone-post-add"), 0o755);

    const result = runCli(["add", "main", "-b", "feature/hooked"], fixture.repoPath);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("created worktree:");
    const hookOutput = (await fs.readFile(outputPath, "utf8")).trim().split("\n");
    expect(hookOutput[0]).toBe(fixture.repoPath);
    expect(hookOutput[1]).toBe("post-add");
    expect(hookOutput[2]).toBe(fixture.repoPath);
    expect(hookOutput[3]).toBe(path.join(fixture.zoneRoot, "feature-hooked"));
    expect(hookOutput[4]).toBe("feature-hooked");
    expect(hookOutput[5]).toBe("feature/hooked");
  });

  test("fails add when postAdd hook fails but leaves the worktree in place", async () => {
    const fixture = await setupRepositoryFixture();
    await fs.mkdir(path.join(fixture.repoPath, "scripts"), { recursive: true });
    await writeFile(
      path.join(fixture.repoPath, "scripts", "zone-post-add"),
      "#!/bin/sh\nexit 7\n",
    );
    spawnGit(["config", "zone.hooks.postAdd", "./scripts/zone-post-add"], fixture.repoPath);
    await fs.chmod(path.join(fixture.repoPath, "scripts", "zone-post-add"), 0o755);

    const result = runCli(["add", "main", "-b", "feature/failing-hook"], fixture.repoPath);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("created worktree:");
    expect(result.stderr).toContain("post-add hook failed with exit code 7");
    expect(
      spawnGit(["rev-parse", "--abbrev-ref", "HEAD"], path.join(fixture.zoneRoot, "feature-failing-hook")),
    ).toBe("feature/failing-hook");
  });

  test("runs postRemove hooks after removal and passes original branch info", async () => {
    const fixture = await setupRepositoryFixture();
    const addResult = runCli(["add", "main", "-b", "feature/remove-hook"], fixture.repoPath);
    expect(addResult.exitCode).toBe(0);

    const outputPath = path.join(fixture.root, "hook-post-remove.txt");
    await fs.mkdir(path.join(fixture.repoPath, "scripts"), { recursive: true });
    await writeFile(
      path.join(fixture.repoPath, "scripts", "zone-post-remove"),
      `#!/bin/sh
set -eu
printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$PWD" "$ZONE_EVENT" "$ZONE_MAIN_WORKTREE" "$ZONE_WORKTREE_PATH" "$ZONE_ZONE_NAME" "$ZONE_BRANCH" > "${outputPath}"
`,
    );
    spawnGit(["config", "zone.hooks.postRemove", "./scripts/zone-post-remove"], fixture.repoPath);
    await fs.chmod(path.join(fixture.repoPath, "scripts", "zone-post-remove"), 0o755);

    const removeResult = runCli(["remove", "feature/remove-hook", "-b"], fixture.repoPath);

    expect(removeResult.exitCode).toBe(0);
    expect(removeResult.stdout).toContain("removed:");
    const hookOutput = (await fs.readFile(outputPath, "utf8")).trim().split("\n");
    expect(hookOutput[0]).toBe(fixture.repoPath);
    expect(hookOutput[1]).toBe("post-remove");
    expect(hookOutput[2]).toBe(fixture.repoPath);
    expect(hookOutput[3]).toBe(path.join(fixture.zoneRoot, "feature-remove-hook"));
    expect(hookOutput[4]).toBe("feature-remove-hook");
    expect(hookOutput[5]).toBe("feature/remove-hook");
    await expect(fs.access(path.join(fixture.zoneRoot, "feature-remove-hook"))).rejects.toThrow();
  });

  test("continues remove when postRemove hook fails and returns non-zero overall", async () => {
    const fixture = await setupRepositoryFixture();
    expect(runCli(["add", "main", "-b", "feature/hook-one"], fixture.repoPath).exitCode).toBe(0);
    expect(runCli(["add", "main", "-b", "feature/hook-two"], fixture.repoPath).exitCode).toBe(0);

    await fs.mkdir(path.join(fixture.repoPath, "scripts"), { recursive: true });
    await writeFile(
      path.join(fixture.repoPath, "scripts", "zone-post-remove"),
      `#!/bin/sh
set -eu
if [ "$ZONE_ZONE_NAME" = "feature-hook-one" ]; then
  exit 9
fi
exit 0
`,
    );
    spawnGit(["config", "zone.hooks.postRemove", "./scripts/zone-post-remove"], fixture.repoPath);
    await fs.chmod(path.join(fixture.repoPath, "scripts", "zone-post-remove"), 0o755);

    const result = runCli(["remove", "feature/hook-one", "feature/hook-two", "-b"], fixture.repoPath);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(`removed: ${path.join(fixture.zoneRoot, "feature-hook-one")}`);
    expect(result.stdout).toContain(`removed: ${path.join(fixture.zoneRoot, "feature-hook-two")}`);
    expect(result.stderr).toContain("post-remove hook failed with exit code 9");
    await expect(fs.access(path.join(fixture.zoneRoot, "feature-hook-one"))).rejects.toThrow();
    await expect(fs.access(path.join(fixture.zoneRoot, "feature-hook-two"))).rejects.toThrow();
  });
});
