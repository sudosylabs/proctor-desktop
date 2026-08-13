# Issue tracker: local Markdown

Issues, specifications, and exploratory plans live as untracked Markdown files
under `.scratch/`.

## Conventions

- One effort per directory: `.scratch/<effort>/`.
- The specification is `.scratch/<effort>/spec.md`.
- Implementation tickets live at
  `.scratch/<effort>/issues/<NN>-<slug>.md`.
- Number tickets from `01`; keep one ticket per file.
- Record workflow state with a `Status:` line near the top.
- Append discussion under `## Comments`.

Use a canonical triage role from
[`triage-labels.md`](triage-labels.md) while an issue is being evaluated. A
wayfinding ticket may later use `claimed` or `resolved` as its workflow state.

## Publishing and fetching

When a skill says "publish to the issue tracker," create the appropriate file
under `.scratch/<effort>/`.

When a skill says "fetch the relevant ticket," read the referenced file.

## Wayfinding

- **Map:** `.scratch/<effort>/map.md`.
- **Child ticket:** `.scratch/<effort>/issues/<NN>-<slug>.md`.
- **Type:** record `research`, `prototype`, `grilling`, or `task` in a `Type:`
  line.
- **Status:** record `claimed` or `resolved` in a `Status:` line once work
  enters execution.
- **Blocking:** record dependencies as `Blocked by: NN, NN`.
- **Frontier:** choose the first numbered ticket that is open, unblocked, and
  unclaimed.
- **Claim:** set `Status: claimed` before beginning work.
- **Resolve:** append the result under `## Answer`, set `Status: resolved`, then
  update the map's decisions.

`.scratch/` is intentionally ignored. Distill accepted outcomes into tracked
product, architecture, contract, status, or test authorities before treating
the work as durable.
