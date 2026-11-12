# Native rules

Rules turn native facts into the requirement statuses that drive the readiness overview, local
containment and the server's own evaluation. The server compiles them from the exam's per-family
options; Desktop evaluates them in the native agent. The process model is in
[`native-capabilities.md`](./native-capabilities.md) and the facts each rule can read are in
[`native-capability-families.md`](./native-capability-families.md).

## Requirements and statuses

A rule states a **requirement**: something that must be true, such as "exactly one physical
display" or "none of these applications running". At every moment it has one status:

- **met**: the facts show the requirement holds;
- **not met**: the facts show it does not;
- **unknown**: the facts cannot tell. The cause is one of: capability unavailable, unhealthy,
  permission not granted, partial certainty, a gap in events, or an application identity still
  being verified.

| mode      | readiness overview and Start              | during participation                  | server                                                  |
| --------- | ----------------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `enforce` | blocks Start while not met **or unknown** | contains while not met **or unknown** | a lasting not-met opens an occurrence and raises a Flag |
| `observe` | shown, never blocks                       | reported, never contains              | recorded only                                           |

Unknown status, gaps, permission problems and failed capabilities are operational facts: they
contain an enforce rule but never become misconduct by themselves.

## Policy shape

```text
Policy
  activations: Activation[]      which capabilities run, and their sub-categories
  rules: Rule[]                  at most 64, baseline included

Activation
  capability                     must be a registered capability
  categories                     only for capabilities with sub-categories; only these are queried

Rule
  rule_id                        unique in the policy
  capability                     must be activated
  mode: enforce | observe
  phase: readiness | participation | both
  reason                         registered for the capability; Desktop owns its localized text
  requirement: Condition

Condition =
    Compare     { field, op, value }   op: eq | ne | lt | le | gt | ge | in | not_in
  | All         { conditions }
  | Any         { conditions }
  | Not         { condition }
  | AppsAbsent  { catalog_app_ids }    blocklist: none of these running
  | AppsOnly    { catalog_app_ids }    allowlist: nothing outside these and the OS-essential set
```

- `field` is a name from the **registered field list** generated from the Rust fact types (for
  example `display.summary.active_physical`). A field that is not registered is refused.
- `value` has the field's type: a number for counts, one of the field's enum values for states.
  There are no strings, patterns, paths or code.
- Coverage, certainty, health and permission are **not** rule fields: they are the envelope that
  decides whether a comparison is known (see Evaluation).
- `AppsAbsent` and `AppsOnly` apply only to `process_application`, and a rule has **at most one**
  application condition. They are matched inside the agent against the device-only inventory and
  the release-owned, signed application catalog. The agent reports one match per rule:
  `matched = true` means the condition is violated (for `AppsAbsent`, a listed application is
  running; for `AppsOnly`, an application outside the list is running), so the condition is not
  met; `matched = false` means it is met.

**Bounds:** at most 64 rules, 16 comparisons per rule, nesting depth 3 (a leaf is depth 1 and each
`All`, `Any` or `Not` adds one, so `All { Any { Compare } }` is the deepest allowed) and 256
catalog IDs per application condition. A policy outside these bounds, or naming an unregistered capability, field,
value or reason, is refused before any permission prompt or capability start.

## Evaluation

Conditions use three-valued (Kleene) logic:

| operands                           | `All`   | `Any`   |
| ---------------------------------- | ------- | ------- |
| any operand not met                | not met | —       |
| any operand met                    | —       | met     |
| otherwise, with an unknown operand | unknown | unknown |

`Not` swaps met and not met and keeps unknown.

- Every leaf reports the **first** cause that applies, in this order:
  1. `unavailable`: no state yet, the compared field is missing, or (for `AppsAbsent` / `AppsOnly`)
     no match has been reported for the rule;
  2. `gap`: events were lost, or an interruption happened, and no fresh complete state has arrived
     since;
  3. `unhealthy`: the capability is `unsupported`, `failed` or `stopped` (`degraded` still runs;
     its certainty decides);
  4. `permission`: its permission is not granted;
  5. `partial`: its certainty is not complete;
  6. `checking` (application conditions only): a new process is still being identified.

  Partial certainty therefore makes the baseline **unknown (partial)**, never not met.

- When unknowns combine in `All` or `Any`, the reported cause is that of the **first** unknown
  operand in order.
- A rule is evaluated against the **latest complete state** of its capability.
- The **first evaluation** at activation sets the status directly, with no stability wait.
- **Recovery is slower than violation.** After that, not met or unknown → met happens only after the
  facts stay met for the capability's stability time, a fixed per-capability release constant.
  Met → not met or unknown is immediate.

## Baseline rules

The release owns rules that every policy carries unchanged:

| rule                      | requirement                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `baseline.single_display` | one connected display, which is physical and active (unknown unless certainty is complete)             |
| `baseline.window`         | the CandidateWindow is maximized and its content protection is verified where the platform supports it |
| `baseline.session`        | the candidate owns the console, the session is unlocked, no remote attachment, no other human session  |

The server can neither remove nor weaken them.

## Reporting

For each rule, every status change is reported with the rule, the new status, the unknown cause
when unknown, the fact (capability, source instance, sequence) that caused it, and the local effect.
The local effect is `contained` or `released` on every status reported in the batch that flipped
containment, and `none` otherwise; containment exists only during participation. The server re-evaluates the same rules on the same facts. If
Desktop's status differs, the server's evaluation wins and the difference is recorded.

## Conformance

Desktop publishes conformance vectors generated from its Rust tests: rules, a sequence of facts,
and the expected statuses, including every unknown case. The server's evaluator must pass the same
vectors, so both sides implement identical semantics.
