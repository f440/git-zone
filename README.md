# git-zone

Create git worktrees for branches, PRs, and refs

## Synopsis

```
git zone [<ref-or-pr>] [-c|--create <branch-name>]
```

## Description

git-zone creates isolated git worktrees for development work. It wraps `git-worktree` with convenient shortcuts for branches, pull requests, tags, and commits.

Unlike `git switch`, git-zone creates separate working directories instead of switching the current repository state. Each worktree maintains its own working directory and index while sharing the same Git history.

## Options

- **-c**, **--create** *branch-name*  
  Create a new branch named *branch-name* before switching to the worktree.

- **-h**, **--help**  
  Show usage information and exit.

## Arguments

- *ref-or-pr*  
  Reference to checkout. Can be a branch name, tag, commit hash, PR number, or PR URL. If omitted, uses the current commit.

## Installation

Place the git-zone script (located at `bin/git-zone`) in a directory within your PATH. The script will be available as both `git-zone` and `git zone`.

```bash
curl -O https://raw.githubusercontent.com/f440/git-zone/main/bin/git-zone
chmod +x git-zone
mv git-zone /usr/local/bin/
```

For zsh completion, copy `_git-zone` to your completions directory:

```bash
curl -O https://raw.githubusercontent.com/f440/git-zone/main/_git-zone
mv _git-zone ~/.zsh/completions/
```

## Examples

Create worktree for existing branch:

```bash
git zone feature-branch
```

Create worktree for remote branch:

```bash
git zone origin/main
```

Create new branch from current commit:

```bash
git zone -c new-feature
```

Create new branch from specific commit:

```bash
git zone abc1234 -c fix-bug
```

Checkout PR by number:

```bash
git zone 123
```

Checkout PR by URL:

```bash
git zone https://github.com/owner/repo/pull/123
```

Create worktree from tag:

```bash
git zone v1.2.3
```

Use current commit when no reference specified:

```bash
git zone -c quick-fix
```

## Worktree Setup Hooks

After creating a worktree, git-zone checks the repository's git config for a `zone.setup` entry. When present, the configured shell snippet runs with `WORKTREE_ROOT` and `ZONE_DIR` exported so you can link dotfiles, install dependencies, or launch tooling inside the worktree.

Simple example:

```bash
git config zone.setup 'cd "$ZONE_DIR" && ln -snf "$WORKTREE_ROOT/.env" "$ZONE_DIR/.env" && npm install'
```

Use `git config --global` if you want a default hook for every repository; per-repo configs override the global one.

## Exit Status

git-zone exits with status 0 on success, 1 on error.

## Dependencies

- **git** - Required for all operations
- **gh** - Required for pull request operations

## Environment Variables

`zone.setup` hooks receive two environment variables:

- `WORKTREE_ROOT` – The repository path returned by `git worktree list`.
- `ZONE_DIR` – The directory path of the worktree that was just created.

## Integration Examples

Directory layout after running git-zone:

```
my-project/                 # Main repository
my-project.feature-branch/  # Worktree for feature-branch
my-project.pr-123/          # Worktree for PR #123
```

Pair the hook with [mise](https://mise.jdx.dev/):

```bash
git config zone.setup 'ln -sf "$WORKTREE_ROOT/.mise.local.toml" "$ZONE_DIR/" && mise trust "$ZONE_DIR" && mise run zone:setup'
```

Example `.mise.local.toml` for the `zone:setup` task:

See `mise.local.toml.example` for a more complete, multi-step setup definition you can adapt to your project.

```toml
[tasks."zone:setup"]
usage = '''
flag "--worktree-root <worktree_root>" help="Path to the worktree root directory" env="WORKTREE_ROOT"
flag "--zone-dir <zone_dir>" help="Path to the zone directory to set up" env="ZONE_DIR"
'''
run = """
ln -snf "${usage_worktree_root?}/.env" "${usage_zone_dir?}/"
npm install
"""
```

## See Also

git-worktree(1), git-switch(1), gh-pr-checkout(1)
