import type { GitRunner, RepoContext } from "./types.js";
import { gitStdout } from "./git.js";

export const DEFAULT_WORKSPACE_PATH_TEMPLATE = "../.zone/${repo}/${workspace}";

export async function getWorkspacePathTemplate(
  runner: GitRunner,
  repo: RepoContext,
): Promise<string> {
  const configured = await gitStdout(
    runner,
    ["config", "--get", "zone.workspace.pathTemplate"],
    { cwd: repo.currentWorktreePath, allowFailure: true },
  );

  return configured === "" ? DEFAULT_WORKSPACE_PATH_TEMPLATE : configured;
}
