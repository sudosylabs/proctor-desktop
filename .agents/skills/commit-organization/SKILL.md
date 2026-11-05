---
name: commit-organization
description: Organize and commit Proctor Desktop changes as coherent, independently reviewable commits. Use when asked to commit work, split a large change, plan a commit series, or validate that each commit stands alone.
---

# Commit organization

A commit expresses one purpose and carries the code, tests, generated output,
and documentation that purpose needs. A single cohesive change stays one commit.
Follow an explicit instruction to squash or group differently.

## 1. Establish scope

Inspect the branch, staged and unstaged diffs, untracked files, and renames
before staging anything. Preserve work that is not part of the request. Account
for changes already staged. Ignored paths such as `.scratch/` stay untracked.

This step is complete when every changed path is assigned to a commit or named
as excluded.

## 2. Design the series

Map each change or hunk to a commit with a one-line reason for its boundary.

- Separate independent features, fixes, tooling, and documentation.
- Keep a behavior change with its regression tests.
- Keep generated artifacts (`npm run generate` output, the server API snapshot,
  `package-lock.json`) and upstream provenance manifests with the change that
  produces or requires them.
- Put prerequisites before consumers. A refactor that preserves behavior and
  leaves a valid tree is its own commit.
- Split a shared file by hunk with `git add -p`, or with a reviewed patch applied
  to the index.

Use the repository's conventional-commit style (`feat`, `fix`, `chore`, `docs`;
`!` marks a breaking change) and explain what changed and why. Show the grouping
briefly, then proceed when committing is already authorized.

## 3. Stage and verify each commit

Stage explicit paths or hunks, then read the staged diff, including deletions
and renames. A passing full working tree does not prove an earlier commit works,
because unstaged files can hide a missing dependency. Validate HEAD plus the
index in isolation:

```bash
git worktree add --detach "$(mktemp -d)/check" HEAD
```

Apply the staged patch there with `git diff --cached | git -C <worktree> apply`,
link or install `node_modules`, and run the smallest checks that cover the
commit, such as `npm run check:types`, `npm run lint`, `node build/checks/main.ts`,
and the affected `node scripts/test.ts <suite>`. Remove the worktree afterwards.
When the series is small and each commit is clearly self-contained, regroup so
that no commit depends on a later one instead.

Run the configured hook (`.githooks/pre-commit`, which runs `npm run check:staged`)
and retain signing. If a hook rewrites files, review the change and restage only
what belongs to the current commit. Fix failures instead of bypassing hooks.

This step is complete when the commit exists and its contents match the plan.

## 4. Finish

Compare the finished series and `git status` with the inventory from step 1.
Report each commit hash with its purpose, the checks that ran and their results,
and anything left uncommitted or unverified. Organizing commits does not authorize
amending published commits, rewriting history, or pushing.
