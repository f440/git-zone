import type { GitResult, HookEvent } from "./types.js";

type ErrorOptions = {
  exitCode?: number;
  details?: string[];
  gitResult?: GitResult;
};

export class CliError extends Error {
  readonly exitCode: number;
  readonly details: string[];
  readonly gitResult?: GitResult;

  constructor(message: string, options: ErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details ?? [];
    this.gitResult = options.gitResult;
  }

  format(): string {
    const lines = [`error: ${this.message}`];

    for (const detail of this.details) {
      lines.push(detail);
    }

    if (this.gitResult) {
      lines.push(`command: ${this.gitResult.command.join(" ")}`);
      if (this.gitResult.stderr.trim() !== "") {
        lines.push(`stderr: ${this.gitResult.stderr.trim()}`);
      }
    }

    return lines.join("\n");
  }
}

export class UsageError extends CliError {}
export class NotGitRepositoryError extends CliError {}
export class UnsupportedRepositoryError extends CliError {}
export class TargetNotFoundError extends CliError {}
export class AmbiguousTargetError extends CliError {}
export class PathAlreadyExistsError extends CliError {}
export class GitCommandError extends CliError {}
export class PullRequestResolutionError extends CliError {}
export class HookExecutionError extends CliError {
  readonly event: HookEvent;
  readonly hookExitCode: number;
  readonly hookCommand: string;

  constructor(event: HookEvent, hookExitCode: number, hookCommand: string) {
    super(`${event} hook failed with exit code ${hookExitCode}`);
    this.event = event;
    this.hookExitCode = hookExitCode;
    this.hookCommand = hookCommand;
  }
}
