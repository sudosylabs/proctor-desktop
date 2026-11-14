# Native capability architecture

## Scope and security claim

Native capabilities report bounded mechanical **facts** about the candidate's machine and
evaluate the exam's **rules** on those facts, so that Electron main can contain the
CandidateWindow immediately. They do not prove that a device is trustworthy, declare cheating,
create an Integrity Flag, or decide an Attempt consequence. The server decides: it re-evaluates
the same rules on the same facts, opens occurrences and raises flags.

The per-capability facts, platform coverage and privacy limits are defined in
[`native-capability-families.md`](./native-capability-families.md). The rule language is
defined in [`native-rules.md`](./native-rules.md). This document owns the process model,
lifecycle, protocol, failure, evidence and verification architecture.

Every fact states its permission, health, coverage and certainty. Unknown never counts as
compliant: an enforce rule that cannot be evaluated contains. Administrator/root control, kernel
compromise and external hardware remain outside the guaranteed threat boundary.

Secure candidate mode targets declared Windows and macOS versions and architectures, where every
capability is implemented to the strongest coverage the OS offers through public, unprivileged
APIs. Linux keeps the same interfaces and may report a capability as unsupported. Untested combinations fail preflight; there is no silently weakened mode. Exact
version ranges belong to the signed release capability matrix.

**Implementation status.** This architecture replaced an earlier design built on an Electron
utility process, a Node-API bridge and schema-generated Rust; that code has been removed. Every capability reads unprivileged, polling where the OS offers no event stream.
Electron main's exam participation service supervises the agent, delivers its records and passes
it host events (`platform/native/electron-main/candidateHostEvents.ts`); its production entry is
not composed yet. A capability counts as implemented on a platform only when its real-OS
tests prove each fact there.

Implemented in source:

- the protocol, core, rule evaluator and conformance vectors;
- the agent and Electron main's connection and service, tested end to end against the real binary;
- every capability in the registry on Windows, macOS and Linux: display topology, the candidate
  window, the unprivileged interactive session, clipboard, virtualization, network configuration,
  removable storage, printing, camera, microphone, process and application (matched against the
  bundled catalog) and screen recording readiness;
- OS interruptions;
- the screen evidence recorder.

The new crates' tests pass on macOS (Apple silicon), on a Windows laptop and in a Linux container;
real-OS tests prove each fact on the first two.

Known limits:

- Intel Macs report external displays unclassified (partial certainty); Apple silicon classifies
  them by framebuffer transport.
- Process and interactive-session reads are unprivileged polls: a change shorter than one poll
  interval can go unseen. A field the OS reports is complete; a field it cannot see unprivileged is
  reported `unknown`, so only a rule naming that field is unknown — not the whole capability.
- macOS cannot see screen sharing unprivileged, so `interactive_session.remote_attachment` is
  `unknown` on macOS; the always-on `baseline.session` rule does not require it. Windows reports RDP
  through `SM_REMOTESESSION`.
- On Windows, a process whose image cannot be opened (another session, SYSTEM) has no verified
  identity and classifies as unidentified.
- Reads still to be proved on certification rigs: Sidecar, AirPlay and DisplayLink displays; the
  macOS `utun` heuristic; Windows camera use from the ConsentStore; phones over PTP/MTP.

A privileged helper for full process and interactive-session coverage (a Windows service and a
macOS Endpoint Security daemon) was built and then removed on 2026-11-14 to ship without Apple's
Endpoint Security entitlement or candidate admin rights; it remains in git history (commit
`3a5c360`) for a later optional upgrade.

## Processes and ownership

```text
renderers (AuthenticatedWindow overview, CandidateWindow)
        │  sanitized projections: rule list, statuses, safe labels
        ▼
Electron main ──────────────── server: signed fact records, preflight report, clips
        │  one private pipe, length-prefixed JSON frames
        ▼
native agent (unprivileged Rust process inside the app bundle)
```

- **Native agent.** One unprivileged Rust binary that Electron main spawns **on demand**: while a
  readiness overview is open, and during an exam or re-entry. It runs the capability adapters,
  sequences their facts, evaluates the rules and records the screen when the policy enables it.
  Nothing observes the machine outside those windows.
- **Electron main** spawns and supervises the agent, applies containment to the CandidateWindow,
  owns permission requests and Proctor-owned effects (private clipboard, print-command denial,
  content protection), adds wall-clock time, signs records with the installation credential and
  delivers them to the server. It never evaluates rules itself.
- **Renderers** never reach the agent. Only Electron main holds the installation credential; the
  agent can never sign or send anything to the server.

The exam-security coordinator in Electron main owns policy authenticity, readiness and posture,
Participation continuity and delivery (see the
[identity and exam-security architecture](./identity-and-exam-security.md)). It consumes rule
statuses and facts from the agent instead of supervising sources or running detectors.

## Capabilities: facts, never policy

A capability adapter is a passive fact source. It receives no User, Attempt, policy, rule,
allowlist, exam content or authorization object. It answers "what is the full state now" and
reports that something changed. The agent's core does everything generic once, for every
capability:

- **activation** returns the complete state and the first sequence number in one step, so nothing
  falls between a query and a subscription;
- **identical consecutive states** produce no event;
- **per-capability sequence numbers**, explicit **gaps** when events are lost, and **resets** with a
  fresh instance identity after a restart;
- **interruptions** (sleep and resume, screen lock, user switch) end every stream and force a fresh
  complete state. A watcher in the agent samples the OS every second. Sleep is suspended time that
  grows by at least two seconds, read from a clock that counts sleep minus one that does not
  (`mach_continuous_time` and `mach_absolute_time`, `CLOCK_BOOTTIME` and `CLOCK_MONOTONIC`, the
  interrupt time and its unbiased form), so wall-clock changes cannot fake or hide one. A lock is
  the session going from unlocked to locked, and a user switch is the session losing the console.
  Resuming, unlocking and switching back are not interruptions: the agent re-reads every activated
  source at once, and those fresh states say what is true. Until each arrives, every rule is
  unknown with cause `gap`, so enforce rules contain;
- **notifications are wake-ups**: the adapter re-queries the whole state and reports what it found,
  never what a notification claimed.

When a capability's state is small, each change carries the complete new state plus the kinds of
change, so a lost event costs nothing once the next one arrives. Facts carry only bounded
classifications, counts, opaque per-session identities and Attempt-keyed pseudonyms. Names,
paths, serials, addresses, account identifiers and content never leave the agent.

**Queries outside a session.** Non-sensitive capabilities (display, virtualization, permission
state, camera/microphone presence) may be queried any time.
Sensitive capabilities (process/application, interactive session, removable storage, network)
are read only inside a session for a specific sitting, and only as the facts their contract
allows.

**Application identity stays on the device.** The process inventory exists only inside the agent.
It is matched against the release-owned application catalog, which is compiled into the agent
and so covered by the release's code signature, and only
**rule matches** leave the agent: the rule, whether it matched, and for blocklist rules the catalog
application IDs found. An application that matches no rule produces nothing on the wire. Its name
is shown only to the candidate, on their own screen, so they know what to close. The registry
publishes each catalog application's ID and whether an allowlist may name it, so the server can
validate rules; identities never leave the agent.

## Rules, readiness and containment

The server compiles each exam's per-family options into **activations** (which capabilities and
categories run) and **rules**, and sends them with the policy. The release-owned baseline rules
(one physical display, the constrained CandidateWindow, the candidate's own unlocked local session)
are part of every policy. Each rule states a requirement with status **met**, **not met** or
**unknown**; the exact semantics are in [`native-rules.md`](./native-rules.md).

1. **Readiness overview** (AuthenticatedWindow). The overview reads the sitting's compiled policy,
   opens a readiness session in the agent and lists every rule live as the candidate fixes things.
   Permission prompts happen here, only after explicit candidate action, and never during an exam.
   Nothing is uploaded while the candidate is fixing things.
2. **Start** is the binding check. The agent takes one fresh complete state of every activated
   capability and every rule status; that becomes the preflight report. The server evaluates the
   rules itself and admits or blocks.
3. **Participation.** On admission the same agent session continues into the CandidateWindow
   **without a gap**, so nothing can change between the check and the exam. Any enforce rule that is
   not met or unknown contains immediately; containment lifts when every enforce rule is met again,
   after the capability's fixed stability time.

Containment leaves the CandidateWindow visible behind a secure overlay and blocks editor mutation,
browser interaction, resource mutation and submission. Protected working state stays intact. One
overlay aggregates the failing rules with their localized correction steps. Proctor never kills
applications, terminates sessions, cancels print jobs, ejects storage or changes networking.

## Candidate window and single display

The CandidateWindow is purpose-built and immutable. Electron main's closed enforcer prepares it
for one Participation generation (maximized, Proctor-owned titlebar, no usable native minimize,
maximize, close, move, resize or fullscreen, content protection enabled), verifies the constraints,
and releases it after authoritative departure. Window controls and close veto coordinate orderly
behaviour but cannot prevent Task Manager, Force Quit, shutdown or power loss; such loss is a
Participation Interruption.

Window facts come from Electron main as host events and from the agent's own OS checks: content
protection read back from the OS, the display the window is on, and **occlusion** by another
window. Admission requires exactly one connected physical active display, no mirrored, virtual,
wireless, remote or specialized target, and complete topology certainty. Any display change during
participation contains while a fresh state is taken.

## Protocol between Electron main and the agent

- **Launch.** Electron main spawns the exact packaged binary by absolute path: no PATH lookup, no
  shell, a fixed argument list with no secrets, a cleared environment. Before spawning, it verifies
  the binary's code identity against the release (Authenticode on Windows, the designated
  requirement on macOS) on a file handle that cannot be swapped between check and launch.
  Development builds use an explicit unsigned-development verifier; release verification arrives
  with packaging.
- **Channel.** One inherited private pipe pair. No named socket, port or file that anything else
  could reach.
- **Handshake.** A one-time secret, the build identity and the protocol digest generated from the
  Rust types. Any mismatch, timeout or second handshake ends the process.
- **Frames.** Length-prefixed UTF-8 JSON, at most 1 MiB, each a closed typed union. Unknown kinds or
  fields, oversized frames or invalid values are fatal for the connection.
- **Messages.** Requests with deadlines (query, open readiness, begin/confirm/abandon
  participation, permission request, recorder save/release, close, acknowledge); notifications from
  the agent (facts, rule statuses, gaps, resets, health, heartbeat, fatal); host events from main
  (window state, close attempts, blocked print commands, lost host events). One session exists at
  a time and its policy is fixed for its lifetime.
- **Flow control.** Electron main acknowledges regularly. Above 256 unacknowledged messages the agent
  keeps only the newest state per capability and reports a gap; health, rule statuses and fatal
  always pass.
- **Liveness.** Both sides send a heartbeat every second. Three seconds without one from the agent
  means hung: main contains, kills it and follows the restart rule.

## Failure, restart and departure

- **Outside an exam** the agent is restarted automatically and readiness reopens.
- **During participation** Electron main contains immediately and records a continuity
  interruption. It restarts the agent **once**: the new session reports resets with fresh instance
  identities and complete states before any rule can be met again. A second failure leaves the
  candidate contained until explicit retry or a new preflight.
- **Panics abort** the agent; it never continues in an unknown state.
- **Normal departure** stops host-event intake, stops the recorder, stops capabilities in reverse
  order, reports final states and rule statuses, and deletes or seals the recording. Every step has a
  deadline; a missed one is a failed cleanup and main kills the process.
- **Relaunch** never restores an old session; a later join creates fresh generations.

## Screen evidence recorder

The recorder collects content, not facts, and is **off by default, enabled per exam**. When
enabled, it is disclosed on the readiness overview, shown by an indicator during the exam, and
records the display from confirmation (the CandidateWindow mount) to the end of the Participation.
There is no audio and no camera. Proctor's own window is protected from capture, so the recorder
paints its bounds with a flat neutral placeholder: the recording never shows what was beneath it,
and everything else on screen (other applications, overlays, notifications) is recorded.

- **Capture and encoding.**
  - macOS uses ScreenCaptureKit and VideoToolbox; Windows uses Windows.Graphics.Capture and the
    Media Foundation H.264 encoder. Linux does not record.
  - Video is 5 fps, at most 1920 px wide, about 1 Mbit/s: roughly 1.4 GB for three hours.
  - When the screen is still, the last frame repeats so segments keep closing.
- **Storage.** The recording is fragmented MP4 (H.264, `avc3`, parameter sets in-band) in 2-second
  keyframe segments.
  - Every segment and the index are sealed with XChaCha20-Poly1305 under the recording key, with
    the recording ID and the file's role as associated data. A file cannot be swapped, reordered or
    moved into another recording.
  - The recording is never trimmed, so "from session start" stays available. Below the free-space
    reserve the recorder stops and reports `failed` with a gap.
- **Keys.** Electron main generates the per-Attempt key, seals it with the OS keystore (Keychain or
  DPAPI) beside the recording, and passes it at `confirm_participation`. A relaunch into the same
  Attempt continues the recording with a restart gap. The agent never stores the key.
- **Gaps.** Sleep, lock, user switch, restart, re-entry, capture or encoder failure and a full disk
  are explicit gaps. A clip reports its gaps and any unrecorded hole, and is never stitched over.
- **Clips.**
  - The server requests saves: a manager's range (including from session start), or a window
    around an incident.
  - `recorder_save` cuts the range without re-encoding, rounded out to segment boundaries, and
    completes once a future end has been recorded.
  - The clip file is one ChaCha20-Poly1305 record per 8 MiB upload chunk under a fresh key, with
    the chunk hashes and the server's `content_digest`.
  - Electron main's uploader takes the request, uploads only missing chunks (resumable), checks
    each decrypted chunk, completes with the digest signed by the installation key, then
    `recorder_release` deletes the clip.
- **Lifetime.**
  - Requests are accepted only during participation; the server queues them while suspended.
  - At submission the uploader gives pending clips a deadline. Then `close { delete }` deletes the
    recording, and Electron main removes the key and the directory itself whatever the agent
    managed. Saves not yet cut when the recorder stops fail, so closing stays quick.
  - Suspension uses `close { seal }`.
- **Readiness.** The `screen_recording` capability reports the macOS Screen Recording permission in
  the envelope (with the OS prompt) and free disk space as a rule field, so the overview shows both
  through the usual rules.

Not yet: compositing Proctor's own window instead of the placeholder, Linux capture, and the server
transport for the uploader (it waits for the contract import that carries the clip routes).

## Privacy and diagnostics

Facts, rule statuses and clips are the only native material that leaves the device, and only in
the shapes their contracts allow. Clipboard content, camera frames, audio, keystrokes, command lines,
paths, window/document/printer names, account identifiers, serials, mount paths, SSIDs, network
addresses, proxy URLs, packets and DNS history are never collected as facts.

Agent diagnostics are a closed set of codes on stderr: no facts, names or paths. Crash dumps are not
uploaded automatically; explicit support capture treats them as restricted material.

## Source structure

The Rust workspace under `native/` holds the agent and its parts. Rust protocol types are the one
authority for every wire shape; JSON Schema, TypeScript types and validators, the capability
registry and the rule conformance vectors are generated from them and checked for parity.

| crate                 | owns                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `prctr-protocol`      | wire types: main↔agent messages, facts, rules, rule statuses                                                         |
| `prctr-core`          | the deterministic engine: sessions, sequencing, gaps, resets, flow control, rule evaluation. No OS, threads or clock |
| `prctr-os`            | safe wrappers over OS APIs; the only crate allowed `unsafe`                                                          |
| `prctr-capabilities`  | one module per capability: state, changes, summary, rule fields, adapters, a fake                                    |
| `prctr-recorder`      | capture, encoding, encrypted segment store, clip cutting                                                             |
| `prctr-agent`         | the agent binary: threads, transport, wiring                                                                         |
| `desktop-key-custody` | installation-key custody for Electron main (identity, not observation)                                               |
| `prctr-xtask`         | generation of schemas, registry and vectors                                                                          |

Dependencies point `protocol ← core ← capabilities/recorder ← agent`, with `os` below the platform
crates. Adding a capability means adding its
module and one registration entry; nothing in the core, protocol envelope, agent or Electron main
changes.

## Verification and release support

| layer             | proves                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| model tests       | classification and summaries from fixtures recorded on real machines                                                                     |
| core conformance  | ordering, coalescing, gaps, resets, interruptions, flow control, recovery and rule evaluation, run for every capability through its fake |
| rule vectors      | the three-valued logic; published so the server's evaluator passes the same cases                                                        |
| wire tests        | stable JSON shapes and rejection of invalid input                                                                                        |
| real-OS tests     | each fact is true: the test causes a change and checks the fact                                                                          |
| agent integration | launch, handshake, readiness → participation without a gap, crash and restart, shutdown order, malformed frames                          |
| certification     | hardware cases on physical machines: monitors, docks, phones, webcams                                                                    |

Mocks verify coordinator and rule behaviour but never satisfy a platform claim. Every secure-
candidate release carries a signed capability matrix keyed by OS version, architecture, packaged
build identity, and the per-capability coverage each certified target proves. A failed,
skipped, flaky, stale or absent required target test removes the claim or blocks release.

Electron and native build tools, signing, package integrity and updates follow the
[toolchain architecture](./toolchain.md).
