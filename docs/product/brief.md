# Product brief

## Confirmed purpose

Proctor Desktop is a trusted Electron client for the Proctor examination and
proctoring platform. It belongs to the same product as the Proctor server and
uses the server's domain language rather than creating a desktop-specific
parallel model.

The desktop experience is expected to reuse and adapt appropriate architecture
and implementation patterns from Visual Studio Code. Reuse serves Proctor's
workflows; matching VS Code's product breadth is not itself a product goal.
Admitted behavior follows the fidelity rule in the
[VS Code source policy](../upstream/vscode.md).

Proctor Desktop is a workbench for programming examinations, not a
general-purpose code editor with proctoring attached. Every candidate Exam
Attempt includes an IDE workspace. The candidate can switch between that
workspace and read-only exam materials, while attempt state, capability policy,
and proctoring remain part of the same trusted examination experience.

The signed-in product is broader than the secure Attempt window. Students use
it to see scheduled, joinable, in-progress, submitted, reviewed, and past exam
activity. Teachers and Exam Managers use server-authorized academic-unit,
authoring, delivery, supervision, and review workflows. System administrators
use separate authorized administration areas. Account and settings remain part
of the same authenticated application.

## Product qualities

The client must make examination work feel dependable under long-running,
interruption-prone conditions. Security-sensitive behavior must be explicit,
auditable where the product requires it, and understandable to the person
affected by it.

The current phase turns the accepted application platform into the first
end-to-end Desktop slices. Existing server contracts already cover identity,
Sessions, realtime, Attempts, workspaces, submissions, User Settings, integrity
review, and remote execution. The accepted
[Desktop/server contract](../contracts/README.md) defines coordinated policy,
secure admission, configuration, delivery, browser, correction and execution work.
[Project status](../project/status.md) distinguishes implementation progress,
remaining adapters and verified release capability.

## Non-goals

- Reproducing the entire VS Code product or extension ecosystem.
- Building the renderer with React, Vite, Next.js, or another component
  framework. The accepted renderer model is plain TypeScript, DOM APIs, and
  co-located CSS following the VS Code workbench style.
- Treating local folders, the local filesystem, or a local PTY as the primary
  application model. Attempt resources are remote-first, and the integrated
  terminal connects to a PTY in an isolated remote execution environment.
- Treating the desktop client as the authority for durable institutional,
  authorization, examination, or submission state.
- Hiding platform-specific behavior behind a false cross-platform abstraction
  before two real adapters require a seam.
- Shipping speculative frameworks, registries, or contribution points without
  a product use case.
- Shipping the AI agent in the first release. Its policy, provider, model,
  tool, network, privacy, and evidence boundaries remain deferred.
