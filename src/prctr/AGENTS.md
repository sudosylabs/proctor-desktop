# Application source

Placement, layers, environment folders, services, contributions, and entrypoints
are owned by
[`source-code-organization`](../../.agents/skills/source-code-organization/SKILL.md).
Workbench mechanisms are owned by
[`develop-workbench`](../../.agents/skills/develop-workbench/SKILL.md). How
renderer classes, services, and contributions are written is owned by
[`write-workbench-code`](../../.agents/skills/write-workbench-code/SKILL.md). The root
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
- Code that creates DOM for its own window uses `h()`, `$()`, and `append()` from
  `base/browser/dom.ts`. Code that receives a `Document` or host element builds
  with `createElementFactory(document)` from `base/browser/documentElements.ts`,
  so nodes belong to the right window. `proctor/prefer-dom-helpers` rejects the
  global `document.createElement`, and `proctor/prefer-element-factory` rejects
  raw `createElement` everywhere else. The 22 files in
  `build/lint/legacyElementCreation.json` predate it; remove a file from that list
  when you migrate it, and never add one.
- Files carrying `@proctor-vscode-port` belong to a manifest under
  `docs/upstream/vscode-ports/`; change them only through
  [`adapt-vscode`](../../.agents/skills/adapt-vscode/SKILL.md).
