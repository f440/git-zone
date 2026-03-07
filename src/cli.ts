import process from "node:process";

import pkg from "../package.json" with { type: "json" };
import { runAddCommand } from "./commands/add.js";
import { runListCommand } from "./commands/list.js";
import { runRemoveCommand } from "./commands/remove.js";
import { CliError, HookExecutionError, UsageError } from "./core/errors.js";
import { git } from "./core/git.js";
import { runHook } from "./core/hooks.js";
import { resolveRepoContext } from "./core/repo.js";
import { resolveAddTarget } from "./core/resolve-target.js";
import { getWorktreeEntries } from "./core/worktree.js";

type ParsedArgs =
  | { kind: "global-help" }
  | { kind: "global-version" }
  | { kind: "add"; target?: string; createBranch?: string }
  | { kind: "list" }
  | { kind: "remove"; inputs: string[]; deleteBranch: boolean; force: boolean };

const GLOBAL_HELP = `git-zone

Usage:
  git-zone --help
  git-zone --version
  git-zone add [<target>] [-c|--create-branch <name>]
  git-zone list
  git-zone remove <name-or-path>... [-b|--delete-branch] [-f|--force]
`;

const ADD_HELP = `git-zone add

Usage:
  git-zone add
  git-zone add <target>
  git-zone add <target> -c <branch-name>
  git-zone add -c <branch-name>
`;

const LIST_HELP = `git-zone list

Usage:
  git-zone list
`;

const REMOVE_HELP = `git-zone remove

Usage:
  git-zone remove <name-or-path>... [-b|--delete-branch] [-f|--force]
`;

export async function main(argv: string[]): Promise<number> {
  try {
    const parsed = parseArgs(argv);

    if (parsed.kind === "global-help") {
      process.stdout.write(`${GLOBAL_HELP}\n`);
      return 0;
    }
    if (parsed.kind === "global-version") {
      process.stdout.write(`${pkg.version}\n`);
      return 0;
    }
    if (argv.includes("-h") || argv.includes("--help")) {
      if (parsed.kind === "add") {
        process.stdout.write(`${ADD_HELP}\n`);
      } else if (parsed.kind === "list") {
        process.stdout.write(`${LIST_HELP}\n`);
      } else if (parsed.kind === "remove") {
        process.stdout.write(`${REMOVE_HELP}\n`);
      }
      return 0;
    }

    const repo = await resolveRepoContext(process.cwd(), git);
    const worktrees = await getWorktreeEntries(git, repo.currentWorktreePath, repo.currentWorktreePath);

    if (parsed.kind === "add") {
      const target = await resolveAddTarget(git, repo, parsed.target);
      const result = await runAddCommand({
        runner: git,
        repo,
        target,
        createBranch: parsed.createBranch,
        worktrees,
      });
      process.stdout.write(`${result.lines.join("\n")}\n`);
      try {
        await runHook(git, result.hookContext);
      } catch (error) {
        if (error instanceof HookExecutionError) {
          process.stderr.write(`${error.message}\n`);
          return 1;
        }
        throw error;
      }
      return 0;
    }

    if (parsed.kind === "list") {
      const output = await runListCommand({
        runner: git,
        repo,
        worktrees,
      });
      process.stdout.write(`${output}\n`);
      return 0;
    }

    const result = await runRemoveCommand({
      runner: git,
      repo,
      worktrees,
      inputs: parsed.inputs,
      deleteBranch: parsed.deleteBranch,
      force: parsed.force,
    });
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    let failures = result.failures;

    for (const item of result.results) {
      if (!item.ok) {
        stderrLines.push(...item.lines);
        continue;
      }

      stdoutLines.push(...item.lines);
      try {
        await runHook(git, item.hookContext);
      } catch (error) {
        if (error instanceof HookExecutionError) {
          failures += 1;
          stderrLines.push(error.message);
          continue;
        }
        throw error;
      }
    }

    if (stdoutLines.length > 0) {
      process.stdout.write(`${stdoutLines.join("\n")}\n`);
    }
    if (stderrLines.length > 0) {
      process.stderr.write(`${stderrLines.join("\n")}\n`);
    }
    return failures === 0 ? 0 : 1;
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`${error.format()}\n`);
      return error.exitCode;
    }

    if (error instanceof Error) {
      process.stderr.write(`error: ${error.message}\n`);
      return 1;
    }

    process.stderr.write("error: unknown failure\n");
    return 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    return { kind: "global-help" };
  }

  if (argv[0] === "-v" || argv[0] === "--version") {
    return { kind: "global-version" };
  }

  const [command, ...rest] = argv;
  switch (command) {
    case "add":
      return parseAddArgs(rest);
    case "list":
      return parseListArgs(rest);
    case "remove":
      return parseRemoveArgs(rest);
    default:
      throw new UsageError(`unknown command: ${command}`);
  }
}

function parseAddArgs(args: string[]): ParsedArgs {
  let target: string | undefined;
  let createBranch: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "-h" || arg === "--help") {
      return { kind: "add" };
    }
    if (arg === "-c" || arg === "--create-branch") {
      const next = args[index + 1];
      if (!next || next.startsWith("-")) {
        throw new UsageError(`${arg} requires a branch name`);
      }
      if (createBranch) {
        throw new UsageError(`${arg} can only be specified once`);
      }
      createBranch = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new UsageError(`unknown option: ${arg}`);
    }
    if (target) {
      throw new UsageError("add accepts at most one target");
    }
    target = arg;
  }

  return { kind: "add", target, createBranch };
}

function parseListArgs(args: string[]): ParsedArgs {
  if (args.length === 0 || (args.length === 1 && (args[0] === "-h" || args[0] === "--help"))) {
    return { kind: "list" };
  }
  throw new UsageError(`unknown option: ${args[0]}`);
}

function parseRemoveArgs(args: string[]): ParsedArgs {
  const inputs: string[] = [];
  let deleteBranch = false;
  let force = false;

  for (const arg of args) {
    if (arg === "-h" || arg === "--help") {
      return { kind: "remove", inputs: [], deleteBranch: false, force: false };
    }
    if (arg === "-b" || arg === "--delete-branch") {
      deleteBranch = true;
      continue;
    }
    if (arg === "-f" || arg === "--force") {
      force = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new UsageError(`unknown option: ${arg}`);
    }
    inputs.push(arg);
  }

  if (inputs.length === 0) {
    throw new UsageError("remove requires at least one target");
  }

  return { kind: "remove", inputs, deleteBranch, force };
}

if (import.meta.main) {
  const exitCode = await main(process.argv.slice(2));
  process.exit(exitCode);
}
