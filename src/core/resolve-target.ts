import { AmbiguousTargetError, TargetNotFoundError } from "./errors.js";
import { resolvePullRequestMetadata } from "./github-pr.js";
import type { GitRunner, RepoContext, ResolvedAddTarget } from "./types.js";

async function refExists(
  runner: GitRunner,
  cwd: string,
  ref: string,
): Promise<boolean> {
  const result = await runner(["show-ref", "--verify", "--quiet", ref], {
    cwd,
    allowFailure: true,
  });
  return result.exitCode === 0;
}

async function resolveCommitFromRef(
  runner: GitRunner,
  cwd: string,
  ref: string,
): Promise<string> {
  const result = await runner(["rev-parse", `${ref}^{commit}`], {
    cwd,
  });
  return result.stdout.trim();
}

export async function resolveAddTarget(
  runner: GitRunner,
  repo: RepoContext,
  target?: string,
): Promise<ResolvedAddTarget> {
  if (!target) {
    const headResult = await runner(["rev-parse", "HEAD^{commit}"], {
      cwd: repo.currentWorktreePath,
    });
    return { kind: "head", commit: headResult.stdout.trim() };
  }

  if (target.startsWith("http://") || target.startsWith("https://")) {
    const resolved = await resolvePullRequestMetadata(runner, repo, target);
    return {
      kind: "pr",
      number: resolved.number,
      commit: resolved.headCommit,
      remote: resolved.remote,
      repository: resolved.repository,
      headBranch: resolved.headBranch,
    };
  }

  if (/^\d+$/.test(target)) {
    const resolved = await resolvePullRequestMetadata(runner, repo, target);
    return {
      kind: "pr",
      number: resolved.number,
      commit: resolved.headCommit,
      remote: resolved.remote,
      repository: resolved.repository,
      headBranch: resolved.headBranch,
    };
  }

  const matches = {
    branch: await refExists(runner, repo.currentWorktreePath, `refs/heads/${target}`),
    remote: await refExists(runner, repo.currentWorktreePath, `refs/remotes/${target}`),
    tag: await refExists(runner, repo.currentWorktreePath, `refs/tags/${target}`),
  };

  const matchedKinds = Object.entries(matches)
    .filter(([, matched]) => matched)
    .map(([kind]) => kind);

  if (matchedKinds.length > 1) {
    throw new AmbiguousTargetError(`ambiguous add target '${target}'`, {
      details: matchedKinds.map((kind) => `matched: ${kind}`),
    });
  }

  if (matches.branch) {
    return {
      kind: "branch",
      branch: target,
      commit: await resolveCommitFromRef(runner, repo.currentWorktreePath, `refs/heads/${target}`),
    };
  }

  if (matches.remote) {
    return {
      kind: "remote",
      remoteBranch: target,
      commit: await resolveCommitFromRef(runner, repo.currentWorktreePath, `refs/remotes/${target}`),
    };
  }

  if (matches.tag) {
    return {
      kind: "tag",
      tag: target,
      commit: await resolveCommitFromRef(runner, repo.currentWorktreePath, `refs/tags/${target}`),
    };
  }

  const commitResult = await runner(["rev-parse", "--verify", `${target}^{commit}`], {
    cwd: repo.currentWorktreePath,
    allowFailure: true,
  });

  if (commitResult.exitCode !== 0) {
    throw new TargetNotFoundError(`could not resolve add target '${target}'`, {
      details: [
        `tried local branch: refs/heads/${target}`,
        `tried remote-tracking branch: refs/remotes/${target}`,
        `tried tag: refs/tags/${target}`,
        `tried revision: ${target}^{commit}`,
      ],
    });
  }

  return {
    kind: "commit",
    rev: target,
    commit: commitResult.stdout.trim(),
  };
}
