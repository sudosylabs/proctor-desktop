# Domain and architecture routing

This file adapts engineering skills that expect conventional domain documents
to this repository's living knowledge system.

## Before exploring

Start at [`docs/README.md`](../README.md) and follow only the routes relevant to
the task:

- The [product brief](../product/brief.md) and
  [product model](../product/model.md) own product scope, vocabulary, actors,
  and workflows.
- [`docs/architecture/`](../architecture/) owns current module interfaces,
  seams, invariants, dependency direction, runtime flows, failure behavior,
  and rationale.
- [`docs/project/status.md`](../project/status.md) owns capability status and
  unresolved decisions.
- A contract beside its implementation owns exact module behavior when linked
  from the architecture guide.

Proceed silently when a routed topic does not yet exist. Do not invent settled
architecture to fill an empty category; record unresolved questions in project
status or the active `.scratch/` specification.

## Decision lifecycle

This repository does not use `CONTEXT.md`, `CONTEXT-MAP.md`, or an ADR
directory.

- Explore uncertain work under `.scratch/<effort>/`.
- Integrate an accepted decision into the living document for the topic it
  governs.
- Keep the resulting rule and concise rationale together.
- Update superseded rules in place.
- Use Git history for chronology.
- Create a new architecture topic only when no existing topic owns the
  decision.

## Vocabulary

Use terms from [`docs/product/model.md`](../product/model.md) consistently in
modules, interfaces, tests, tickets, and proposals.

A missing concept may indicate vocabulary drift or a real product-model gap.
Reconsider the term first; update the product model when the concept is real.

## Conflicts

Surface disagreements between code, tests, and authoritative documentation.
Classify the disagreement as stale documentation, an implementation defect, or
an incomplete migration before changing the authority.
