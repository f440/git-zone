import { PullRequestResolutionError } from "./errors.js";
import type { GitRunner, ParsedGitHubRepo, ParsedPullRequestUrl, RepoContext } from "./types.js";

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

  throw new PullRequestResolutionError("origin is not a supported GitHub repository", {
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

export async function resolvePullRequestCommit(
  runner: GitRunner,
  repo: RepoContext,
  number: number,
  expectedRepo?: ParsedGitHubRepo,
): Promise<{ commit: string; remote: string }> {
  const remoteName = "origin";
  const remoteUrlResult = await runner(["remote", "get-url", remoteName], {
    cwd: repo.currentWorktreePath,
    allowFailure: true,
  });

  if (remoteUrlResult.exitCode !== 0) {
    throw new PullRequestResolutionError("origin remote is required to resolve pull requests");
  }

  const originRepo = parseGitHubRepoUrl(remoteUrlResult.stdout.trim());
  if (
    expectedRepo &&
    (expectedRepo.owner !== originRepo.owner || expectedRepo.repo !== originRepo.repo)
  ) {
    throw new PullRequestResolutionError("pull request URL repository does not match origin", {
      details: [
        `origin: ${originRepo.owner}/${originRepo.repo}`,
        `url: ${expectedRepo.owner}/${expectedRepo.repo}`,
      ],
    });
  }

  const ref = `refs/pull/${number}/head`;
  const lsRemote = await runner(["ls-remote", remoteName, ref], {
    cwd: repo.currentWorktreePath,
    allowFailure: true,
  });

  if (lsRemote.exitCode === 0 && lsRemote.stdout.trim() !== "") {
    const commit = lsRemote.stdout.trim().split(/\s+/)[0]!;
    const catFile = await runner(["cat-file", "-e", `${commit}^{commit}`], {
      cwd: repo.currentWorktreePath,
      allowFailure: true,
    });
    if (catFile.exitCode === 0) {
      return { commit, remote: remoteName };
    }
  }

  const fetchResult = await runner(["fetch", remoteName, ref], {
    cwd: repo.currentWorktreePath,
    allowFailure: true,
  });

  if (fetchResult.exitCode !== 0) {
    throw new PullRequestResolutionError(`failed to resolve pull request #${number}`, {
      details: [`tried: git ls-remote ${remoteName} ${ref}`, `tried: git fetch ${remoteName} ${ref}`],
      gitResult: fetchResult,
    });
  }

  const commitResult = await runner(["rev-parse", "FETCH_HEAD^{commit}"], {
    cwd: repo.currentWorktreePath,
    allowFailure: true,
  });

  if (commitResult.exitCode !== 0 || commitResult.stdout.trim() === "") {
    throw new PullRequestResolutionError(`failed to resolve pull request #${number}`, {
      details: [`tried: git fetch ${remoteName} ${ref}`, "FETCH_HEAD did not resolve to a commit"],
      gitResult: commitResult,
    });
  }

  return { commit: commitResult.stdout.trim(), remote: remoteName };
}
