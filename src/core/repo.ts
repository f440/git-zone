import path from "node:path";

import { NotGitRepositoryError, UnsupportedRepositoryError } from "./errors.js";
import { gitStdout } from "./git.js";
import type { GitRunner, RepoContext } from "./types.js";

export async function resolveRepoContext(
  cwd: string,
  runner: GitRunner,
): Promise<RepoContext> {
  const insideWorkTree = await gitStdout(
    runner,
    ["rev-parse", "--is-inside-work-tree"],
    { cwd, allowFailure: true },
  );

  if (insideWorkTree !== "true") {
    throw new NotGitRepositoryError("not inside a git repository");
  }

  const isBare = await gitStdout(runner, ["rev-parse", "--is-bare-repository"], {
    cwd,
  });
  if (isBare === "true") {
    throw new UnsupportedRepositoryError("bare repositories are not supported");
  }

  const currentWorktreePath = await gitStdout(
    runner,
    ["rev-parse", "--path-format=absolute", "--show-toplevel"],
    { cwd },
  );
  const commonGitDir = await gitStdout(
    runner,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd },
  );

  const mainWorktreePath = path.dirname(commonGitDir);
  const repoName = path.basename(mainWorktreePath);

  return {
    cwd,
    currentWorktreePath,
    commonGitDir,
    mainWorktreePath,
    repoName,
  };
}
