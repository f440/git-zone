import fs from "node:fs/promises";
import path from "node:path";

import { PathAlreadyExistsError, UsageError } from "./errors.js";
import type { RepoContext, ResolvedAddTarget } from "./types.js";

export function normalizeZoneName(input: string): string {
  const normalized = input
    .replaceAll("/", "-")
    .replaceAll(/[^A-Za-z0-9._-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  if (normalized === "") {
    throw new UsageError("zone name became empty after normalization", {
      details: [`input: ${input}`],
    });
  }

  return normalized;
}

export async function ensureZonePathDoesNotExist(zonePath: string): Promise<void> {
  try {
    await fs.access(zonePath);
  } catch {
    return;
  }

  throw new PathAlreadyExistsError(`zone path already exists: ${zonePath}`);
}

export async function ensureZonePathDoesNotExistWithContext(
  zonePath: string,
  options: {
    requestedName: string;
    normalizedName: string;
  },
): Promise<void> {
  try {
    await fs.access(zonePath);
  } catch {
    return;
  }

  throw new PathAlreadyExistsError(`zone path already exists: ${zonePath}`, {
    details: [
      `requested zone name: ${options.requestedName}`,
      `normalized zone name: ${options.normalizedName}`,
    ],
  });
}

export async function buildZonePath(
  repo: RepoContext,
  target: ResolvedAddTarget,
  pathTemplate: string,
  createBranch?: string,
): Promise<{ zoneName: string; zonePath: string }> {
  const requestedName = createBranch ?? zoneNameFromTarget(target);
  const zoneName = normalizeZoneName(requestedName);
  const zonePath = resolveZonePathTemplate(repo, pathTemplate, zoneName);
  await ensureZonePathDoesNotExistWithContext(zonePath, {
    requestedName,
    normalizedName: zoneName,
  });
  return { zoneName, zonePath };
}

export function resolveZonePathTemplate(
  repo: RepoContext,
  pathTemplate: string,
  workspace: string,
): string {
  if (!pathTemplate.includes("${workspace}")) {
    throw new UsageError("zone.workspace.pathTemplate must include ${workspace}");
  }
  if (!endsWithWorkspaceSegment(pathTemplate)) {
    throw new UsageError("zone.workspace.pathTemplate must place ${workspace} in the final path segment");
  }

  const expandedPath = pathTemplate
    .replaceAll("${repo}", repo.repoName)
    .replaceAll("${workspace}", workspace);

  if (path.isAbsolute(expandedPath)) {
    return path.normalize(expandedPath);
  }

  return path.resolve(repo.mainWorktreePath, expandedPath);
}

function endsWithWorkspaceSegment(pathTemplate: string): boolean {
  const normalizedTemplate = pathTemplate.replaceAll("\\", "/").replace(/\/+$/, "");
  const segments = normalizedTemplate.split("/");
  return segments[segments.length - 1] === "${workspace}";
}

function zoneNameFromTarget(target: ResolvedAddTarget): string {
  switch (target.kind) {
    case "branch":
      return target.branch;
    case "remote":
      return target.remoteBranch;
    case "tag":
      return target.tag;
    case "commit":
      return `commit-${target.commit.slice(0, 7)}`;
    case "pr":
      return `pr-${target.number}`;
  }
}
