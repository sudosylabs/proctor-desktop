# Architecture overview

No application implementation has landed. This document contains only confirmed
boundaries.

Proctor Desktop is an Electron workbench for programming examinations. Every
candidate Exam Attempt includes an IDE workspace, while the surrounding shell
owns examination materials, capability policy, attempt state, and proctoring.
The renderer uses plain TypeScript, DOM APIs, and CSS.

An unauthenticated user receives a minimal launch window. Electron main creates
an immutable candidate or proctor workbench only after authentication and role
authorization. Candidate examination interaction additionally depends on a
privileged secure-exam posture, continuous participation, and current server
admission that the renderer cannot grant to itself. See the
[identity and exam-security architecture](./identity-and-exam-security.md) and
[workbench architecture](./workbench.md).

An authenticated User may instead open a dedicated SettingsWindow outside the
role workbenches. It edits one server-authoritative virtual `settings.json` and
cannot exist during active candidate participation. Candidate mode consumes an
Attempt-wide frozen baseline under current trusted constraints. See the
[user-settings architecture](./user-settings.md).

Most durable product data is remote. The desktop may eventually cache or stage
data, but a local folder is not assumed to be the Attempt Workspace. A future
terminal renders a PTY hosted by an isolated remote VM.

## Process boundary

```text
remote Proctor services and isolated runtimes
                    ^
                    |
          privileged Electron processes
                    ^
                    | narrow, validated capabilities
                    v
              sandboxed renderer
```

- The renderer owns presentation and interaction without ambient Node.js or
  unrestricted Electron access.
- Preload exposes a minimal capability surface and contains no product
  orchestration.
- Electron main and utility processes own privileged lifecycle, native access,
  and runtime adapters.
- Passive native packages expose bounded mechanical observations to the
  dedicated exam-security utility process. Electron main owns process launch,
  permissions, and closed candidate-window effects. The renderer receives
  neither raw native streams nor generic native control.

The accepted [design-system architecture](./design-system.md) governs
presentation and interaction across all compositions. The accepted
[Attempt Workspace architecture](./attempt-workspace.md) governs workspace and
Exam Resource durability. The accepted
[identity and exam-security architecture](./identity-and-exam-security.md)
governs privileged credential custody, admission projections, online-only
posture, containment, participation continuity, re-entry gating, and integrity
information. The accepted
[native-capability architecture](./native-capabilities.md) governs passive
sources, private process protocols, candidate-window enforcement, strict
display topology, failure behavior, privacy, and platform verification.
The accepted [toolchain architecture](./toolchain.md) governs the package graph,
compilation, deterministic generation, native delivery, packaged verification,
updates, CI, and release provenance that must preserve those boundaries.
