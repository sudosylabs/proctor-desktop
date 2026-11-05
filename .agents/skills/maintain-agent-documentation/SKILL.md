---
name: maintain-agent-documentation
description: Design, create, prune, or reorganize Proctor Desktop knowledge for agents. Use when editing AGENTS.md, repository skills, agent routing, docs/README.md, architecture or product guidance, scratch specifications, or when deciding whether knowledge belongs in instructions, a skill, tracked documentation, code/configuration, or ignored .scratch material.
---

# Maintain agent documentation

Give knowledge the smallest correct loading scope. One meaning has one owner.

## 1. Classify the knowledge

Place it by stability and trigger:

- `AGENTS.md`: universal, stable rules needed on nearly every repository task;
- `.agents/skills/<domain>/SKILL.md`: deep procedure or reference with a clear
  task trigger;
- `docs/product` or `docs/architecture`: accepted product language and
  cross-module current state;
- `.scratch/<effort>`: unresolved questions, competing designs, research, and
  temporary specifications;
- code, tests, configuration, or command help: facts cheap to discover there.

The step is complete when the knowledge has one authoritative owner and every
other mention is only a trigger-bearing pointer.

## 2. Write the route

Front-load a pointer with the task branch that should load its target. Keep the
root guide useful without requiring every linked document. Avoid index entries
that merely repeat a filename.

A new skill needs concrete recurring tasks and stable rules. Put every trigger
branch in its frontmatter description. Keep its body procedural and concise;
add references only when one branch needs detail the others do not.

Do not create a skill for a domain still under design. Grill it in `.scratch/`,
integrate accepted current state, then create the skill when it can reliably
change agent behavior.

## 3. Write for completion

Give each procedural step an observable completion condition. Group a concept's
rules and caveats together. Prefer positive target behavior and strong leading
words over repeated prohibitions.

Tracked documentation records current rules and concise rationale, not decision
chronology. Update a superseded rule in place and use Git history for chronology.

## 3a. Turn a correction into a rule

Read the user's example and the files it names before generalizing. An example
illustrates a broader concern; it is not necessarily the whole scope, and an
isolated incident is not a universal ban. Classify the cause: missing guidance,
weak discovery, conflicting rules, a stale fact, or an existing rule that was not
followed. Record the decision at its one owning level through the routing above,
supersede any conflicting earlier text in place, and do not copy the exchange
across several skills. Describe the target behavior and the evidence that shows
it, then check the change against a realistic task rather than the new wording.

## 4. Prune

Remove duplicated meaning, stale sediment, environment caches, weak pointers,
and instructions that do not change agent behavior. Delete a tracked topic when
its boundary is no longer accepted; move unresolved reasoning to `.scratch/`
rather than weakening the topic with disclaimers.

## 5. Verify

Check:

- every relative link resolves;
- tracked files contain no machine-specific absolute paths or dependencies on
  ignored material;
- `.scratch/` remains ignored;
- skill frontmatter names and descriptions trigger the intended tasks;
- skill UI metadata matches the skill body;
- no placeholder scaffolding or duplicate source of truth remains.

Run the skill validator for every changed skill and review the final routing
from a fresh agent's perspective.
