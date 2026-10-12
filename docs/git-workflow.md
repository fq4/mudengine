# Git workflow

Use the repository's configured `origin` remote and verify the branch before
publishing changes. Do not put API keys, passwords, access tokens, or private
certificates in commits.

## Inspect before changing anything

```powershell
git status --short
git branch -vv
git remote -v
git log --oneline -15
git fetch origin
```

The current branch and its upstream are shown by `git branch -vv`. A clean
working tree is safest before switching branches or pulling.

## Commit and push

```powershell
git add <files>
git diff --cached --check
git commit -m "Describe the change"
git push -u origin <branch>
```

Use a feature branch when `main` has unrelated history or when a pull request
is preferred:

```powershell
git switch -c feature/<name>
git push -u origin feature/<name>
```

Never force-push or discard local work to resolve an upstream mismatch. Fetch
first, compare histories, and merge or open a pull request deliberately.

## Verify the remote

```powershell
git ls-remote --heads origin
git rev-parse HEAD
git fetch origin
git log --oneline origin/<branch> -1
```

The commit IDs from the local `HEAD` and remote branch must match. The commit
can then be opened at:

`https://github.com/fq4/mudengine/commit/<sha>`

If authentication fails, confirm the remote URL with `git remote -v`, check
that the GitHub account has access to `fq4/mudengine`, and use the approved
credential helper or SSH configuration. Do not copy credentials into the
remote URL or commit them to the repository.
