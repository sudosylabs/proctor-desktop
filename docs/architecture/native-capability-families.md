# Native capability family contracts

## Scope and claim language

This document owns the accepted first-release policy, privacy, correction, and
platform-coverage contract for Proctor Desktop native capability families. The
[native capability architecture](./native-capabilities.md) owns source sessions,
process boundaries, coordination, failure, evidence transport, and release
verification.

Architecture acceptance is not an implementation or support claim. A capability
is supported only when the exact packaged application, helper, adapter, schema,
operating-system version, and architecture tuple appears in the signed release
capability matrix. Windows x64 and macOS arm64/x64 are the initial certification
targets. Linux keeps the common interfaces and practical adapters, but broader
security claims require a pinned and certified distribution, kernel, session,
display, media, and networking tuple.

Every capability-matrix entry states one of:

- `enforce` — the certified adapter can establish the declared mechanical
  condition strongly enough for policy containment;
- `observe` — the adapter can report a useful bounded fact but cannot establish
  an enforcement boundary;
- `unavailable` — the platform or packaged adapter cannot make that claim.

Coverage belongs to a sub-capability, schema version, and target tuple. One
enforceable part never makes its whole family enforceable. Missing enforce
coverage blocks admission. Missing observe coverage produces an explicit
degraded result and never silently changes policy.

## Policy modes and registry

Every family uses an explicit server-frozen mode:

- `disabled` opens no source, requests no permission, collects no fact, and
  presents no capability UI;
- `observe` opens the disclosed source and may create minimized review material,
  but a condition never causes containment;
- `enforce` requires healthy complete coverage and contains a confirmed
  prohibited condition.

The Desktop contains a deterministically generated capability registry. Its
checked JSON authority and bounded family-policy schema are the single source
of truth. Each entry declares a
stable identifier, schema versions, permitted modes, bounded configuration and
fact shapes, permission/effect requirements, privacy class, and per-platform
coverage keys. New authoring templates start these broader families as
`disabled`; there is no hidden inheritance or Desktop-selected default.
The family modes must exactly match the referenced configuration schema.
External capture therefore advertises only `disabled`, rather than inheriting a
generic mode set from other families.

The effective policy may select only packaged identifiers and bounded values.
It cannot supply code, commands, paths, arbitrary regular expressions,
unregistered hashes, platform API identifiers, effect sequences, or low-level
OS timing. Unknown, contradictory, oversized, prohibited, or unsupported
requirements fail before permission prompts and source startup. Observe mode
cannot select an enforcement-only effect: private clipboard and candidate
print-command denial remain inactive while their observation-only siblings may
collect bounded facts. The server resolves the
[accepted security-policy contract](../contracts/security-policy.md); Desktop
has no local bypass or policy-precedence engine. Initial resolution includes
published selections, mandatory baseline, verified artifacts/catalogs and
existing admission fences. Institution inheritance, accommodations and exception
authoring/revocation are excluded; exception references are empty.

Ordinary live policy mutation is absent. A changed policy requires suspension
and a fresh join. Emergency blocking uses authorized Attempt suspension.
Selective live strengthening is outside the initial contract. Policy has no
independent expiry; current Participation and Sitting authority govern use.

## Common mechanical envelope

Every source separates:

- certified coverage and permission state;
- source and adapter health;
- certainty and known gaps;
- current bounded mechanical state;
- ordered meaningful transitions and resets;
- source generation and lifecycle.

Preflight returns one complete initial snapshot. Continuous operation reports
policy-relevant transitions, occurrence start/recovery, health, gaps, and an
aggregated coverage heartbeat rather than recurring normal inventories.
Notifications are wakeups: startup, resume, helper restart, session or namespace
change, permission change, and detected event loss require a bounded complete
reconciliation under a new or fenced generation.

Overflow never truncates an inventory and calls it complete. It reports an
exact gap or failure. Unknown, stale, incomplete, or unverifiable enforced
coverage contains; the same condition degrades observation. Uncertainty and
source failure are operational facts, not evidence of misconduct.

## Process and application state

Application policy evaluates each user-space executable in the candidate's
interactive exam session. Kernel components and service/system-account
processes remain outside application allowlist matching while process-source
health still covers the declared boundary. A child process never inherits its
parent's permission.

The packaged application catalog contains two authorities:

- Proctor-maintained OS-essential classifications tied to the Desktop release;
- Institution-registered bounded application identities selected by stable
  catalog identifier.

Windows identity uses signer chain, publisher/product metadata, version bounds,
and an optional exact digest. macOS identity uses code-signing identity, Team
ID, designated requirement, bundle identity, and version. A certified Linux
tuple may use package identity and executable digest. Paths and process names
are never authoritative. Unsigned applications require an exact registered
digest and are disabled by default.

The catalog assigns deterministic execution classes. External shells,
interpreters, automation hosts, remote-control tools, capture tools, and local
development servers are initially prohibited classes and cannot become allowed
merely by registering a signer or digest. The Proctor-owned remote terminal and
Execution Environment remain the permitted execution path.

A new relevant process immediately enters reversible `checking` while identity
verification completes. An allowed identity clears without a violation; a
confirmed disallowed identity opens an occurrence. A process that exits before
verification is still resolved where possible; otherwise the explicit gap keeps
enforced participation contained until reconciliation. Proctor asks the
candidate to close a disallowed application and never kills it automatically.

Full Windows lifecycle coverage requires the signed privileged ETW service
described in the core architecture. WMI or snapshot-only enumeration is not an
enforcement substitute. Full macOS exec coverage requires the approved Endpoint
Security component and Full Disk Access; GUI-only application APIs do not make
the same claim. Generic Linux process coverage is observe-only or unavailable
until a pinned tuple closes kernel, namespace, and identity gaps.

Snapshot process-instance correlation requires PID plus an OS creation/launch
generation. An entry whose generation cannot be established is omitted from the
partial snapshot; PID-only fallback and transient application-object addresses
are forbidden because PID reuse would merge distinct processes.

Helpers never expose executable paths, command lines, arguments, window titles,
environment variables, or parent-command data. Routine allowed processes reduce
to catalog identifiers. Authorized integrity review may retain a bounded
signer/product/bundle identity or digest for an unknown disallowed executable.

## Interactive OS sessions

`single_interactive_session` requires the candidate's local exam session to be
the only human interactive login session capable of retaining user processes.
Other active or disconnected human sessions block. System and service accounts
do not count, and native facts contain no usernames, account identifiers, SIDs,
terminal addresses, hostnames, or remote IP addresses.

Remote interactive login, Remote Desktop attachment, fast-user switching,
console ownership transfer, session replacement, lock, or loss of interactive
console ownership immediately contains participation. The source does not claim
to detect remote-control mechanisms that create no OS session. Preflight asks
the candidate to sign out other human sessions; Proctor never logs them off.

Unlock does not restore interaction by itself. Process, session, display,
device, network, permission, and server-participation checks must reconcile
first. Sleep creates a continuity interruption; resume starts new source
generations and verifies the server lease before local recovery.

Certified all-session Windows coverage requires the privileged WTS service.
Exact macOS lock/switch/session coverage requires the approved Endpoint Security
component and a certified initial snapshot. Linux session enforcement requires
a pinned logind/system tuple.

On Windows only `WTSActive` establishes console ownership. A `WTSConnected`
human session still contributes to the other-human-session inventory but cannot
claim either candidate or other-human console ownership without active state.

## Clipboard

`candidate_private_clipboard` is a Proctor-owned in-memory CandidateWindow
clipboard. It never reads from or writes to the host clipboard and is erased on
Attempt departure. Policy may select this private clipboard or disable candidate
clipboard operations.

`os_clipboard_change` reports only a bounded generation/ownership change. It is
observe-only, contains no content, cannot prove candidate action, and never
causes containment by itself. Windows and macOS adapters may use platform change
notifications or counters; X11/Wayland differences cannot be hidden behind a
generic enforcement claim.

## Printing

`candidate_print_commands` is a closed enforceable CandidateWindow effect.
`monitored_spooler_job` means only that a job mechanically attributed to the
candidate appeared in a certified monitored scheduler. `no_physical_printing`
is not an available claim because direct, alternate, remote, or socket printing
can bypass the monitored queue.

A candidate-owned job present before participation blocks preflight without
creating an integrity occurrence. A new candidate-owned job during participation
may contain when configured. Attribution crosses the source boundary only as
`candidate`, `other`, or `unknown`; another account is a session-consistency
condition and unknown attribution is a gap. Proctor never records printer or
document names and never cancels a job automatically. The Windows adapter uses
field-selective spooler notifications for only owner and numeric status, reduces
the owner to its relative class in place, then clears every transient identity
buffer before releasing the notification allocation. An allocation outside the
fixed field or owner-size processing bounds is cleaned behind the shared cleanup
deadline; unproved completion poisons the native utility for process replacement.

## Removable and portable storage

Policy treats data-bearing functions separately from keyboards, mice,
accessibility devices, cameras, headsets, power devices, docks, and hubs. A
composite device exposes separate bounded functions; a hub is not prohibited
merely because storage could be attached to it.

`removable_block_storage` evaluates attached block media whether mounted or
unmounted. `portable_mtp` represents bounded portable/MTP classification.
An enabled policy names a non-empty selection of these registered
sub-capabilities; disabled policy selects neither, so block-only certification
cannot be confused with portable/MTP availability. The utility source receives
the same frozen selection: a portable-only request never enumerates block
storage, and a block-capable adapter never invents portable/MTP coverage.
Unmounting does not prove removal. Proctor asks the candidate to remove
prohibited storage and never automatically ejects or unmounts it.

Exceptions select registered device-function classes, not serial numbers or
candidate-entered identifiers. An Attempt-keyed opaque pseudonym may correlate
disconnect/reconnect of one device inside that Attempt and cannot correlate it
across Attempts or Institutions. The same opaque collection context is retained
across replacement source generations, and a keyed derivation produces the same
pseudonym after an in-Attempt restart without persisting the raw platform key.

Windows is eligible for certified block-storage and bounded portable/MTP
coverage. macOS is eligible for certified block-media coverage while general
MTP remains unavailable without a reliable public implementation. Linux
coverage requires a pinned udev/UDisks/libmtp tuple.

## Virtualization

Virtualization classification is three-valued:

- `recognizedGuest` — positive evidence of a known guest environment;
- `recognizedPhysicalOrRoot` — positive evidence accepted for one certified
  physical/root tuple;
- `unknown` — the adapter cannot establish either stronger statement.

Policy chooses one explicit rule:

- `block_recognized_guest` blocks only `recognizedGuest`; a complete result with
  no recognized guest marker satisfies this narrow rule without claiming the
  machine is physical;
- `require_certified_physical_environment` admits only an accepted
  `recognizedPhysicalOrRoot` result, so `unknown` blocks.

A Windows hypervisor-present flag is not guest proof because a physical
Hyper-V/VBS host can be the root partition. macOS has no reliable public generic
guest-status API. Certified Linux detection can recognize known guests but does
not prove bare metal from absence alone. Candidate and manager language always
states the exact recognized condition.

## Network configuration

Native network policy uses explicit sub-capabilities:

- `system_proxy_state`;
- `os_managed_vpn_state`;
- `tunnel_interface_state`;
- `route_change`;
- `network_source_health`.

An enabled policy selects at least one. The same selection crosses the private
utility boundary, and adapters skip proxy, tunnel/interface, and route queries
that were not selected. Generic source lifecycle health remains operational
metadata; it does not authorize collection of another network category.

There is no generic `all_vpn_detection` claim. Windows may certify selected
adapter, RAS, route, and OS-proxy facts. macOS may certify system proxy and
interface topology, but its application-scoped Network Extension view is not a
global VPN inventory. Linux requires a pinned managed-networking tuple.

Allowlists contain registered managed profile identities and adapter/tunnel
classes. They exclude SSIDs, BSSIDs, IP or MAC addresses, DNS servers, and
arbitrary remote endpoints. A future campus-network rule requires a separate
server-attested presence protocol.

A route transition enters `checking` and reconciles proxy, managed VPN, tunnel,
adapter, and route state. It is not independently a violation. Routine DHCP
renewal, IPv6 privacy rotation, and Wi-Fi roaming are not retained. Native
network sources report configuration; authenticated transport and the
coordinator own server reachability and Participation lease health. Proctor
does not disconnect a VPN or mutate host networking automatically.

## Camera and microphone

`camera_ready` means that at least one recognized endpoint exists, Proctor has
the required permission, the endpoint is not reported disabled/unavailable,
and a bounded control path initializes without retaining frames. It does not
establish image quality, candidate presence, camera direction, identity, gaze,
or recording.

`microphone_ready` similarly means that an authorized enabled capture endpoint
exists and a bounded control path initializes. Proctor does not retain, analyze,
transcribe, transmit, or create evidence from audio. Audio quality and speech
checks require a separately accepted media feature.

Additional endpoints are neutral mechanical counts. Exact topology or device
selection requires a later feature. `camera_other_application_use` and
`microphone_other_stream_running` may enforce only where the certified OS
exposes a reliable mechanical fact; they never imply recording intent or
content. Process scanning is not a substitute.

Windows is eligible for endpoint readiness and supported microphone stream
state, but arbitrary concurrent-camera-use detection remains unavailable absent
a reliable public mechanism. macOS is eligible for endpoint readiness and its
documented mechanical other-application-use facts. Generic Linux media-use
enforcement remains unavailable until a managed PipeWire tuple closes direct
V4L2/ALSA bypasses.

Permission requests occur only after candidate disclosure and explicit
preflight action. Participation never prompts. Endpoint loss, disablement,
permission revocation, or an enforced concurrent-use condition contains until a
fresh snapshot and platform-certified stability fence pass.

## External screen capture

`external_capture_detection` is unavailable on all initial targets. Public
Windows, macOS, and Linux capture APIs do not expose a reliable global inventory
of other applications capturing the screen. Process-name matching, permission
state, UI-indicator scraping, and capturable-source enumeration are not accepted
substitutes.

CandidateWindow content protection, single-display enforcement, remote-session
facts, and prohibited-application policy remain independent controls. None is
described as proof that external capture is absent.

## Correction, occurrence, and evidence rules

Detectors are deterministic versioned state machines, not opaque scores or
machine-learning heuristics. An occurrence has stable identity, start and last-
confirmed time, bounded repeat count, recovery time, contributing source ranges,
certainty, and gaps. Repeated identical callbacks coalesce; recovery closes the
occurrence and a later recurrence creates a new one.

One CandidateWindow overlay aggregates enforced conditions and orders concrete
corrections. It may show a safe application or device label only when needed for
correction. Correction enters `checking` and requires a complete snapshot plus
a short capability-specific stability fence where certified event ordering can
flap. The fence is an adapter constant, not a manager-configurable grace period.

Proctor automatically applies only effects it owns: CandidateWindow mutation
gates, private clipboard behavior, candidate print-command denial, and content
protection. It does not kill applications, terminate sessions, cancel print
jobs, eject storage, disconnect VPNs, or mutate unrelated OS resources.

Ordinary observe-only conditions do not interrupt or repeatedly notify the
candidate. The live manager board shows safe family-level state. Detailed
minimized identity and occurrence timelines require separately authorized
integrity review.

Evidence excludes clipboard content, screen or camera frames, audio,
keystrokes, command lines, arbitrary paths, window/document/printer names,
usernames, account identifiers, device models and serials, mount paths, SSIDs,
network addresses, proxy URLs, packets, DNS history, and general system-browser
history. A source gap or operational failure never becomes misconduct evidence.
