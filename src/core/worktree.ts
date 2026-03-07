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
): Promise<WorktreeStatus> {
  const headResult = await runner(["rev-parse", "--short", "HEAD"], {
    cwd: entry.path,
  });
  const shortHead = headResult.stdout.trim();

  let branchLabel = "detached";
  let upstream = "-";
  let divergence = "-";

  if (!entry.detached && entry.branch) {
    branchLabel = entry.branch;
    const upstreamResult = await runner(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      { cwd: entry.path, allowFailure: true },
    );

    if (upstreamResult.exitCode === 0) {
      upstream = upstreamResult.stdout.trim();
      const divergenceResult = await runner(
        ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        { cwd: entry.path },
      );
      const [aheadRaw, behindRaw] = divergenceResult.stdout.trim().split(/\s+/);
      const ahead = Number.parseInt(aheadRaw ?? "0", 10);
      const behind = Number.parseInt(behindRaw ?? "0", 10);
      divergence = formatDivergence(ahead, behind);
    }
  }

  const dirtyResult = await runner(["status", "--porcelain"], {
    cwd: entry.path,
  });

  return {
    marker: entry.isCurrent ? "*" : " ",
    branchLabel,
    shortHead,
    upstream,
    divergence,
    dirty: dirtyResult.stdout.trim() === "" ? "clean" : "dirty",
    path: entry.path,
  };
}

function formatDivergence(ahead: number, behind: number): string {
  if (ahead === 0 && behind === 0) {
    return "=";
  }
  if (ahead > 0 && behind === 0) {
    return `ahead ${ahead}`;
  }
  if (ahead === 0 && behind > 0) {
    return `behind ${behind}`;
  }
  return `ahead ${ahead}, behind ${behind}`;
}
