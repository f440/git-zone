# git-zone

`git-zone` is a command-line tool for creating, listing, and removing Git worktrees with a simpler workflow than raw `git worktree` commands.

It is designed for the common cases developers reach for every day:

- open a worktree for an existing branch
- create a new branch in its own worktree
- inspect all worktrees in a repository at a glance
- remove a worktree by path, branch name, or directory name
- open a worktree from a tag or commit

## Installation

Install from npm:

```bash
npm install -g @f440/git-zone
```

After installation, the command is available as:

```bash
git-zone
```

### Zsh completion

`git-zone` ships with a `zsh` completion file at `completions/_git-zone`.

For a global npm install, add the package completion directory to your `fpath` and initialize completions:

```bash
fpath+=("$(npm root -g)/@f440/git-zone/completions")
autoload -Uz compinit && compinit
```

When working from a local checkout of this repository, point `fpath` at the repository copy instead:

```bash
fpath+=("/path/to/git-zone/completions")
autoload -Uz compinit && compinit
```

After reloading your shell, `git-zone` completes subcommands, flags, Git refs for `add`, and existing worktree targets for `remove`.

For local development from this repository:

```bash
npm install
bun run build
npm install -g .
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

When the target is a local branch, the new worktree checks out that branch.
When the target is a plain branch name and only a matching remote-tracking branch exists, `git-zone` creates a local tracking branch by default.
When the target is an explicit remote branch, tag, commit, or `HEAD`, the new worktree is created in detached HEAD state unless you choose a branch explicitly.

Use `-b` to create a new branch, `-B` to reset or reuse a branch name, `--detach` or `-d` to force detached HEAD, and `-f` or `--force` to ask Git to allow a branch that is already checked out in another worktree:

```bash
git-zone add main -b spike/new-idea
git-zone add origin/main -B feature/from-remote
git-zone add HEAD --detach
git-zone add HEAD -d
git-zone add main -f
```

`-f` does not bypass existing local branch collisions for `-b`, default branch names guessed from remote-tracking branches, or zone path collisions.

Worktree placement is controlled by the Git config key `zone.workspace.pathTemplate`.
The template supports `${repo}`, `${workspace}`, and environment variables such as `${HOME}`.
Relative paths are resolved from the main worktree root.
`${workspace}` must be the final path segment.
Undefined environment variables are rejected as configuration errors.

```bash
git config zone.workspace.pathTemplate '../.zone/${repo}/${workspace}'
```

```bash
git config zone.workspace.pathTemplate '${HOME}/.local/share/git-zone/${workspace}'
```

If you want compatibility with Claude Code's `claude --worktree` layout, configure:

```bash
git config zone.workspace.pathTemplate '.claude/worktrees/${workspace}'
```

### Optional: `gh zone` alias for pull requests

If you use GitHub CLI, you can install an optional `gh zone` alias that fetches a pull request head ref and opens it with `git-zone`.

```sh
gh alias set --shell zone - <<'SH'
sel=$1
shift || { echo "usage: gh zone <pr-url-or-number> [git-zone args...]" >&2; exit 1; }

repo_of_remote() {
  url=$(git remote get-url "$1" 2>/dev/null) || return 1
  case "$url" in
    https://github.com/*) repo=${url#https://github.com/} ;;
    git@github.com:*) repo=${url#git@github.com:} ;;
    ssh://git@github.com/*) repo=${url#ssh://git@github.com/} ;;
    *) return 1 ;;
  esac
  printf '%s\n' "${repo%.git}"
}

base_remote() {
  for r in $(git remote); do
    [ "$(git config --get "remote.$r.gh-resolved" 2>/dev/null)" = "base" ] || continue
    [ -z "$found" ] || return 1
    found=$r
  done
  [ -n "$found" ] && printf '%s\n' "$found"
}

pick_remote_for_repo() {
  want=$1
  for r in $(git remote); do
    [ "$(repo_of_remote "$r")" = "$want" ] || continue
    if [ "$(git config --get "remote.$r.gh-resolved" 2>/dev/null)" = "base" ]; then
      printf '%s\n' "$r"
      return
    fi
    [ -z "$first" ] && first=$r || {
      echo "gh zone: multiple remotes match $want; mark one as gh-resolved=base" >&2
      return 1
    }
  done
  [ -n "$first" ] && printf '%s\n' "$first" || {
    echo "gh zone: no git remote matches $want" >&2
    return 1
  }
}

meta=$(gh pr view "$sel" --json number,headRefName --jq '[.number,.headRefName] | @tsv') || exit $?
pr=$(printf '%s\n' "$meta" | cut -f1)
branch=$(printf '%s\n' "$meta" | cut -f2-)

case "$sel" in
  https://github.com/*/pull/*|http://github.com/*/pull/*)
    path=${sel#https://github.com/}
    path=${path#http://github.com/}
    owner=${path%%/*}
    rest=${path#*/}
    repo=${rest%%/*}
    remote=$(pick_remote_for_repo "$owner/$repo") || exit 1
    ;;
  *)
    remote=$(git config --get checkout.defaultRemote 2>/dev/null || true)
    [ -n "$remote" ] || remote=$(base_remote 2>/dev/null || true)
    [ -n "$remote" ] || remote=origin
    ;;
esac

git fetch "$remote" "refs/pull/$pr/head" || exit $?

for a in "$@"; do
  case "$a" in
    -b|-B|--detach|-d) exec git zone add FETCH_HEAD "$@" ;;
  esac
done

exec git zone add FETCH_HEAD -b "$branch" "$@"
SH
```

Usage:

```sh
gh zone 12345
gh zone https://github.com/owner/repo/pull/12345
gh zone 12345 -B my/local-branch
```

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

## Release

`git-zone` is published to npm as `@f440/git-zone` through GitHub Actions trusted publishing.

Trusted Publisher should be configured in npm for:

- GitHub user: `f440`
- Repository: `git-zone`
- Workflow filename: `publish.yml`

To publish a new version:

```bash
npm version patch --no-git-tag-version
git commit -am "Prepare vX.Y.Z release"
git push origin main
npm run release:draft
```

Then open the draft GitHub Release, review the generated notes, and click Publish release.
The `publish.yml` workflow runs tests, builds the CLI, verifies the release tag matches `package.json`, and publishes to npm.
