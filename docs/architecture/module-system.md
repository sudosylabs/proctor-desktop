# Module system

## Vocabulary

Use these terms consistently:

- **Module** — anything with an interface and an implementation: a function,
  class, package, or tier-spanning slice.
- **Interface** — everything a caller must know to use a module correctly,
  including invariants, ordering, errors, configuration, and performance.
- **Implementation** — behavior hidden inside a module.
- **Depth** — leverage at the interface: useful behavior per unit of interface
  a caller must learn.
- **Seam** — the place where a module's interface lives and behavior can be
  changed without editing its caller.
- **Adapter** — a concrete implementation role at a seam.
- **Leverage** — capability callers gain from a small interface.
- **Locality** — concentration of change, knowledge, bugs, and verification in
  one place.

Prefer deep modules: small interfaces hiding substantial behavior. The
deletion test exposes shallow pass-throughs—if deleting a module merely moves
its complexity into every caller, it had depth; if complexity disappears, it
was probably indirection.

## Logical layers

Proctor Desktop may reuse VS Code's proven layer concepts where they serve the
product. The initial dependency order is:

```text
base <- platform <- editor <- workbench <- code
```

- **base** — environment-neutral primitives and browser UI building blocks;
  no product capability lookup.
- **platform** — stable capability interfaces and infrastructure shared across
  higher layers.
- **editor** — selected editor model and UI independent of the Proctor
  workbench. It is a reusable workbench capability, not the product shell.
- **workbench** — Proctor product workflows, contributions, and browser UI.
- **code** — Electron entry points, composition, packaging integration, and
  process lifecycle.

An arrow points toward the layer that may be imported. Higher layers may import
lower layers; lower layers never import higher layers. Copying a VS Code file
does not exempt it from this rule.

Within a layer, separate runtime environments explicitly when they matter:

- `common` uses environment-neutral JavaScript facilities;
- `browser` may use web APIs;
- `node` may use Node.js APIs;
- `electron-main` may use main-process Electron APIs;
- `electron-browser` may use browser APIs plus explicitly mediated Electron
  integration;
- `electron-utility` may use Node.js and Electron utility-process APIs.

These names describe dependency constraints. Create their directories only
when substantive code belongs there.

## Seam discipline

- Accept dependencies rather than constructing concrete adapters inside a
  module.
- Return results or explicit effects instead of mutating hidden caller state.
- Keep internal test seams private to the implementation.
- Introduce a port when at least two adapters are justified, commonly
  production and in-memory test adapters.
- For remote Proctor services, define consumer-owned ports when feature work
  begins and keep transport DTO translation in adapters. Do not design those
  transports merely to complete the platform skeleton.
- For true external systems, inject a narrow port and test with a mock adapter.
- Do not expose registries, factories, or dependency injection through a
  module interface merely because the implementation uses them.

## Composition

Electron main and renderer startup files are composition roots for their
respective process graphs. Concrete adapter selection stays at those roots.
Preload is an adapter, not a second application layer or service locator.

## Testing

The interface is the test surface. Tests assert observable results, declared
errors, and effects across the seam. They survive implementation refactors.

When a cluster of shallow modules is replaced by a deep module, replace their
implementation-coupled tests with tests at the new interface. Retain narrower
tests only for behavior that remains a private, independently meaningful
module.
