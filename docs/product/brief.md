# Product brief

## Confirmed purpose

Proctor Desktop is a trusted Electron client for the Proctor examination and
proctoring platform. It belongs to the same product as the Proctor server and
uses the server's domain language rather than creating a desktop-specific
parallel model.

The desktop experience is expected to reuse and adapt appropriate architecture
and implementation patterns from Visual Studio Code. Reuse serves Proctor's
workflows; matching VS Code is not itself a product goal.

Proctor Desktop is a workbench for programming examinations, not a
general-purpose code editor with proctoring attached. Every candidate Exam
Attempt includes an IDE workspace. The candidate can switch between that
workspace and read-only exam materials, while attempt state, capability policy,
and proctoring remain part of the same trusted examination experience.

## Product qualities

The client must make examination work feel dependable under long-running,
interruption-prone conditions. Security-sensitive behavior must be explicit,
auditable where the product requires it, and understandable to the person
affected by it.

The current phase establishes the application platform before product feature
implementation: VS Code adoption boundaries, source organization, workbench
composition, design-system mechanics, Attempt Workspace semantics, native
capability boundaries, and agent guidance. Server protocol design and a first
end-to-end product slice deliberately come later.

## Non-goals

- Reproducing the entire VS Code product or extension ecosystem.
- Building the renderer with React, Vite, Next.js, or another component
  framework. The accepted renderer model is plain TypeScript, DOM APIs, and
  co-located CSS following the VS Code workbench style.
- Treating local folders, the local filesystem, or a local PTY as the primary
  application model. Attempt resources are remote-first, and a future terminal
  connects to a PTY in an isolated remote VM.
- Treating the desktop client as the authority for durable institutional,
  authorization, examination, or submission state.
- Hiding platform-specific behavior behind a false cross-platform abstraction
  before two real adapters require a seam.
- Shipping speculative frameworks, registries, or contribution points without
  a product use case.
