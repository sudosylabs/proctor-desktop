---
name: code-review
description: Review Proctor Desktop branch, commit, or working-tree changes for correctness, architecture, lifecycle, security, accessibility, and verification evidence. Use when asked to review code or a pull request, or to check a change against the repository's rules before handoff.
---

# Code review

## 1. Fix the scope

Read any specification or reference the user supplied. Establish the comparison
point (merge base, commit, or working tree), then inspect status, log, and diff,
including untracked files. An empty diff may mean the work is uncommitted.
Respect read-only requests and isolate reproductions.

This step is complete when the reviewed change set is listed.

## 2. Apply the owning skills

Load the skills for the domains the change touches (`develop-workbench`,
`develop-identity-and-exam-security`, `develop-native-capabilities`,
`develop-user-settings`, `develop-attempt-workspace`, `develop-integrated-browser`,
`develop-toolchain`, the UI skills) and `source-code-organization` for placement.
Existing code is not precedent for lowering a documented rule.

## 3. Answer the architecture checklist

For every changed class, service, or task, a "no" is a finding unless the change
explains why.

| Question | Where the answer lives |
|---|---|
| Who owns each piece of state, exactly once? | A service, contribution, or process owner; never module-level mutable state |
| Which process or layer boundary does it cross, and is input validated by the owner? | `common` guards, IPC channel validation, `docs/architecture/` |
| Where is it registered and composed? | Contribution manifests, composition roots, constructor injection |
| How is it disposed, including after an `await`? | `_register`, `DisposableStore`, cancellation, disposed checks |
| Does a renderer interface expose Electron, Node, or native handles? | It must not |
| Does it follow the layer and environment rules? | `build/policies/source-boundaries.json`, `node build/checks/main.ts` |
| Is user-visible text localized and the control keyboard, screen-reader, zoom, high-contrast, and reduced-motion safe? | `develop-accessible-ui`, `develop-design-system` |
| Which upstream VS Code source was it compared with, and is provenance recorded? | `adapt-vscode`, `docs/upstream/vscode-ports/` |

Passing lint, types, and repository checks does not answer this table.

## 4. Check verification

Confirm which tests, checks, and platform environments actually ran
(`cross-platform-validation`). Reproduce an uncertain claim when feasible. When
reviewing a fix, revalidate the earlier findings and the adjacent callers and
recovery paths.

## 5. Report

Each finding states severity, exact location, the trigger, the consequence, and
the contract or evidence behind it. Rank correctness, security, and data-loss
defects above style. Separate required findings from optional notes. A clean
review states its scope and the verification it could not perform.
