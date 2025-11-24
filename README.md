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

## Files

- **.mise.local.toml**  
  Project-specific mise configuration. If present and mise is available, git-zone will link this file to new worktrees and run the `zone:setup` task.

- **mise.local.toml.example**  
  Example mise configuration file provided with git-zone.

## Exit Status

git-zone exits with status 0 on success, 1 on error.

## Dependencies

- **git** - Required for all operations
- **gh** - Required for pull request operations  
- **mise** - Optional. Automatically configures development environments when available

## Environment Variables

- **GIT_ZONE_MISE_SETUP_TASK**  
  Name of the mise task to run when setting up new worktrees. Defaults to `zone:setup`.

## Integration Examples

Directory layout after running git-zone:

```
my-project/                 # Main repository
my-project.feature-branch/  # Worktree for feature-branch
my-project.pr-123/          # Worktree for PR #123
```

Example .mise.local.toml for automatic worktree setup:

```toml
[tasks."zone:setup"]
run = """
WORKTREE_ROOT="{{arg(i=1)}}"
ZONE_DIR="{{arg(i=2)}}"
ln -snf "$WORKTREE_ROOT/.env" "$ZONE_DIR/.env"
npm install
"""
```

## See Also

git-worktree(1), git-switch(1), gh-pr-checkout(1)
