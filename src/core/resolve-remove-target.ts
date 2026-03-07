import path from "node:path";

import { AmbiguousTargetError, TargetNotFoundError } from "./errors.js";
import type { RemoveResolution, WorktreeEntry } from "./types.js";

type Match = {
  kind: RemoveResolution["kind"];
  worktree: WorktreeEntry;
};

export function resolveRemoveTarget(
  input: string,
  cwd: string,
  worktrees: WorktreeEntry[],
): RemoveResolution {
  const absoluteInput = path.normalize(path.resolve(cwd, input));
  const matches: Match[] = [];

  for (const worktree of worktrees) {
    if (path.normalize(worktree.path) === absoluteInput) {
      matches.push({ kind: "path", worktree });
    }

    if (worktree.branch === input) {
      matches.push({ kind: "branch", worktree });
    }

    if (path.basename(worktree.path) === input) {
      matches.push({ kind: "zone", worktree });
    }
  }

  const uniqueWorktrees = new Map<string, Match[]>();
  for (const match of matches) {
    const key = path.normalize(match.worktree.path);
    const group = uniqueWorktrees.get(key) ?? [];
    group.push(match);
    uniqueWorktrees.set(key, group);
  }

  if (uniqueWorktrees.size === 0) {
    throw new TargetNotFoundError(`could not resolve remove target '${input}'`);
  }

  if (uniqueWorktrees.size > 1) {
    const details = [...uniqueWorktrees.values()].map((group) => {
      const kinds = [...new Set(group.map((entry) => entry.kind))].join(", ");
      return `matched: ${kinds} (${group[0]!.worktree.path})`;
    });
    throw new AmbiguousTargetError(`ambiguous target '${input}'`, {
      details: [...details, "please specify the full path"],
    });
  }

  const [group] = uniqueWorktrees.values();
  const preferred = group.find((entry) => entry.kind === "path")
    ?? group.find((entry) => entry.kind === "branch")
    ?? group[0]!;

  if (preferred.kind === "path") {
    return { kind: "path", input, worktree: preferred.worktree };
  }
  if (preferred.kind === "branch") {
    return {
      kind: "branch",
      input,
      worktree: preferred.worktree,
      branch: preferred.worktree.branch!,
    };
  }
  return {
    kind: "zone",
    input,
    worktree: preferred.worktree,
    zoneName: path.basename(preferred.worktree.path),
  };
}
