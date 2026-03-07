import { spawn } from "node:child_process";

import { GitCommandError } from "./errors.js";
import type { GitResult, GitRunner } from "./types.js";

export const git: GitRunner = async (args, options = {}) => {
  const command = ["git", ...args];

  const result = await new Promise<GitResult>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: options.cwd,
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

    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 1,
        command,
      });
    });
  });

  if (result.exitCode !== 0 && !options.allowFailure) {
    throw new GitCommandError(`git command failed`, { gitResult: result });
  }

  return result;
};

export async function gitStdout(
  runner: GitRunner,
  args: string[],
  options?: { cwd?: string; allowFailure?: boolean },
): Promise<string> {
  const result = await runner(args, options);
  return result.stdout.trim();
}
