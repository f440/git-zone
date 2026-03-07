import { spawn } from "node:child_process";

import { PullRequestResolutionError } from "./errors.js";
import type {
  GitHubRemote,
  GitRunner,
  ParsedGitHubRepo,
  ParsedPullRequestUrl,
  PullRequestMetadata,
  RepoContext,
} from "./types.js";

export type PullRequestViewer = (
  number: number,
  repository: ParsedGitHubRepo,
) => Promise<{ headRefName: string; headRefOid: string }>;

export function parseGitHubRepoUrl(remoteUrl: string): ParsedGitHubRepo {
  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return {
      host: "github.com",
      owner: httpsMatch[1]!,
      repo: httpsMatch[2]!,
    };
  }

  const sshMatch = remoteUrl.match(/^(?:git@|ssh:\/\/git@)github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return {
      host: "github.com",
      owner: sshMatch[1]!,
      repo: sshMatch[2]!,
    };
  }

  throw new PullRequestResolutionError("remote is not a supported GitHub repository", {
    details: [`remote URL: ${remoteUrl}`],
  });
}

export function parsePullRequestUrl(input: string): ParsedPullRequestUrl {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new PullRequestResolutionError("invalid pull request URL", {
      details: [`input: ${input}`],
    });
  }

  if (url.hostname !== "github.com") {
    throw new PullRequestResolutionError("only github.com pull request URLs are supported", {
      details: [`host: ${url.hostname}`],
    });
  }

  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/);
  if (!match) {
    throw new PullRequestResolutionError("invalid GitHub pull request URL", {
      details: [`input: ${input}`],
    });
  }

  return {
    host: "github.com",
    owner: match[1]!,
    repo: match[2]!,
    number: Number.parseInt(match[3]!, 10),
  };
}

export async function listGitHubRemotes(
  runner: GitRunner,
  cwd: string,
): Promise<GitHubRemote[]> {
  const result = await runner(["config", "--get-regexp", "^remote\\..*\\.url$"], {
    cwd,
    allowFailure: true,
  });

  if (result.exitCode !== 0 || result.stdout.trim() === "") {
    return [];
  }

  const remotes: GitHubRemote[] = [];
  for (const line of result.stdout.trim().split("\n")) {
    const [key, ...valueParts] = line.split(/\s+/);
    const value = valueParts.join(" ");
    const match = key?.match(/^remote\.([^.]+)\.url$/);
    if (!match || value === "") {
      continue;
    }

    try {
      remotes.push({
        name: match[1]!,
        repository: parseGitHubRepoUrl(value),
      });
    } catch {
      // Ignore non-GitHub remotes.
    }
  }

  return remotes;
}

export async function listBaseResolvedRemoteNames(
  runner: GitRunner,
  cwd: string,
): Promise<string[]> {
  const result = await runner(["config", "--get-regexp", "^remote\\..*\\.gh-resolved$"], {
    cwd,
    allowFailure: true,
  });

  if (result.exitCode !== 0 || result.stdout.trim() === "") {
    return [];
  }

  return result.stdout
    .trim()
    .split("\n")
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts[1] === "base")
    .map((parts) => parts[0]?.match(/^remote\.([^.]+)\.gh-resolved$/)?.[1] ?? "")
    .filter((name) => name !== "");
}

export async function resolvePullRequestRemoteForNumber(
  runner: GitRunner,
  cwd: string,
): Promise<GitHubRemote> {
  const remotes = await listGitHubRemotes(runner, cwd);
  const baseResolved = await listBaseResolvedRemoteNames(runner, cwd);
  const baseMatches = remotes.filter((remote) => baseResolved.includes(remote.name));

  if (baseMatches.length === 1) {
    return baseMatches[0]!;
  }

  if (baseMatches.length > 1) {
    throw new PullRequestResolutionError("multiple remotes are marked as gh-resolved=base", {
      details: baseMatches.map((remote) => `remote: ${remote.name}`),
    });
  }

  const origin = remotes.find((remote) => remote.name === "origin");
  if (!origin) {
    throw new PullRequestResolutionError("origin remote is required to resolve pull requests");
  }

  return origin;
}

export async function resolvePullRequestRemoteForUrl(
  runner: GitRunner,
  cwd: string,
  repository: ParsedGitHubRepo,
): Promise<GitHubRemote> {
  const remotes = await listGitHubRemotes(runner, cwd);
  const matches = remotes.filter(
    (remote) =>
      remote.repository.owner === repository.owner
      && remote.repository.repo === repository.repo
      && remote.repository.host === repository.host,
  );

  if (matches.length === 1) {
    return matches[0]!;
  }

  if (matches.length === 0) {
    throw new PullRequestResolutionError("pull request URL does not match any GitHub remote in this repository", {
      details: [`url repository: ${repository.owner}/${repository.repo}`],
    });
  }

  const baseResolved = await listBaseResolvedRemoteNames(runner, cwd);
  const baseMatches = matches.filter((remote) => baseResolved.includes(remote.name));
  if (baseMatches.length === 1) {
    return baseMatches[0]!;
  }

  if (baseMatches.length > 1) {
    throw new PullRequestResolutionError("multiple matching remotes are marked as gh-resolved=base", {
      details: baseMatches.map((remote) => `remote: ${remote.name}`),
    });
  }

  throw new PullRequestResolutionError("pull request URL matches multiple remotes", {
    details: matches.map((remote) => `remote: ${remote.name}`),
  });
}

export const viewPullRequestWithGh: PullRequestViewer = async (number, repository) => {
  const repoSelector = `${repository.owner}/${repository.repo}`;

  const result = await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    error?: NodeJS.ErrnoException;
  }>((resolve) => {
    const child = spawn("gh", [
      "pr",
      "view",
      String(number),
      "--repo",
      repoSelector,
      "--json",
      "headRefName,headRefOid",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      resolve({ stdout, stderr, exitCode: 1, error });
    });
    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
  });

  if (result.error?.code === "ENOENT") {
    throw new PullRequestResolutionError("gh CLI is required to resolve pull requests");
  }

  if (result.exitCode !== 0) {
    throw new PullRequestResolutionError(`failed to load pull request #${number}`, {
      details: [`repository: ${repoSelector}`],
      gitResult: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        command: ["gh", "pr", "view", String(number), "--repo", repoSelector, "--json", "headRefName,headRefOid"],
      },
    });
  }

  let parsed: { headRefName?: string; headRefOid?: string };
  try {
    parsed = JSON.parse(result.stdout) as { headRefName?: string; headRefOid?: string };
  } catch {
    throw new PullRequestResolutionError(`failed to parse pull request metadata for #${number}`, {
      details: [`repository: ${repoSelector}`],
    });
  }

  if (!parsed.headRefName || !parsed.headRefOid) {
    throw new PullRequestResolutionError(`pull request metadata is incomplete for #${number}`, {
      details: [`repository: ${repoSelector}`],
    });
  }

  return {
    headRefName: parsed.headRefName,
    headRefOid: parsed.headRefOid,
  };
};

export async function fetchPullRequestCommit(
  runner: GitRunner,
  cwd: string,
  remoteName: string,
  number: number,
): Promise<string> {
  const ref = `refs/pull/${number}/head`;
  const fetchResult = await runner(["fetch", remoteName, ref], {
    cwd,
    allowFailure: true,
  });

  if (fetchResult.exitCode !== 0) {
    throw new PullRequestResolutionError(`failed to fetch pull request #${number}`, {
      details: [`tried: git fetch ${remoteName} ${ref}`],
      gitResult: fetchResult,
    });
  }

  const commitResult = await runner(["rev-parse", "FETCH_HEAD^{commit}"], {
    cwd,
    allowFailure: true,
  });

  if (commitResult.exitCode !== 0 || commitResult.stdout.trim() === "") {
    throw new PullRequestResolutionError(`failed to resolve fetched pull request #${number}`, {
      details: [`tried: git fetch ${remoteName} ${ref}`, "FETCH_HEAD did not resolve to a commit"],
      gitResult: commitResult,
    });
  }

  return commitResult.stdout.trim();
}

export async function resolvePullRequestMetadata(
  runner: GitRunner,
  repo: RepoContext,
  input: string,
  viewer: PullRequestViewer = viewPullRequestWithGh,
): Promise<PullRequestMetadata> {
  let number: number;
  let remote: GitHubRemote;
  let repository: ParsedGitHubRepo;

  if (/^\d+$/.test(input)) {
    number = Number.parseInt(input, 10);
    remote = await resolvePullRequestRemoteForNumber(runner, repo.currentWorktreePath);
    repository = remote.repository;
  } else {
    const parsed = parsePullRequestUrl(input);
    number = parsed.number;
    repository = {
      host: parsed.host,
      owner: parsed.owner,
      repo: parsed.repo,
    };
    remote = await resolvePullRequestRemoteForUrl(runner, repo.currentWorktreePath, repository);
  }

  const viewed = await viewer(number, repository);
  const fetchedCommit = await fetchPullRequestCommit(
    runner,
    repo.currentWorktreePath,
    remote.name,
    number,
  );

  return {
    number,
    repository,
    remote: remote.name,
    headBranch: viewed.headRefName,
    headCommit: fetchedCommit,
  };
}
