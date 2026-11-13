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
back from the OS), `occlusion` (none, covered, unknown), `close_attempts` (a count).
`display_target_id` is not implemented yet: it needs the display capability's target identities.

**Host events.** Electron main sends `attach` (the window's native identity: the CoreGraphics
window number on macOS, the window handle on Windows), `state` (presence, focus, visibility,
placement), `close_attempted` and `detach`. Any other shape is a protocol error.

**Changes.** The complete new state on every change; a close attempt raises `close_attempts`.

**Baseline.** `baseline.window` applies to participation only (the window does not exist during
readiness): present, maximized, and content protection verified.

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

**Unprivileged coverage.** Without the privileged components every platform reports
`snapshot_only` coverage with partial certainty, so `baseline.session` (console owned by the
candidate, unlocked, no remote attachment, no other human session) is unknown until they exist.
What each platform reads without privilege:

- **macOS:** console and lock from the window-server session; other users from `utmpx`; remote
  attachment unknown.
- **Windows:** console, lock and remote use from WTS; other active or disconnected human sessions.
- **Linux:** logind session files; lock unknown.

A count the platform cannot read is left out, never reported as zero.

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

**Two layers.** The inventory (instance by process number plus start time, verified identity,
catalog match) exists **only inside the agent**. The fact that leaves it is the match state:
`coverage` (full_lifecycle, snapshot_only, unavailable), `checking` (new processes whose identity is
still being verified), and per application rule its `rule_id`, `matched` (the condition is violated)
and, for blocklist rules, the `catalog_app_ids` found. Allowlist matches carry no IDs, names or
counts. The capability has no rule fields: rules on it are application conditions.

**Changes.** `matches_changed` with the complete match state. A process start or exit that changes
no rule produces no fact.

**Catalog.** Release-owned and compiled into the agent, so the release's code signature covers it.
The registry publishes each application's ID and whether an allowlist may name it. Each entry lists
its identities: a macOS signing identifier with its Team ID (or Apple's anchor for Apple's own code),
a Windows publisher with the original file name, and a Linux executable name. Code Apple signs, and
code Microsoft signs as Windows, is part of the OS unless the catalog lists it, so the catalog must
list every such application a candidate could use (Terminal, Script Editor, Screen Sharing,
QuickTime, the Windows shells). The catalog in the source is a seed: every identity must be certified
on real installations before release, and a catalog change is a release change.

**Matching.** A blocklist is violated by any listed application. An allowlist is violated by any
process that is not Proctor, not part of the OS and not listed, including one whose identity cannot
be read; an unidentifiable process never matches a blocklist. Proctor is the agent's parent
(Electron main) and everything it started. A process started by another application is matched on
its own identity, so an allowed editor that launches a shell is matched on the shell. Paths and
process names are never identity.

**Platforms.** Without the privileged components every read is a one-second snapshot: coverage is
`snapshot_only`, certainty is partial, and application rules are unknown until the privileged
components provide the full lifecycle.

- **macOS:** `proc_listallpids` for the agent's account; identity from the running code's signature
  (signing identifier, Team ID, and whether it satisfies `anchor apple`), verified once per
  instance. The Endpoint Security extension will add exec and exit events.
- **Windows:** a Toolhelp snapshot of the agent's session. The unprivileged agent cannot verify
  catalog-signed system files, so identity is unavailable until the privileged service, which opens
  each image itself, provides it; allowlists are violated and blocklists match nothing until then.
- **Linux:** `/proc` for the agent's account; identity is the executable's file name, a weak stand-in
  because Linux has no code identity.

**Never leaves the agent.** Names, paths, command lines, arguments, process numbers, signers of
unmatched applications, display names. The candidate sees an offending application's name on their
own screen only. Proctor never ends an application.

## Clipboard

**Purpose.** Whether the host clipboard changed. Observe-only: a change cannot prove what the
candidate did. The CandidateWindow's private clipboard is an effect, not a fact: it never reads or
writes the host clipboard and is erased at departure.

**State.** `coverage` (counter_polling, unavailable) and `changes`: host clipboard changes since
activation. There is no list of entries; content, formats and owner are never read. When the counter
is unavailable the `clipboard.changes` field is left out, never reported as zero.

**Changes.** The new state on every change; the difference between two facts is the number of changes
between them.

**Platforms.** Both certified targets keep a counter that rises on every change, polled every 250 ms,
so no change is missed:

- **Windows:** the clipboard sequence number (complete).
- **macOS:** the pasteboard change count (complete; macOS has no change notification).
- **Linux:** unavailable for now (X11 selection notifications are not implemented; Wayland has no
  generic API).

**Rules.** Observe-only: there is no baseline rule, and an exam rule on `clipboard.changes` never
contains.

## Printing

**Purpose.** Whether a job attributed to the candidate appears in the OS print scheduler, and
whether the CandidateWindow blocked a print command. "No physical printing" is never claimed:
printing that bypasses the local scheduler is not seen.

**State.** `coverage` (monitored_scheduler, snapshot_only, unavailable); the active jobs by owner,
`candidate_jobs`, `other_jobs` and `unknown_jobs`; `candidate_jobs_since_start`, the candidate jobs
the scheduler accepted since observation started, finished ones included, so a job that printed
between two reads is still seen; and `blocked_print_commands`. A query outside an observation is a
snapshot: partial certainty and no since-start count. An unanswered scheduler is unavailable and has
no job counts, never zero.

**Changes.** `jobs_changed` when the active counts change; `candidate_print_blocked` when Electron
main reports a refused print command with the host event `{ "print_blocked": {} }`.

**Summary.** `candidate_jobs` and `unknown_jobs`. A job queued before the exam is active but not new:
it blocks the overview without counting in `candidate_jobs_since_start`.

**Platforms.**

- **Windows:** spooler change notifications on the local print server for job owner and status
  only. Each owner is compared with the candidate's account as it arrives and never kept. Discarded
  notifications are re-read in full and reported as a gap.
- **macOS and Linux:** one IPP `Get-Jobs` request a second over the local CUPS socket, for job
  number, state and owner only. Proctor does not link libcups. CUPS keeps finished jobs in its
  history, so the complete job list is a monitored scheduler; a list cut at 1,000 jobs is partial.
  Owners hidden by the CUPS privacy policy are `unknown`.

**Never leaves the agent.** Printer names, document names, job numbers, user names. Proctor never
cancels a job.

## Removable and portable storage

**Purpose.** Whether data-bearing storage is attached, mounted or not: USB drives, SD cards,
external disks, and phones or cameras exposing file or photo transfer. Keyboards, mice, headsets,
docks and hubs are not storage. Disk images and disks synthesized on another disk (APFS containers)
are not reported. An empty card reader is not a device until media is inserted.

**State.** `coverage` (block_and_portable, block_only, unavailable) and `devices` (at most 64,
ordered by identity), each with an opaque per-session `device_id`, `kind` (block_storage,
portable_device), `transport` (usb, thunderbolt, sd, other, unknown), `mounted` and `writable` (yes,
no, unknown). A device that returns keeps its `device_id` for the rest of the agent session. The
catalog asked for an Attempt-keyed pseudonym; the agent has no Attempt key yet, so identities are
per agent session until main provides one.

**Changes.** The new state on every change, reconciled every 2 seconds, with the change kinds
`device_attached`, `device_removed` and `device_changed`.

**Summary.** `block_storage` and `portable_devices` count every device, including those beyond the
listed 64. A kind the platform cannot read has no count, never zero: `block_only` coverage is partial
certainty and leaves out the `portable_devices` field.

**Platforms.**

- **Windows:** each `PhysicalDriveN` opened with no data access: the storage bus type (USB, SD, MMC)
  or the removable-media flag, media presence, and write protection; mounted means a drive-letter
  volume on that disk. A Thunderbolt disk reports its inner bus (NVMe) and counts only when Windows
  marks it removable. Phones and cameras: Windows Portable Devices enumerated by the USB bus, so a
  USB drive that also appears as a portable device through the software bus counts once.
- **macOS:** IOKit whole `IOMedia` whose provider is a block-storage driver, removable or ejectable or
  at an external interconnect location; the internal property decides, never transport alone, so a
  built-in disk on a Thunderbolt bus does not count. Mounted from `getmntinfo`. Phones and cameras:
  USB interfaces of the still-image class (PTP, usually with MTP), counted once per device. Still to
  be proved with an iPhone, Android phones and SD cards on certification rigs.
- **Linux:** `/sys/block` (the removable flag, and USB, Thunderbolt or MMC topology), read-only flags,
  `/proc/mounts`, and still-image interfaces in `/sys/bus/usb/devices`.

The catalog proposed DiskArbitration and device-interface notifications; polling the same properties
is simpler and loses nothing, because each read is the complete state.

**Never leaves the agent.** Serials, vendor/model, volume names, mount paths, file contents. Proctor
never ejects storage.

## Virtualization

**Purpose.** Whether the exam runs inside a virtual machine. Classification only.

**State.** `certainty`, `classification` (recognized_guest, recognized_physical_or_root, unknown),
`hypervisor` (hyperv, vmware, virtualbox, parallels, qemu_kvm, apple_virtualization, xen, other,
none_detected).

**Changes.** None while running; a fresh state after every interruption.

**Rules.** `block_recognized_guest` blocks only a recognized guest; `require_certified_physical_environment`
admits only `recognized_physical_or_root`, so unknown blocks.

**Certainty.** A probe that ran is complete certainty; the classification itself says how much the
evidence proves. That is why a clean machine meets `block_recognized_guest` while
`require_certified_physical_environment` still needs positive physical evidence.

**Platforms.**

- **Windows:** CPUID: the hypervisor bit, the vendor leaf, and the Hyper-V privilege leaf. A physical
  host with Hyper-V or VBS is the root partition, not a guest. Without a hypervisor bit the result is
  unknown, never physical. SMBIOS manufacturer and product are not read yet.
- **macOS:** the kernel's VMM-present flag and the hardware model. Positive physical evidence is an
  Apple hardware model (`Mac`, `MacBookPro`, `MacBookAir`, `Macmini`, `iMac`, `MacPro` followed by
  `<major>,<minor>`) on Apple silicon with no VMM flag; Apple's virtualization framework reports
  `VirtualMac…`. Still to be proved across Parallels, VMware Fusion and UTM.
- **Linux:** DMI vendor and product, then CPUID; it recognises guests but never proves physical.

## Network configuration

**Purpose.** Whether traffic goes through a system proxy, an OS-managed VPN or a tunnel.
Configuration only; Proctor never reads traffic or changes the network.

**State.** Per selected category: `system_proxy` (none, manual, automatic_config, auto_detect,
unknown), `managed_vpn` (inactive, active, unknown), `tunnels` (at most 32, opaque per-session ID
and class: point_to_point, packet_tunnel, virtual_ethernet, managed_vpn, other), `route_generation`.
A proxy auto-config script is reported as `automatic_config` and never read or run.

**Categories.** The capability is `network`, with sub-categories `system_proxy`, `managed_vpn`,
`tunnel_interfaces` and `route_change`. An activation selects at least one, and only selected ones
are read. An unselected category is absent from the state; a selected one the platform cannot read is
`unknown`, which makes certainty partial.

**Summary.** Tunnel counts by class: `tunnels_total`, `point_to_point`, `packet_tunnel`,
`virtual_ethernet`, `managed_vpn_tunnels`.

**Changes.** The new state on every change, reconciled every second. A route change alone is never a
violation; it only raises `route_generation`.

**Platforms.**

- **Windows:** the WinHTTP user proxy settings, RAS connections for OS-managed VPNs, adapters that
  are up by interface type (tunnel, PPP, virtual), and a fingerprint of the routing table.
- **macOS:** the SystemConfiguration proxy settings, interfaces from `getifaddrs`, and a fingerprint
  of the routing table. A `utun` interface counts only with a routable address, because iCloud
  Private Relay and Continuity create `utun` interfaces with link-local addresses only; this
  heuristic still needs certification. OS-managed VPN state is unknown for now.
- **Linux:** `/sys/class/net` (TUN/TAP flags, WireGuard, PPP) and the `/proc` routing tables; proxy
  and managed VPN are unknown.

**Never leaves the agent.** Addresses, interface names, SSIDs, DNS servers, proxy URLs, VPN server
names. Only selected categories are queried.

## Camera

**Purpose.** Whether a physical camera is present, permitted and ready, and whether another
application is using it. No frame is ever captured and no device is opened.

**State.** `coverage` (readiness_and_use, readiness_only, unavailable), `physical_devices`,
`virtual_devices` (software cameras, and any camera that cannot be classified), `ready` (ready,
not_ready, unknown: a physical camera is connected and not suspended, and the permission is granted)
and `in_use_by_other_app` (yes, no, unknown). The permission is the envelope's, never a state or rule
field.

**Changes.** The new state, reconciled every second, with `device_added`, `device_removed`,
`permission_changed`, `readiness_changed` and `use_changed`.

**Rules.** "Camera ready" is `camera.ready = ready` with a granted permission; a virtual camera never
satisfies it. `camera.summary.virtual_devices = 0` forbids virtual cameras, and
`camera.in_use_by_other_app = no` forbids concurrent use. An unknown `ready` or use has no field, so
a rule on it is unknown, never not met.

**Platforms.**

- **macOS:** AVFoundation's device list with each device's transport type (built-in, USB,
  Thunderbolt, PCI, FireWire, Bluetooth, wireless and Continuity are physical; virtual and
  unclassified are not), connected and suspended (a closed lid), `isInUseByAnotherApplication`, and
  the authorization status. The device-type discovery session is not used, because its macOS 14
  constants would not load on older systems.
- **Windows:** Media Foundation's video-capture sources, without activating any. A root- or
  software-enumerated source is virtual. The permission comes from the camera ConsentStore: the
  machine, user and desktop-app switches. Other-application use comes from the ConsentStore usage
  times (a use that started and has not stopped). That store is undocumented, so certification must
  prove it.
- **Linux:** V4L2 devices in sysfs, one per device; v4l2loopback devices are virtual. There is no OS
  consent, so the permission is granted; use is unknown, which makes coverage readiness_only.

**Permission.** Requested on the readiness overview only when a rule requires it. On macOS the
request shows the OS prompt and returns at once; the answer arrives as `permission_changed`. Windows
and Linux have no prompt: the request is refused and the overview points to the OS settings. The
packaged app must declare `NSCameraUsageDescription` and `NSMicrophoneUsageDescription`, or macOS
terminates the process that asks.

## Microphone

**Purpose.** Like the camera: present, permitted, ready, and whether another application records.
No audio is ever captured and no device is opened.

**State.** `coverage`, `devices`, `ready` (a microphone is available and the permission is granted)
and `in_use_by_other_app`. Changes, rules and the permission work as for the camera; a virtual
microphone counts as a microphone.

**Platforms.**

- **macOS:** Core Audio devices with input streams and whether they are alive. Recording elsewhere is
  read from Core Audio's process objects, where any process other than the agent that is running
  input is recording. Process objects exist from macOS 14; earlier systems report use as unknown.
  The device-wide "running somewhere" flag is not used, because playback through a headset sets it.
- **Windows:** Core Audio's active capture endpoints, and an active audio session from another
  process on any of them. The permission comes from the microphone ConsentStore.
- **Linux:** ALSA capture PCMs in `/proc/asound`; a running capture substream is recording, whatever
  sound server or direct access opened it.

## External screen capture

No platform offers a reliable list of other applications capturing the screen. It is
`unavailable` everywhere and accepted only as disabled. Single display, remote attachment,
application rules and content protection are related controls; none claims that capture is absent.
The [screen evidence recorder](./native-capabilities.md#screen-evidence-recorder) is Proctor's own
recording and is not a capture-detection capability.
