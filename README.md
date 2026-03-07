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

Create a worktree from the current `HEAD`:

```bash
git-zone add
```

Create a worktree for an existing branch:

```bash
git-zone add feature/login-fix
```

Create a new branch from `main` in a new worktree:

```bash
git-zone add main -c spike/new-idea
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
```

Remove a worktree:

```bash
git-zone remove pr-123
git-zone remove /full/path/to/worktree
git-zone remove feature/login-fix -b
```

## Commands

### `git-zone add [<target>]`

Creates a new worktree for the current repository.

If no target is provided, `git-zone` creates a detached worktree from the current `HEAD`.

The target can be:

- a local branch
- a remote-tracking branch such as `origin/main`
- a tag
- a commit or revision
- a GitHub pull request number
- a GitHub pull request URL

When the target is a local branch, the new worktree checks out that branch.
When the target is a pull request, the new worktree creates and checks out a local branch with the pull request head branch name by default.
When the target is a remote branch, tag, commit, or the current `HEAD`, the new worktree is created in detached HEAD state.

Use `-c` or `--create-branch` to create a new local branch from the resolved target:

```bash
git-zone add main -c spike/new-idea
git-zone add 123 -c fix/pr-123
git-zone add -c spike/current-head
```

Pull request resolution requires the GitHub CLI (`gh`).

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

### `git-zone remove <name-or-path>...`

Removes one or more worktrees from the current repository.

Each target can be resolved by:

- full path
- local branch name
- worktree directory name

Use `-b` or `--delete-branch` to delete the corresponding local branch after removing the worktree.
Use `-f` or `--force` to force removal when Git would normally refuse it.

## Hooks

`git-zone` can run user-defined commands after a worktree is added or removed.

Configure hooks with Git config:

```bash
git config zone.hooks.postAdd './scripts/zone-post-add'
git config zone.hooks.postRemove './scripts/zone-post-remove'
```

Hook commands are executed by `/bin/sh -c` from the main worktree directory.

`postAdd` runs after a worktree has been created successfully.
`postRemove` runs after a worktree has been removed successfully.

Hooks receive the following environment variables:

- `ZONE_EVENT`
- `ZONE_REPO_ROOT`
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
git-zone add origin/main -c feature/from-remote
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
