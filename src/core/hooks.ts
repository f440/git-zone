import { spawn } from "node:child_process";
import process from "node:process";

import { HookExecutionError } from "./errors.js";
import type { GitRunner, HookContext, HookEvent } from "./types.js";

export type ShellRunner = (
  command: string,
  options: {
    cwd: string;
    env: Record<string, string>;
  },
) => Promise<number>;

const HOOK_CONFIG_KEYS: Record<HookEvent, string> = {
  "post-add": "zone.hooks.postAdd",
  "post-remove": "zone.hooks.postRemove",
};

export async function getHookCommand(
  runner: GitRunner,
  cwd: string,
  event: HookEvent,
): Promise<string | null> {
  const result = await runner(
    ["config", "--get", HOOK_CONFIG_KEYS[event]],
    { cwd, allowFailure: true },
  );

  if (result.exitCode !== 0) {
    return null;
  }

  return result.stdout.replace(/\r?\n$/, "");
}

export function buildHookEnvironment(context: HookContext): Record<string, string> {
  return {
    ZONE_EVENT: context.event,
    ZONE_REPO_ROOT: context.repoRoot,
    ZONE_MAIN_WORKTREE: context.mainWorktree,
    ZONE_WORKTREE_PATH: context.worktreePath,
    ZONE_ZONE_NAME: context.zoneName,
    ZONE_BRANCH: context.branch,
  };
}

export const shell: ShellRunner = async (command, options) =>
  await new Promise<number>((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", command], {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve(exitCode ?? 1);
    });
  });

export async function runHook(
  runner: GitRunner,
  context: HookContext,
  shellRunner: ShellRunner = shell,
): Promise<boolean> {
  const command = await getHookCommand(runner, context.mainWorktree, context.event);
  if (!command) {
    return false;
  }

  const exitCode = await shellRunner(command, {
    cwd: context.mainWorktree,
    env: buildHookEnvironment(context),
  });

  if (exitCode !== 0) {
    throw new HookExecutionError(context.event, exitCode, command);
  }

  return true;
}
