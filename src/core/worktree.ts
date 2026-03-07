import path from "node:path";

import type { GitRunner, WorktreeEntry, WorktreeStatus } from "./types.js";

export function parseWorktreeList(
  porcelain: string,
  currentWorktreePath: string,
): WorktreeEntry[] {
  const blocks = porcelain
    .trim()
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter((block) => block !== "");

  return blocks.map((block) => {
    const entry: WorktreeEntry = {
      path: "",
      head: "",
      branch: null,
      detached: false,
      bare: false,
      locked: false,
      prunable: false,
      isCurrent: false,
    };

    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) {
        entry.path = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        entry.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        const fullRef = line.slice("branch ".length);
        entry.branch = fullRef.startsWith("refs/heads/")
          ? fullRef.slice("refs/heads/".length)
          : fullRef;
      } else if (line === "detached") {
        entry.detached = true;
      } else if (line === "bare") {
        entry.bare = true;
      } else if (line.startsWith("locked")) {
        entry.locked = true;
      } else if (line.startsWith("prunable")) {
        entry.prunable = true;
      }
    }

    entry.isCurrent = path.normalize(entry.path) === path.normalize(currentWorktreePath);
    return entry;
  });
}

export async function getWorktreeEntries(
  runner: GitRunner,
  cwd: string,
  currentWorktreePath: string,
): Promise<WorktreeEntry[]> {
  const result = await runner(["worktree", "list", "--porcelain"], { cwd });
  return parseWorktreeList(result.stdout, currentWorktreePath);
}

export async function collectWorktreeStatus(
  runner: GitRunner,
  entry: WorktreeEntry,
  mainWorktreePath: string,
): Promise<WorktreeStatus> {
  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;

  if (!entry.detached && entry.branch) {
    const upstreamResult = await runner(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      { cwd: entry.path, allowFailure: true },
    );

    if (upstreamResult.exitCode === 0) {
      upstream = upstreamResult.stdout.trim();
      const aheadBehindResult = await runner(
        ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        { cwd: entry.path },
      );
      const [aheadRaw, behindRaw] = aheadBehindResult.stdout.trim().split(/\s+/);
      ahead = Number.parseInt(aheadRaw ?? "0", 10);
      behind = Number.parseInt(behindRaw ?? "0", 10);
    }
  }

  const dirtyResult = await runner(["status", "--porcelain"], {
    cwd: entry.path,
  });

  return {
    path: entry.path,
    zoneName: path.normalize(entry.path) === path.normalize(mainWorktreePath)
      ? null
      : path.basename(entry.path),
    current: entry.isCurrent,
    main: path.normalize(entry.path) === path.normalize(mainWorktreePath),
    branch: entry.branch,
    detached: entry.detached,
    bare: entry.bare,
    locked: entry.locked,
    prunable: entry.prunable,
    head: entry.head,
    upstream,
    ahead,
    behind,
    dirty: dirtyResult.stdout.trim() !== "",
  };
}
