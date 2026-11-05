# Architecture overview

No Electron application runtime has landed. The native display-topology source
and its repository/toolchain controls are implemented at source level. This
document summarizes accepted boundaries and does not claim packaged
secure-target conformance or completion of the remaining features.

Proctor Desktop is an Electron workbench for the whole Proctor examination
product. Authenticated students see their exam activity; teachers, Exam
Managers, and administrators see their current server-authorized areas. Every
Candidate Exam Attempt includes an IDE workspace and may include an integrated
browser. The renderer uses plain TypeScript, DOM APIs,
and CSS.

The application has three trusted window kinds. `LaunchWindow` selects one
Proctor Server and presents only safe Institution readiness/compatibility before
starting authentication. The server-hosted system-browser page owns local or
external authentication choice and final approval. Electron main completes
state/PKCE/registered-installation proof through an exact loopback callback.
`AuthenticatedWindow` is the normal signed-in product home, including account
and settings. `CandidateWindow` exists only for one active secure Attempt;
opening it closes AuthenticatedWindow, and relaunch never restores it directly.

Candidate interaction additionally depends on a registered Desktop key,
current Session and active Session lock, Attempt admission, Participation lease,
frozen Attempt Configuration, local Secure Exam Posture, and current operation
authorization. Renderer presentation cannot establish any of them. Suspension
returns to AuthenticatedWindow; manager reallow creates ready state, and only a
successful secure join returns the Attempt to active.

Most durable product data is remote. A local folder is not the Attempt
Workspace. Desktop owns a Working Overlay and protected recovery/cache around
the server's v1 cursor/journal/mutation contract. The integrated browser enforces
revision-frozen policy over the candidate's network and delivers minimized
ordered Browser Activity. Code execution is absent for now: the server removed
execution hosts and terminals, and a Run capability is planned before the first
release. The AI agent is deferred.

## Process boundary

```text
Proctor Server
                         ^
                         |
               privileged Electron processes
                         ^
                         | narrow validated capabilities
                         v
                   sandboxed renderers
```

- Renderers own presentation and closed intents without ambient Node.js,
  credentials, native handles, or unrestricted Electron access.
- Preloads expose fixed window-specific capabilities and no product
  orchestration or generic IPC.
- Electron main owns identity/key custody, window lifecycle, protected storage,
  system-browser/loopback coordination, updater, permissions, and closed
  CandidateWindow effects.
- A dedicated utility process owns Attempt-scoped security coordination and
  consumes passive bounded native sources through private protocols.
- Server adapters own wire representation while domain modules expose
  purpose-specific projections and operations.

The focused architecture topics own the detailed rules:

- [Workbench](./workbench.md) — three windows, shell, contributions, and
  lifecycle;
- [Identity and exam security](./identity-and-exam-security.md) — readiness,
  authorization, installation proof, Sessions, Attempt continuity, and
  integrity;
- [User settings](./user-settings.md) — virtual JSONC and Attempt Configuration;
- [Attempt Workspace](./attempt-workspace.md) — remote workspace, overlay,
  recovery, and v1 adapter;
- [Integrated browser](./integrated-browser.md) — navigation enforcement and
  Browser Activity;
- [Native capabilities](./native-capabilities.md) — passive sources, window/
  display enforcement, privacy, and packaged conformance;
- [Design system](./design-system.md) and [toolchain](./toolchain.md) — shared
  presentation and the exact artifact that preserves these boundaries.
