# git-zone

`git-zone` is a command-line tool for creating, listing, and removing Git worktrees with a simpler workflow than raw `git worktree` commands.

It is designed for the common cases developers reach for every day:

- open a worktree for an existing branch
- create a new branch in its own worktree
- inspect all worktrees in a repository at a glance
- remove a worktree by path, branch name, or directory name
- open a worktree from a GitHub pull request, tag, or commit

## Installation

Build the CLI and install it from this repository:

```bash
npm install
bun run build
npm install -g .
```

After installation, the command is available as:

```bash
git-zone
```

## Quick Start

Create a detached worktree from the current `HEAD` explicitly:

```bash
git-zone add HEAD --detach
```

Create a worktree for an existing branch:

```bash
git-zone add feature/login-fix
```

Create a new branch from `main` in a new worktree:

```bash
git-zone add main -b spike/new-idea
```

Open a pull request in its own worktree:

```bash
git-zone add 123
git-zone add https://github.com/owner/repo/pull/123
```

When the target is a pull request, `git-zone` creates a local branch using the pull request's head branch name by default.

Show all worktrees for the current repository:

```bash
git-zone list
git-zone list --json
```

Remove a worktree:

```bash
git-zone remove pr-123
git-zone remove /full/path/to/worktree
git-zone remove feature/login-fix -b
```

## Commands

### `git-zone add <target>`

Creates a new worktree for the current repository.

The target can be:

- a local branch
- a remote-tracking branch such as `origin/main`
- a tag
- a commit or revision
- a GitHub pull request number
- a GitHub pull request URL

Numeric targets are interpreted as pull request numbers before branch resolution. A branch name made only of digits will therefore be treated as a pull request target.

When the target is a local branch, the new worktree checks out that branch.
When the target is a pull request, the new worktree creates and checks out a local branch with the pull request head branch name by default.
When the target is a plain branch name and only a matching remote-tracking branch exists, `git-zone` creates a local tracking branch by default.
When the target is an explicit remote branch, tag, commit, or `HEAD`, the new worktree is created in detached HEAD state unless you choose a branch explicitly.

Use `-b` to create a new branch, `-B` to reset or reuse a branch name, `--detach` or `-d` to force detached HEAD, and `-f` or `--force` to ask Git to allow a branch that is already checked out in another worktree:

```bash
git-zone add main -b spike/new-idea
git-zone add 123 -b fix/pr-123
git-zone add origin/main -B feature/from-remote
git-zone add HEAD --detach
git-zone add HEAD -d
git-zone add main -f
git-zone add 123 --detach
```

Pull request resolution requires the GitHub CLI (`gh`).

`-f` does not bypass existing local branch collisions for `-b`, default pull request branch names, or zone path collisions.

New worktrees are created under a `.zone` directory next to the main repository, grouped by repository name.

### `git-zone list`

Shows every worktree registered for the current repository.

The output includes:

- the current worktree marker
- the checked out branch or `detached`
- the current short commit SHA
- upstream branch information
- ahead/behind status
- whether the worktree is clean or dirty
- the absolute path

Use `--json` for machine-readable output that is easier to consume from tools such as `fzf` and `jq`. The command returns a JSON array of worktree objects.

### `git-zone remove <name-or-path>...`

Removes one or more worktrees from the current repository.

Each target can be resolved by:

- full path
- local branch name
- worktree directory name

Use `-b` or `--delete-branch` to delete the corresponding local branch after removing the worktree.
Use `-f` or `--force` to force removal when Git would normally refuse it.

## Hooks

`git-zone` can run user-defined commands when a worktree is added or removed.

Configure hooks with Git config:

```bash
git config zone.hooks.postAdd './scripts/zone-post-add'
git config zone.hooks.preRemove './scripts/zone-pre-remove'
git config zone.hooks.postRemove './scripts/zone-post-remove'
```

Hook commands are executed by `/bin/sh -c` from the main worktree directory.

`postAdd` runs after a worktree has been created successfully.
`preRemove` runs before a worktree is removed. A non-zero exit aborts removal for that target.
`postRemove` runs after a worktree has been removed successfully.

Hooks receive the following environment variables:

- `ZONE_EVENT`
- `ZONE_MAIN_WORKTREE`
- `ZONE_WORKTREE_PATH`
- `ZONE_ZONE_NAME`
- `ZONE_BRANCH`

Example `postAdd` hook:

```bash
#!/bin/sh
set -eu

ln -sf "$ZONE_MAIN_WORKTREE/.env.local" "$ZONE_WORKTREE_PATH/.env.local"
```

Example `postRemove` hook:

```bash
#!/bin/sh
set -eu

tmux kill-session -t "zone-$ZONE_ZONE_NAME" || true
```

Example `preRemove` hook:

```bash
#!/bin/sh
set -eu

docker compose -p "zone-$ZONE_ZONE_NAME" down
```

## Examples

Create worktrees from different targets:

```bash
git-zone add main
git-zone add origin/main
git-zone add v1.2.3
git-zone add abc1234
git-zone add 123
```

Create a branch directly into a new worktree:

```bash
git-zone add origin/main -b feature/from-remote
```

Remove by branch name or directory name:

```bash
git-zone remove feature/login-fix
git-zone remove pr-123
```

## Help

```bash
git-zone --help
git-zone add --help
git-zone list --help
git-zone remove --help
```
