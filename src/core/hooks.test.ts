import { describe, expect, test } from "bun:test";

import { GitCommandError, HookExecutionError } from "./errors.js";
import {
  buildHookEnvironment,
  getHookCommand,
  runHook,
  type ShellRunner,
} from "./hooks.js";
import type { GitResult, GitRunner, HookContext } from "./types.js";

function createFakeRunner(resolver: (args: string[]) => GitResult): GitRunner {
  return async (args, options = {}) => {
    const result = resolver(args);
    if (result.exitCode !== 0 && !options.allowFailure) {
      throw new GitCommandError("git command failed", { gitResult: result });
    }
    return result;
  };
}

const context: HookContext = {
  event: "post-add",
  mainWorktree: "/repo",
  worktreePath: "/repo/.zone/repo/pr-123",
  zoneName: "pr-123",
  branch: "",
};

describe("getHookCommand", () => {
  test("returns configured hook command", async () => {
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "config --get zone.hooks.postAdd") {
        return { stdout: "./scripts/zone-post-add\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    await expect(getHookCommand(runner, "/repo", "post-add")).resolves.toBe("./scripts/zone-post-add");
  });

  test("returns null when hook is not configured", async () => {
    const runner = createFakeRunner((args) => {
      return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
    });

    await expect(getHookCommand(runner, "/repo", "post-remove")).resolves.toBeNull();
  });

  test("resolves pre-remove hook config", async () => {
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "config --get zone.hooks.preRemove") {
        return { stdout: "./scripts/zone-pre-remove\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    await expect(getHookCommand(runner, "/repo", "pre-remove")).resolves.toBe("./scripts/zone-pre-remove");
  });
});

describe("buildHookEnvironment", () => {
  test("builds the expected environment variables", () => {
    expect(buildHookEnvironment({
      ...context,
      branch: "feature/login-fix",
    })).toEqual({
      ZONE_EVENT: "post-add",
      ZONE_MAIN_WORKTREE: "/repo",
      ZONE_WORKTREE_PATH: "/repo/.zone/repo/pr-123",
      ZONE_ZONE_NAME: "pr-123",
      ZONE_BRANCH: "feature/login-fix",
    });
  });
});

describe("runHook", () => {
  test("runs shell command from the main worktree with hook env", async () => {
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "config --get zone.hooks.postAdd") {
        return { stdout: "echo ok\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    const calls: Array<{ command: string; cwd: string; env: Record<string, string> }> = [];
    const shellRunner: ShellRunner = async (command, options) => {
      calls.push({ command, cwd: options.cwd, env: options.env });
      return 0;
    };

    await expect(runHook(runner, context, shellRunner)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("echo ok");
    expect(calls[0]?.cwd).toBe("/repo");
    expect(calls[0]?.env.ZONE_EVENT).toBe("post-add");
    expect(calls[0]?.env.ZONE_ZONE_NAME).toBe("pr-123");
  });

  test("returns false when hook is unset", async () => {
    const runner = createFakeRunner((args) => {
      return { stdout: "", stderr: "", exitCode: 1, command: ["git", ...args] };
    });

    const shellRunner: ShellRunner = async () => {
      throw new Error("should not run");
    };

    await expect(runHook(runner, context, shellRunner)).resolves.toBe(false);
  });

  test("raises a hook execution error on non-zero exit", async () => {
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "config --get zone.hooks.postRemove") {
        return { stdout: "echo fail\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    const shellRunner: ShellRunner = async () => 7;

    await expect(async () =>
      runHook(runner, { ...context, event: "post-remove" }, shellRunner),
    ).toThrow(HookExecutionError);
  });

  test("passes pre-remove event through the hook environment", async () => {
    const runner = createFakeRunner((args) => {
      if (args.join(" ") === "config --get zone.hooks.preRemove") {
        return { stdout: "echo ok\n", stderr: "", exitCode: 0, command: ["git", ...args] };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });

    const calls: Array<{ command: string; cwd: string; env: Record<string, string> }> = [];
    const shellRunner: ShellRunner = async (command, options) => {
      calls.push({ command, cwd: options.cwd, env: options.env });
      return 0;
    };

    await expect(runHook(runner, { ...context, event: "pre-remove" }, shellRunner)).resolves.toBe(true);
    expect(calls[0]?.env.ZONE_EVENT).toBe("pre-remove");
  });
});
