---
name: develop-execution-environment
description: Design, implement, or review Proctor Desktop remote Execution Environment and integrated terminal capability, PTY open/input/resize/output/close transport, Attempt/Session/Connection/Participation fencing, Workspace projection synchronization, terminal workbench presentation, backpressure, privacy, or lifecycle. Use before changing terminal or remote execution integration.
---

# Develop the Execution Environment

Keep the first terminal a small projection over one server-authorized remote PTY
and keep the Execution Environment filesystem outside Workspace authority.

## 1. Load authority

Read [Execution Environment architecture](../../../docs/architecture/execution-environment.md),
[Attempt Workspace architecture](../../../docs/architecture/attempt-workspace.md),
[identity and exam security](../../../docs/architecture/identity-and-exam-security.md),
and [workbench architecture](../../../docs/architecture/workbench.md). Use
[`develop-attempt-workspace`](../develop-attempt-workspace/SKILL.md) for
persistence/reconciliation, [`develop-workbench`](../develop-workbench/SKILL.md)
for PanelPart UI,
[`develop-identity-and-exam-security`](../develop-identity-and-exam-security/SKILL.md)
for gates, and [`source-code-organization`](../source-code-organization/SKILL.md)
for placement. Use [`adapt-vscode`](../adapt-vscode/SKILL.md) before importing
or emulating VS Code terminal code.

The step is complete when environment/PTY authority, transport process,
Workspace prerequisite, generation scope, and terminal content classification
are explicit.

For projection, observation, cursor or host-fence changes, load the exact
[execution contract](../../../docs/contracts/execution.md). Use
[live participation](../../../docs/contracts/secure-participation.md) for
containment effects and [corrections](../../../docs/contracts/live-corrections.md)
for per-capability acknowledgement gates.

## 2. Preserve the initial PTY seam

Expose only open, input, resize, output, and close for one PTY on the active
connection. Keep local shell/process APIs, replay, persistent sessions, tabs,
splits, tasks, debugging, and arbitrary environment/profile selection outside
the interface. Candidate presentation reports enabled/disabled/unavailable
without host or image secrets.

The step is complete when deleting the server adapter leaves no local-execution
fallback and renderer code sees no host, port, credential, PID, path, or generic
WebSocket.

## 3. Fence every action

Bind open and subsequent frames to current Attempt, Desktop Session,
Connection, and Participation generation. Require active Attempt, open Sitting,
usable Secure Exam Posture, admitted execution profile, and ready environment.
Reject stale renderer/session/connection/generation. The reusable host sees only
opaque grant/epoch/fence revision; Proctor owns exam identity mapping. Persist
same-epoch fencing or retire the epoch, and match every effect acknowledgement
against the current durable decision.

Pause gates input/resize/open. Required native/terminal-correction containment
freezes the running guest; retain pending/unavailable state until its current
fence confirms the effect. Confirm authorized thaw before reopening input. Suspension, submission, manager end, Sitting
close, Session invalidation, or supersession closes the model/transport. Ready
rejoin creates a new generation and new PTY on demand without replay. The step
is complete when each lifecycle transition has one server-authoritative and one
local presentation outcome.

## 4. Respect Workspace authority

Settle required Working Overlay generations before execution that needs current
work. Observe environment watcher changes only after they return through
canonical Workspace mutations/cursors. Treat conflicts, ignored paths,
projection failure, and unknown outcomes as Workspace reconciliation, not a
parallel file model. Never infer durability from terminal output or VM paths.

The step is complete when Workspace tests can replace the execution adapter
without changing acknowledgement semantics.

Apply acknowledged saves incrementally without replacing the watcher baseline
or retiring a healthy PTY. Bind guest observations to immutable event-time bytes,
stable identities, semantic directory operations and projected expected versions.
Wait for the acknowledged Workspace cursor to reach the host before execution.
Preserve protective refusals until the pinned reusable host passes conformance.

## 5. Bound terminal transport and UI

Use explicit bounded input/output/resize frames, output ordering, backpressure,
and overflow/error state. Put authenticated handles and reconnect policy in
privileged transport; give the Candidate PanelPart one bounded model and closed
intents. Keep terminal content out of generic restoration, diagnostics,
telemetry, and integrity data.

Use product-UI/accessibility/layout/design-system skills for opening/ready/
paused/closed/failed state, focus/keyboard behavior, screen-reader status, zoom,
high contrast, and reduced motion. Presentation preferences may change fonts,
cursor, contrast, and bounded scrollback only.

The step is complete when flow control is bounded and UI state cannot select a
process, shell, environment, or capability.

## 6. Verify

Test capability projection, frame validation/bounds/order, output backpressure,
open/input/resize/output/close, process exit, transport loss, stale events,
Attempt/Session/Connection/generation fencing, pause/suspension/completion/
rejoin, Workspace settlement/watch-back, privacy, accessibility, and absence of
local execution.

The work is complete when transport, Workspace integration, Candidate panel,
server agreement fixtures, diagnostics, and tests express the same one-remote-
PTY boundary.
