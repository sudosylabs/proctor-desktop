---
name: develop-integrated-browser
description: Design, implement, or review Proctor Desktop integrated Candidate browser policy, URL canonicalization, navigation enforcement, Electron session/webContents boundaries, Browser Activity collection, protected spooling, acknowledgement, privacy, manager access, or browser workbench presentation. Use before changing any exam-browser capability.
---

# Develop the integrated browser

Enforce one revision-frozen navigation contract while collecting only minimized
Attempt Browser Activity.

## 1. Load authority

Read [integrated browser architecture](../../../docs/architecture/integrated-browser.md),
[identity and exam security](../../../docs/architecture/identity-and-exam-security.md),
[workbench architecture](../../../docs/architecture/workbench.md), and
[invariants](../../../docs/architecture/invariants.md). Use
[`develop-workbench`](../develop-workbench/SKILL.md) for item/pane UI,
[`develop-identity-and-exam-security`](../develop-identity-and-exam-security/SKILL.md)
for admission/gates/integrity,
[`source-code-organization`](../source-code-organization/SKILL.md) for placement
and [`adapt-vscode`](../adapt-vscode/SKILL.md) before relying on VS Code browser
behavior.

The step is complete when the policy revision, Attempt/Participation scope,
privileged owner, collected fields, retention/access owner, and failure result
are explicit.

For DTOs, rule selection, source operations, evidence or retention changes, load
[the browser contract](../../../docs/contracts/browser.md) and
[protected delivery](../../../docs/contracts/protected-delivery.md).

## 2. Preserve the closed policy grammar

Accept only stable rule ID, exact HTTPS origin, optional normalized path prefix,
explicit subdomain wildcard, redirect permission, blocked consequence, and a
narrowly accepted HTTP exception. Use deterministic specificity, preserve the
contract's exact path bytes, and validate each redirect against both source and
destination rules. Share canonicalization fixtures with the server. Reject ambiguous wildcard/IDN/port/path forms, user-info, fragment
selectors, regex, unsafe/custom schemes, external apps, and unlisted downloads.

Only an immutable live correction may replace policy for an open Sitting. The
step is complete when authoring/server/Desktop canonicalization produces the
same decision for every fixture.

## 3. Enforce in the privileged browser boundary

Keep Electron session/webContents/request interception, navigation state, popup/
permission/download handling, and protected spool privileged. Candidate preload
exposes closed navigation intents and bounded presentation only. Check every
top-level request and redirect hop; contain prohibited subresource contact
without recording subresources as activity.

Open only while Attempt is active, Participation/current posture are valid, the
Sitting is not paused, and exact policy is loaded. Gate immediately on pause,
suspension, stale generation, policy loss, or coordinator failure. The step is
complete when no displayed URL, renderer request, redirect, popup, or external
scheme can bypass the policy owner.

## 4. Minimize Browser Activity

Record only browser open/close, successful top-level navigation, top-level
redirect, and blocked top-level attempt. Carry source instance, sequence,
Participation generation, kind, normalized scheme/host/port/path, matched rule,
and bounded times. Exclude user-info, fragments and query from retained activity. Preserve the
bounded block reason and redirect-source selector before spooling. Keep
subresources, page/DOM content, screenshots, cookies, headers, form values,
credentials, and system-browser history absent.

Allowed activity remains ordinary activity. Promote a blocked attempt only when
frozen policy explicitly chooses evidence. Use the agreed Flag group, detail
caps, overflow counts and review invalidation; unknown provenance stays unresolved. The step is complete when every
retained field has a purpose and no forbidden field reaches DTOs, logs, audit,
or fixtures.

## 5. Deliver ordered protected records

Bind each UUIDv4 source to one policy and Participation. Keep panel open/close
within that source; validate initial/correction/reset counters and metadata
reservations. A valid reset refused a successor still commits predecessor closure.
Spool bounded encrypted records, deduplicate by source/sequence/digest, and clean
up on exact durable receipts or explicit terminal loss. Settlement is not receipt.
Use server-owned closure/deadlines, bounded final declarations and historical-key
ownership. Submission accounts for every source across Participations. Keep
summary-only loss truthful and this spool separate from Workspace Recovery.

The step is complete when reconnect, duplicate, reordering, gap, overflow,
corruption, lost key, and automatic seal each yield one explicit outcome.

## 6. Preserve access and presentation

Authorize activity only to exact Attempt managers with the dedicated current
action and audit reads without copying URLs. Keep candidate disclosure and
Browser Activity retention separate from Integrity Evidence. Use the browser
`WorkbenchItem` for presentation only; the privileged coordinator owns policy
and lifecycle.

Use product-UI/accessibility/layout/design-system skills for address/status/
blocked states, keyboard navigation, focus return, zoom, high contrast, and
pause/suspension overlays. The step is complete when presentation cannot grant
navigation or reveal withheld integrity state.

## 7. Verify

Test canonicalization parity, redirects, popups, downloads, permissions,
schemes/external apps, subresource containment, admission/gating, source order,
spool replay/gaps, privacy stripping, cross-Attempt isolation, exact manager
authorization, retention, accessibility, and packaged Electron behavior.

The work is complete when policy/schema, privileged enforcement, activity
delivery, workbench UI, server agreement fixtures, and tests express the same
closed behavior.
