# Execution Environment and terminal architecture

## Scope and authority

An Execution Environment is the isolated remote environment used to run an Exam
Attempt. It projects authoritative Attempt Workspace state and hosts the
candidate's remote PTY. Its filesystem is neither a local workspace nor a
second authority for acknowledged work.

The Proctor Server owns environment lifecycle, image/profile selection,
Workspace projection/watch-back, PTY creation, Attempt/Participation
authorization, and terminal transport. Privileged Desktop transport owns the
authenticated connection and generation fencing. Candidate renderer owns the
terminal presentation and bounded input intents.

The first Desktop release supports one PTY for the active connection: open,
input, resize, output, and close. Local shell, command replay, persistent
terminal sessions, tabs, splits, tasks, debugging, and terminal-driven product
automation are outside the initial contract.

## Capability and lifecycle

Candidate presentation explicitly reports whether terminal access is enabled,
disabled, or temporarily unavailable without exposing host/image secrets.
Terminal opens only after:

- Attempt state is active;
- the current Desktop Session and Participation generation are valid;
- the Sitting is not paused;
- Secure Exam Posture and the frozen execution profile permit access;
- the current Execution Environment is ready.

The transport binds every terminal action to Attempt, Connection, and
Participation generation. A stale renderer, Session, connection, or generation
cannot reopen or write to the PTY. The renderer receives a terminal-session
selector and bounded stream events, not a host, port, credential, process ID,
filesystem path, or generic WebSocket.

Pause closes input/resize/open gates and presents the CandidateWindow overlay;
the server decides whether the PTY process is retained or closed. Suspension,
submission, manager End Attempt, Sitting close, Session invalidation, or stale
generation closes the Desktop terminal surface and its transport. Rejoining
ready creates a new Participation generation and opens a new PTY on demand;
there is no client-side replay of the old terminal.

## Workspace projection boundary

Before execution, the server projects acknowledged Attempt Workspace state into
the remote environment. Server-side watchers may persist permitted environment
changes back through canonical Workspace mutations. Desktop observes resulting
authoritative cursors/journal changes through `AttemptWorkspaceSession`; it does
not read the VM filesystem directly or infer acknowledgement from terminal
output.

Working Overlay state that the server has not acknowledged cannot be assumed to
exist in the Execution Environment. An execution action that requires current
work first settles the relevant local generation to authoritative persistence.
Watch-back conflicts, ignored/build paths, unknown outcomes, and projection
failure surface through Workspace reconciliation rather than a parallel file
model.

## Terminal presentation

The terminal contribution lives in CandidateWindow `PanelPart` and attaches to
one owning terminal model. It presents connection/opening/ready/paused/closing/closed/
failed states, remote process exit, bounded scrollback, and safe retry when
authorized. Closing the panel is presentation; it requests no local process and
does not imply Attempt departure.

Terminal preferences may control packaged presentation such as font metrics,
contrast, cursor, and bounded scrollback outside Attempt policy. They never
select a shell, executable, environment variable, working directory, network
route, persistence mode, or execution image.

Input uses explicit UTF-8/binary framing and bounded messages. Resize uses
validated rows/columns. Output applies backpressure and bounded buffering; loss
or overflow becomes an explicit terminal error and cannot be represented as
complete output. Terminal content is candidate work and remains out of ordinary
diagnostics, telemetry, integrity evidence, and generic restoration.
Requesting close synchronously enters a non-interactive `closing` phase before
the close frame is awaited, so no later input, resize, acknowledgement, or
duplicate close can overtake it.

## Module and process seams

Keep terminal state, framing, sequencing, and renderer-safe events in a small
environment-neutral contract. Keep authenticated WebSocket/session handles,
credentials, generation binding, and reconnect policy in privileged transport.
The terminal emulator and Candidate workbench contribution receive only the
bounded model and intents.

Execution Environment identifiers, profile details, and Workspace projection
remain server-adapter concerns. The Desktop interface exposes purpose-specific
availability and outcomes instead of a generic remote-process or filesystem
API.

## Verification

Verify:

- disabled/unavailable/enabled candidate presentation;
- open/input/resize/output/close framing and bounds;
- Attempt, Session, Connection, and Participation-generation fencing;
- pause, suspension, submission, manager end, Sitting close, and rejoin;
- output backpressure, ordering, disconnect, duplicate/stale events, exit, and
  transport failure;
- required Workspace persistence before execution and watcher reconciliation
  through authoritative cursors;
- absence of local shell/process/filesystem access, replay/persistence, and
  secrets/content in diagnostics;
- terminal keyboard, focus, screen-reader status, zoom, high contrast, and
  reduced-motion behavior.

Implementation, candidate presentation, server agreement fixtures, Workspace
integration, workbench contribution, and tests must express the same single-
remote-PTY boundary.
