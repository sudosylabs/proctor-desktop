# Application source

Placement, layers, environment folders, services, contributions, and entrypoints
are owned by
[`source-code-organization`](../../.agents/skills/source-code-organization/SKILL.md).
Workbench mechanisms are owned by
[`develop-workbench`](../../.agents/skills/develop-workbench/SKILL.md). The root
[`AGENTS.md`](../../AGENTS.md) holds the universal engineering rules.

Lint and repository checks enforce part of this mechanically; passing them does
not replace the review questions in
[`code-review`](../../.agents/skills/code-review/SKILL.md).

- Relative TypeScript imports end in `.ts` or `.js` exactly as the surrounding
  folder does; match the neighbouring files.
- Authored comments name symbols and behavior, never a document, skill, or scratch
  path. `repository.hygiene` rejects those references.
- Synchronous `node:fs` calls are rejected by `proctor/no-sync-fs`; an exception
  needs a reason in `eslint.config.mjs`.
- Code that creates DOM uses the document it was given, or `h()`, `$()`, and
  `append()` from `base/browser/dom.ts`. `proctor/prefer-dom-helpers` rejects the
  global `document.createElement`.
- Files carrying `@proctor-vscode-port` belong to a manifest under
  `docs/upstream/vscode-ports/`; change them only through
  [`adapt-vscode`](../../.agents/skills/adapt-vscode/SKILL.md).
