export type ResolvedAddTarget =
  | { kind: "branch"; branch: string; commit: string }
  | { kind: "remote"; remoteBranch: string; commit: string; guessedLocalBranch?: string }
  | { kind: "tag"; tag: string; commit: string }
  | { kind: "commit"; rev: string; commit: string }
  | {
      kind: "pr";
      number: number;
      commit: string;
      remote: string;
      repository: ParsedGitHubRepo;
      headBranch: string;
    };

export type WorktreeEntry = {
  path: string;
  head: string;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  isCurrent: boolean;
};

export type RemoveResolution =
  | { kind: "path"; input: string; worktree: WorktreeEntry }
  | { kind: "branch"; input: string; worktree: WorktreeEntry; branch: string }
  | { kind: "zone"; input: string; worktree: WorktreeEntry; zoneName: string };

export type RepoContext = {
  cwd: string;
  currentWorktreePath: string;
  mainWorktreePath: string;
  commonGitDir: string;
  repoName: string;
  repoParent: string;
};

export type WorktreeStatus = {
  path: string;
  zoneName: string | null;
  current: boolean;
  main: boolean;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  head: string;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  dirty: boolean;
};

export type GitResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string[];
};

export type GitRunner = (
  args: string[],
  options?: {
    cwd?: string;
    allowFailure?: boolean;
  },
) => Promise<GitResult>;

export type ParsedGitHubRepo = {
  host: string;
  owner: string;
  repo: string;
};

export type ParsedPullRequestUrl = ParsedGitHubRepo & {
  number: number;
};

export type GitHubRemote = {
  name: string;
  repository: ParsedGitHubRepo;
};

export type PullRequestMetadata = {
  number: number;
  repository: ParsedGitHubRepo;
  remote: string;
  headBranch: string;
  headCommit: string;
};

export type HookEvent = "post-add" | "post-remove";

export type HookContext = {
  event: HookEvent;
  mainWorktree: string;
  worktreePath: string;
  zoneName: string;
  branch: string;
};

export type AddCommandResult = {
  lines: string[];
  hookContext: HookContext;
};

export type AddBranchMode = "create" | "reset";

export type RemoveCommandSuccess = {
  ok: true;
  lines: string[];
  hookContext: HookContext;
};

export type RemoveCommandFailure = {
  ok: false;
  lines: string[];
};

export type RemoveCommandItemResult = RemoveCommandSuccess | RemoveCommandFailure;

export type RemoveCommandResult = {
  results: RemoveCommandItemResult[];
  failures: number;
};
