# Privileged native helper

`prctr-helper` is the passive OS observer used by the native agent for full process and
interactive-session coverage. Its platform modules collect OS facts; the existing hub owns
subscriptions, session scoping, framing and loss recovery. Paths, command lines, account IDs,
usernames and socket addresses do not enter the helper protocol.

The Windows and macOS OS layers are implemented in source. Privileged target-machine acceptance,
signing, installer integration and packaged conformance remain required before claiming supported
coverage. A compile check does not establish OS behavior.

## Build and installation layout

From the repository root:

```sh
cargo build --manifest-path native/Cargo.toml -p prctr-helper -p prctr-agent --release
```

On Windows, install `prctr-helper.exe` beside `prctr-agent.exe` in the protected application
directory. The installer must register `ProctorNative` as a LocalSystem, own-process service with
that exact helper executable path. The helper accepts SCM stop, shutdown and session-change
controls. `prctr-helper.exe --console` runs the same core with console shutdown controls for SYSTEM
scheduled-task tests. It does not install a service or elevate itself.

The local byte pipe is `\\.\pipe\ProctorNative`, with SYSTEM full access and interactive users
read/write (`0x0012019B`: generic read and write without `FILE_CREATE_PIPE_INSTANCE`, so no user
process can serve another instance or hold the name while the service is stopped). Its first
instance is exclusive. The helper authorizes the normalized installed agent
path and, when the helper is signed, the same verified signing certificate. The agent checks the
server process ID against SCM after connecting. Authenticode and system-catalog identity checks
use cached trust material without network retrieval; unverifiable identities remain unavailable.

On macOS 13 or later, stage both executables under `Contents/MacOS/`. Copy
[`resources/macos/com.proctor.native.plist`](resources/macos/com.proctor.native.plist) to
`Contents/Library/LaunchDaemons/com.proctor.native.plist`. Sign the helper with the
[Endpoint Security entitlement](resources/macos/entitlements.plist) using an authorized signing
profile. Apple approval and Full Disk Access are runtime prerequisites; test rigs may use the
handoff's SIP-off environment. Root alone does not prove that ES access is available.

The installer must create `/var/run/com.proctor.native` as root, mode 0755, including after reboot
because `/var/run` is transient. Register only after this directory exists. launchd owns the socket
`/var/run/com.proctor.native/agent.sock`; the daemon refuses non-root execution and consumes its
`Listener` socket activation descriptor. Registration, boot-directory provisioning, signing,
updates and removal belong to installer integration; these source artifacts do not install them.

Run the bundled agent with `--register-native-helper` during explicit setup, or with
`--native-helper-status` for a read-only query. Both exit after printing `not_registered`,
`requires_approval` or `enabled`; neither enters the exam protocol. `enabled` is registration
status, not proof that Endpoint Security observation works. The regular helper connection checks
root peer credentials, and the daemon checks the agent's designated requirement using the
connection's audit token.

## Observation and failure

Process and session observation starts only for subscribers. Dropping the final subscription
releases its watch; disconnecting a stream shuts down both halves so idle reader threads do not
keep observation alive. Read failures remain unavailable, never complete empty inventories.
Creation times use Unix-epoch 100 ns ticks on both platforms; a Windows snapshot process whose
creation time cannot be read (`0`) still matches its own exit. A process that exits between a
snapshot's reads is left out; a live process whose session cannot be read fails the snapshot.
Source generations reject delayed events from a stopped watch. A dead ETW consumer loses full
coverage and is retried on the next hub tick. Event loss produces an explicit gap and a new
inventory.

Code identity is verified off the hub thread: processes are first reported `pending`, then
`process_identified` follows. A full identity queue reports the identity unavailable instead of
leaving it pending. The hub's event queue is bounded; a process-source overflow becomes one event
loss and a fresh inventory. A failed accept is one connection's failure: the listener backs off
and keeps serving, and only 32 consecutive failures stop the helper so the service manager can
restart it. A failed Windows service run reports a service-specific exit code.

Windows uses ETW and Toolhelp/GetProcessTimes, plus all-session WTS reads. macOS uses ES NOTIFY
exec/fork/exit and login-window/screen-sharing events, `proc_listallpids`/`proc_pidinfo`,
`IOConsoleUsers` and `IOConsoleLocked`. Graphical session IDs are not audit session IDs: lock events
are correlated internally by a non-exported user key, and audit IDs remain the protocol scope.
On macOS, `apple` means the code satisfies `anchor apple` in both snapshots and events: an event
settles it only for platform binaries and code with a Team ID, and other signed code is verified
like a snapshot process. Session events wake the hub within 100 ms. Initial screen sharing uses
established TCP connections on local ports 5900/3283 held by macOS's own remote-management daemons
(`/System/Library/CoreServices/RemoteManagement/`); only their descriptors are read. If a positive
initial connection cannot be assigned among multiple sessions, or ES attachment has no user
association, session coverage stays unavailable. Missing lock state remains unknown.

## Verification

Ordinary checks:

```sh
cargo test --manifest-path native/Cargo.toml -p prctr-helper
cargo test --manifest-path native/Cargo.toml -p prctr-os --test macos_helper_abi
cargo clippy --manifest-path native/Cargo.toml -p prctr-helper -p prctr-capabilities -p prctr-os -p prctr-agent --all-targets
```

The SDK ABI test is macOS-only and checks both supported architecture layouts without observing
processes or starting a helper. Windows unit tests exercise installed-path peer verification and
real-pipe server-PID rejection; they use temporary fixtures, not the production service pipe.

On the Windows SYSTEM rig, or the root macOS ES/FDA rig, explicitly run:

```sh
cargo test --manifest-path native/Cargo.toml -p prctr-helper --test privileged -- --ignored --test-threads=1
```

Those tests require a local unlocked human console and no competing named ETW test/service.
They exercise matching event/snapshot creation times, rapid process pairs or explicit loss, and
session facts. The long-lived macOS child is `/bin/sleep` so its snapshot can be compared; the rapid
case uses `/usr/bin/true`. Tests do not disable SIP, grant permissions, register services or change
machine security settings.

Release certification must additionally exercise real signed/unsigned installation layouts,
different signers, service/daemon stop and restart, spoofed production endpoints, Windows
notepad launch/exit, lock/unlock, user switching, remote attach/detach (including before
subscription), permission denial/revocation, and target-native packaged artifacts. These scenarios
remain unproven until their target-machine results are recorded.
