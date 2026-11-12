# Native capability contracts

## Scope and claim language

This document owns what each native capability reports, its platform coverage, permission and
privacy limits. The [native capability architecture](./native-capabilities.md) owns the process
model, lifecycle and protocol; [native rules](./native-rules.md) owns how rules read these facts.

Architecture acceptance is not an implementation or support claim. A capability is supported only
when the exact packaged application, agent, privileged component and OS/architecture tuple appears
in the signed release capability matrix. Windows x64 and macOS arm64/x64 are the initial
certification targets; on them every capability is implemented to the **strongest coverage the OS
offers** through public APIs and the privileged components. Linux keeps the same interfaces and may
report a capability as unsupported.

Every capability states one coverage claim per target:

- `enforce`: the adapter establishes the fact strongly enough for an enforce rule;
- `observe`: the adapter reports a useful bounded fact but cannot support enforcement;
- `unavailable`: the platform or adapter cannot make the claim.

One enforceable field never makes a whole capability enforceable.

## Policy modes

Managers choose per-family options on the server; the server compiles them into activations and
rules ([native rules](./native-rules.md)). A family is:

- `disabled`: no capability opened, no permission requested, no fact collected, no UI;
- `observe`: facts collected and disclosed; rules are reported but never contain;
- `enforce`: rules contain while not met or unknown. The family's server outcome is `flag` or
  `flag_and_suspend`.

Policies select only registered identifiers and bounded values. They never supply code, commands,
paths, patterns, hashes outside the catalog, platform API names or timing.

## Shared envelope

Every capability's facts carry, in addition to the fields below:

- permission: `not_determined`, `granted`, `denied`, `restricted`, `unavailable`;
- health: `unsupported`, `healthy`, `degraded`, `failed`, `stopped`;
- coverage and certainty: `complete`, `partial`, `unknown`;
- per-capability sequence, source instance, gaps and resets.

Each capability also publishes a **summary**: fields derived only from its state, sent with every
fact, so the agent's rules and the server compare the same values. The server checks that each
summary matches its state.

---

## Display topology

**Purpose.** The baseline requires exactly one physical, active display with no mirrored, virtual,
wireless, remote or specialized target, known with complete certainty.

**State.** `certainty`; `targets` (at most 32), each with an opaque per-session `target_id`,
`active`, `built_in`, `kind` (physical, virtual, wireless, remote, specialized, unknown),
`connection` (direct, indirect, unknown), `mirror_of`, `power` (awake, asleep, unknown) and
`primary`. Resolution, refresh rate and position are not reported.

**Changes.** `topology_changed` with the complete new state and the kinds of change (target added
or removed, activity, mirroring, kind, power, primary, certainty).

**Summary.** `active_physical`, `active_total`, `connected_total`, `mirrored`, `virtual`, `wireless`,
`remote`, `specialized`, `unknown_kind`. The baseline reads `certainty = complete`,
`active_physical = 1` and `connected_total = 1`.

**Platforms.**

- Windows: `QueryDisplayConfig` over all paths plus the target output technology (internal panel,
  HDMI/DP, Miracast, indirect drivers); two paths sharing a source mean mirroring; monitor
  specialization marks headsets. Wake-ups from display change, monitor arrival/removal and console
  display state.
- macOS: the online display list (which includes mirrored and sleeping displays), built-in, mirror
  and asleep queries, the reconfiguration callback, and IORegistry transport for wireless and
  virtual targets. Wireless/virtual classification on Apple silicon must be proved before the
  capability is called complete.
- Linux: DRM connectors in sysfs; partial where mirroring or virtual drivers cannot be confirmed.

**Permission.** None.

**Never leaves the agent.** Monitor names, manufacturer, model, serial, EDID, connector paths, OS
display IDs.

**Decided cases.**

- A closed built-in panel with one external monitor does not count, once the adapter confirms the
  lid is closed; otherwise it counts and the baseline is not met.
- A sleeping monitor still counts as connected; it is not a violation by itself.
- A USB DisplayLink monitor is `physical` with `indirect` connection; it is a real second screen.
- An HDMI dummy plug looks like a physical monitor and is not detectable here (a stated limitation).

## Candidate window

**Purpose.** The exam window's own condition. Focus facts also feed the server's Focus Loss
evaluation.

**State.** `certainty`, `presence`, `focus`, `visibility`, `placement` (maximized, normal,
minimized, fullscreen), `display_target_id`, `content_protection` (verified, failed, unknown, read
back from the OS), `occlusion` (none, covered, unknown).

**Changes.** `window_changed` with the complete new state and kinds of change; `close_attempted`
with a count.

**Occlusion.** `covered` when other windows cover at least **5% of the exam window for at least 1
second**. Accessibility tools and Proctor's own overlay never count. The other windows' names or
owners are never read.

**Platforms.**

- Windows: Electron main's window events; `GetWindowDisplayAffinity` read-back; the z-order above
  the window for occlusion.
- macOS: Electron main's window events; `NSWindow.sharingType` read-back; the windows listed above
  ours (bounds, layer, alpha, with no Screen Recording permission) for occlusion.
- Linux: window events; content protection and Wayland occlusion are `unknown`.

**Permission.** None.

**Never leaves the agent.** Window titles, other windows' owners, exact coordinates.

## Interactive session

**Purpose.** The candidate's local session must be the only human session, unlocked, and not
viewed or controlled remotely. It also holds the remote-viewing fact.

**State.** `coverage` (full_lifecycle, snapshot_only, unavailable), `certainty`, `console_owner`
(candidate, other_human, none, unknown), `lock` (unlocked, locked, unknown), `remote_attachment`
(absent, present, unknown: RDP into this session, screen sharing, remote management),
`other_human_sessions` (count, active or disconnected).

**Changes.** `session_changed` with the complete new state. Lock, user switch and remote attachment
are also interruptions.

**Platforms.**

- Windows: the privileged service enumerates every session and receives logon, lock, remote and
  console changes; only `WTSActive` is console ownership. Without it, the current session's
  notifications and remote-session flag give `snapshot_only`.
- macOS: the Endpoint Security extension gives login-window login/logout/lock/unlock,
  screen-sharing attach/detach and SSH login events; `utmpx` and the current session dictionary give
  the starting state. Screen sharing that began before the exam must be proved detectable before
  macOS is complete.
- Linux: logind sessions; partial.

**Permission.** The privileged components' approval.

**Never leaves the agent.** Usernames, account IDs, SIDs, hostnames, remote addresses.

**Decided cases.** A disconnected session of another user counts; SSH counts as another session;
an idle screen lock is an interruption, not misconduct; remote control without an OS session is
outside this capability.

## Process and application

**Purpose.** Whether an application the exam's rules name is running in the candidate's session.

**Two layers.** The inventory (instance by PID plus creation time, session scope, verified
identity, catalog match, display name) exists **only inside the agent**. The fact that leaves it is
the match state: `coverage`, `certainty`, `checking` (new processes whose identity is still being
verified), and per application rule: `rule_id`, `matched`, and for blocklist rules the
`catalog_app_ids` found. Allowlist matches carry no IDs, names or counts.

**Changes.** `matches_changed` with the complete match state. A process start or exit that changes
no rule produces no fact.

**Identity.** Windows: signer chain, publisher/product metadata, version bounds, optional digest.
macOS: signing identifier, Team ID, designated requirement, bundle identity, version. Paths and
process names are never authoritative. The application catalog is release-owned and signed with
the release agreement; it classifies OS-essential processes and assigns execution classes. Shells,
interpreters, automation hosts, remote-control and capture tools, and local servers cannot be made
allowed. A child never inherits its parent's allowance.

**Platforms.**

- Windows: the privileged service subscribes to the ETW kernel-process provider, then snapshots, so
  nothing falls between; identity is read from a handle the service opens. Without it, snapshot
  polling is `snapshot_only`.
- macOS: the Endpoint Security extension's exec/exit events carry the code identity; it subscribes,
  then inventories by audit token. Without it, `snapshot_only`.
- Linux: `/proc` polling for the same account; `snapshot_only`.

**Never leaves the agent.** Names, paths, command lines, arguments, PIDs, signers of unmatched
applications, display names. The candidate sees an offending application's name on their own
screen only.

**Decided cases.** A process that exits before its identity is verified keeps `checking` until
reconciled, or becomes an explicit gap. Proctor never kills an application.

## Clipboard

**Purpose.** Whether the host clipboard changed. Observe-only: a change cannot prove what the
candidate did. The CandidateWindow's private clipboard is an effect, not a fact: it never reads or
writes the host clipboard and is erased at departure.

**State.** `coverage` (notifications, counter_polling, unavailable), `certainty`, `change_counter`.
There is no list of entries; content, formats and owner are never read.

**Changes.** `clipboard_changed` with the new state and the number of changes since the previous
one.

**Platforms.** Windows: clipboard format listener plus sequence number (complete). macOS: the
pasteboard change count, polled; this is complete for the capability because macOS has no change
notification. Linux: X11 selection notifications; Wayland unavailable.

## Printing

**Purpose.** Whether a job attributed to the candidate appears in the OS print scheduler, and
whether the CandidateWindow blocked a print command. "No physical printing" is never claimed.

**State.** `coverage`, `certainty`, `candidate_jobs`, `other_jobs`, `unknown_jobs`.

**Changes.** `jobs_changed`; `candidate_print_blocked` (count, from Electron main's closed
print-command denial).

**Platforms.** Windows: spooler notifications for owner and status only, the owner reduced to
candidate/other at once and its buffer cleared. macOS and Linux: a bounded IPP query of not-completed
jobs with owner and state only, plus an IPP notification subscription.

**Never leaves the agent.** Printer names, document names, job IDs, usernames. A job queued before
the exam blocks the overview without creating an occurrence. Proctor never cancels a job.

## Removable and portable storage

**Purpose.** Whether data-bearing storage is attached, mounted or not: USB drives, SD cards,
external disks, and phones exposing file or photo transfer. Keyboards, mice, headsets, docks and
hubs are not storage. Mounted disk images are not reported.

**State.** `coverage` (block_and_portable, block_only, unavailable), `certainty`, `devices` (at most
64), each with an Attempt-keyed pseudonym `device_id`, `kind` (block_storage, portable_device),
`transport`, `mounted`, `writable`.

**Changes.** `storage_changed` with the complete new state.

**Summary.** `block_storage`, `portable_devices`.

**Platforms.** Windows: device-interface notifications for disks and portable devices, then bus type
and removable flag. macOS: disk appeared/disappeared callbacks with the internal and protocol
properties; phones through USB still-image (PTP/MTP) interface matching, to be proved with iPhone
and Android devices. Linux: udev; partial where MTP rules are missing.

**Never leaves the agent.** Serials, vendor/model, volume names, mount paths, file contents. The
pseudonym correlates one device within an Attempt and never across Attempts. Proctor never ejects
storage.

## Virtualization

**Purpose.** Whether the exam runs inside a virtual machine. Classification only.

**State.** `certainty`, `classification` (recognized_guest, recognized_physical_or_root, unknown),
`hypervisor` (hyperv, vmware, virtualbox, parallels, qemu_kvm, apple_virtualization, xen, other,
none_detected).

**Changes.** None while running; a fresh state after every interruption.

**Rules.** `block_recognized_guest` blocks only a recognized guest; `require_certified_physical_environment`
admits only `recognized_physical_or_root`, so unknown blocks.

**Platforms.** Windows: CPUID hypervisor bit and vendor, the Hyper-V privilege leaf (a physical host
with Hyper-V or VBS is the root partition, not a guest), SMBIOS manufacturer/product. macOS: the
kernel's VMM-present flag, the hardware model (Apple's virtualization framework reports a virtual
model) and the platform vendor; to be proved across Parallels, VMware Fusion and UTM. Linux: DMI and
CPUID; never proves physical.

## Network configuration

**Purpose.** Whether traffic goes through a system proxy, an OS-managed VPN or a tunnel.
Configuration only; Proctor never reads traffic or changes the network.

**State.** Per selected category: `system_proxy` (none, manual, automatic_config, auto_detect,
unknown), `managed_vpn` (inactive, active, unknown), `tunnels` (at most 32, opaque per-session ID
and class: point_to_point, packet_tunnel, virtual_ethernet, managed_vpn, other), `route_generation`.
A proxy auto-config script is reported as `automatic_config` and never read or run.

**Changes.** `network_changed`. A route change alone is never a violation; it triggers a fresh check.

**Platforms.** Windows: adapter enumeration by interface type, interface and route change
notifications, RAS connections, WinHTTP proxy settings. macOS: the SystemConfiguration dynamic store
(proxies, interfaces, VPN service status) and a routing socket; system tunnels such as iCloud Private
Relay and Continuity must be classified, not counted. Linux: rtnetlink and NetworkManager; partial.

**Never leaves the agent.** Addresses, interface names, SSIDs, DNS servers, proxy URLs, VPN server
names. Only selected categories are queried.

## Camera

**Purpose.** Whether a physical camera is present, permitted and ready, and whether another
application is using it. No frame is ever captured.

**State.** `coverage`, `certainty`, `permission`, `physical_devices`, `virtual_devices` (software
cameras), `ready` (a physical device can be opened without capturing), `in_use_by_other_app`.

**Rules.** "Camera ready" needs `physical_devices >= 1`, permission granted and `ready`; a virtual
camera never satisfies it. A camera that cannot be classified counts as virtual.

**Platforms.** Windows: video-capture device watcher, the OS privacy setting, a capture source
activated without streaming; other-application use from the OS consent store only if certification
proves it, otherwise unknown. macOS: AVFoundation discovery (built-in, external, Continuity),
authorization status, a device input created without a session, CoreMediaIO "running somewhere".
Linux: V4L2 capture devices; partial.

**Permission.** Requested on the readiness overview only when a rule requires it.

## Microphone

**Purpose.** Like the camera: present, permitted, ready, and whether another application records.
No audio is ever captured.

**State.** `coverage`, `certainty`, `permission`, `devices`, `ready`, `in_use_by_other_app`.

**Platforms.** Windows: Core Audio capture endpoints and their change notifications; active audio
sessions on each endpoint for other-application use. macOS: Core Audio input devices and "running
somewhere" (the agent never opens the microphone), AVFoundation authorization. Linux: PipeWire or
PulseAudio sources; partial.

## External screen capture

No platform offers a reliable list of other applications capturing the screen. It is
`unavailable` everywhere and accepted only as disabled. Single display, remote attachment,
application rules and content protection are related controls; none claims that capture is absent.
The [screen evidence recorder](./native-capabilities.md#screen-evidence-recorder) is Proctor's own
recording and is not a capture-detection capability.
