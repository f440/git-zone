import type { GitResult } from "./types.js";

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
      lines.push(`command: git ${this.gitResult.command.slice(1).join(" ")}`);
      if (this.gitResult.stderr.trim() !== "") {
        lines.push(`git stderr: ${this.gitResult.stderr.trim()}`);
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
