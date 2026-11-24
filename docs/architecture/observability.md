# Observability

Proctor Desktop records what it does so a bug can be traced from a user's
report to the operation that failed, without collecting anything a person or an
Institution has not agreed to. This document owns the logging, error and
telemetry rules; [invariants](./invariants.md) `diagnostics.sensitive-data` and
`diagnostics.structured-logging` state the boundaries.

## Logs

- **One service.** Proctor code logs through `ILogService`, never `console`.
  Electron main writes a bounded, rotated file in the application's logs
  folder. Each window forwards its entries to main through one closed preload
  capability that accepts only a level, an area from a fixed list, and a
  length-bounded message.
- **Levels.** Error: an operation failed and the person saw a failure.
  Warning: something degraded but recovered, such as a retry or a fallback to
  polling. Info: lifecycle steps such as sign-in, window changes and
  subscriptions. Debug and Trace: detail for a developer who turned them on.
  The default is Info.
- **What goes in.** Server request ids, operation ids, closed failure reasons,
  entity ids, timings and counts.
- **What never goes in.** Names, usernames, email addresses, credentials,
  tokens, Workspace or Exam Resource content, browser activity, native
  observations, evidence, and free text a person typed.

## Unexpected errors

Each composition root installs `setUnexpectedErrorHandler`, which logs the
error with its area. A `catch` that can answer with a closed failure reason
does so; one that cannot passes the error to `onUnexpectedError` instead of
swallowing it.

## Telemetry

- **Declared events.** A product event exists only as a typed declaration that
  states its purpose and classifies every field, in the style of VS Code's
  classified events. A field without a classification does not compile.
- **No destination yet.** Declared events go only to the log, at Trace level.
  Nothing leaves the device until the product owner chooses a destination and
  its consent model; that choice is recorded here when made.
- **Microsoft telemetry stays excluded**
  (`upstream.product-assumptions-excluded`).
