# Architecture invariants

Change these rules only by updating this document and its rationale in the same
change.

## Product and state

1. `product.exam-workbench` Proctor Desktop is a programming-examination workbench; every candidate Exam
   Attempt includes an IDE workspace, but the product is not a general-purpose
   editor.
2. `product.remote-workspace` Attempt Workspace identity does not derive from a local filesystem path.
3. `product.remote-terminal` A future integrated terminal attaches to a remote VM PTY rather than creating
   a renderer-accessible local process.
4. `product.integrity-flag` An Integrity Flag records evidence and never represents an automatic finding
   of guilt.
5. `product.independent-gates` Authentication, role authorization, resource authorization, and candidate
   secure-exam readiness are independent decisions.

## Source and modules

6. `source.namespace` Proctor-owned application source lives under `src/prctr/`.
7. `source.layer-direction` Dependencies follow the layer order in
   [`source-code-organization`](../../.agents/skills/source-code-organization/SKILL.md).
8. `source.deep-modules` Modules expose small interfaces, keep internal seams private, and select
   concrete adapters in process composition roots.
9. `source.interface-tests` Tests cross the same interface as callers and assert observable behavior.
10. `source.static-contributions` User-visible features enter through static Proctor-owned contribution
    manifests; remote data selects only among packaged capabilities.

## Renderer and privilege

11. `renderer.plain-dom` Renderer UI uses plain TypeScript, DOM APIs, and co-located CSS.
12. `renderer.no-ambient-node` Renderer code receives no ambient Node.js or unrestricted Electron access.
13. `renderer.sandboxed` Renderer sandboxing and context isolation remain enabled.
14. `composition.immutable-window` Electron main selects an immutable window composition before renderer
    bootstrap; renderer state and external input cannot select or change it.
15. `preload.capability-allowlist` Preload exposes an explicit capability allowlist for its window kind rather
    than generic IPC.
16. `privilege.validate-authorize` Privileged processes validate inputs and authorize each operation; renderer
    context and visibility state never authorize privileged behavior.
17. `identity.credential-custody` Authentication credentials and credential-store handles remain outside the
    renderer.
18. `runtime.handle-isolation` Electron, Node.js, and native handles do not cross environment-neutral or
    renderer interfaces.
19. `diagnostics.sensitive-data` Sensitive exam, identity, observation, and credential data does not enter
    ordinary logs, telemetry, or crash metadata.

## Design system

20. `design.shared-system` Launch, SettingsWindow, candidate, and proctor surfaces use one
    Proctor-owned semantic token and reusable-control system; VS Code token and
    glyph identifiers are not Proctor interfaces.
21. `design.static-registration` Themes, tokens, icons, and style enter through static Proctor composition;
    remote content and examinations cannot register or inject them.
22. `design.presentation-not-authority` Presentation cannot authorize an operation or become authoritative
    examination, security, or integrity state, and color or iconography never
    communicates consequential state alone.
23. `design.accessibility` Interactive surfaces target WCAG 2.2 AA, prefer native semantics, and ship
    keyboard, focus, zoom, high-contrast, reduced-motion, and screen-reader
    behavior with their interface.
24. `design.css-ownership` CSS is co-located with its DOM owner, follows the accepted cascade, and does
    not expose another module's internal selectors as a styling seam.
25. `design.control-interface` A reusable control has a small Proctor-owned interface, caller-owned domain
    state, explicit lifecycle ownership, and deterministic explorer and test
    evidence through that interface.
26. `design.test-code-excluded` Control Explorer, fixture, baseline, and test-adapter code is unreachable
    from production candidate and proctor manifests.

## Upstream

27. `upstream.evidence-not-authority` VS Code is evidence, not authority over Proctor product behavior or module
    boundaries.
28. `upstream.boundary-grill` A VS Code behavior cluster is admitted only after its Proctor workflow,
    interface, assumptions, dependency closure, and competing treatments have
    been grilled.
29. `upstream.exact-provenance` Every admitted cluster records exact revisions, source blobs, dispositions,
    licenses, divergence, and verification in one canonical registry manifest.
30. `upstream.license-preservation` Applicable upstream notices and copyright headers are preserved.
31. `upstream.product-assumptions-excluded` Microsoft identity, services, endpoints, branding, telemetry, marketplace,
    and update assumptions are never inherited by source proximity.
32. `upstream.single-revision-closure` One admitted cluster and its transferred closure use one upstream commit;
    independent clusters interact through accepted Proctor interfaces.
33. `upstream.no-aggregate-entrypoints` Upstream aggregate entrypoints never select Proctor services or product
    contributions.

## Attempt Workspace

34. `workspace.stable-entry-identity` A stable Workspace Entry Reference identifies a workspace entry across
    rename and move; its mutable case-sensitive POSIX-relative Workspace Path is
    neither identity, authorization, nor a desktop or remote-VM host path.
35. `workspace.opaque-content-version` A Workspace Content Version is an opaque provider token and does not imply
    that the server creates a retained File Revision or Rendition on every save.
36. `workspace.acknowledged-durability` Only an authoritative acknowledgement establishes server durability;
    provider completion, events, cache, recovery, and editor cleanliness do not.
37. `workspace.distinct-states` Authoritative Workspace Snapshot, Working Workspace Overlay, protected local
    recovery, and remote execution projection remain distinct states.
38. `workspace.protected-recovery` Recovery Records use privileged encrypted storage and opaque identifiers;
    the renderer receives neither raw paths nor a generic filesystem interface.
39. `workspace.provider-projection` A VS Code-compatible filesystem provider is a caller-side projection over
    the Proctor workspace module. URI possession, provider registration,
    connectivity, capability projection, and context keys never authorize.
40. `workspace.orthogonal-state` Content relation, mutation progress, recovery protection, availability, and
    access remain independent facts and user-visible durability language derives
    from their combination.
41. `workspace.protect-unacknowledged-work` Conflicted, rejected, uncertain, or revoked local work remains protected
    until acknowledged replacement or explicit discard.
42. `workspace.submission-readiness` Only acknowledged authoritative workspace state at a Workspace Cursor can
    become submission-ready; the workspace module never submits.
43. `workspace.exam-resources-separated` Exam Resources use a separate read-only catalog and provider scope and never
    enter the Working Workspace Overlay or Submission.

## Identity and exam security

44. `security.privileged-credential-custody` Credentials, cookies, provider secrets, credential-store handles, and
    authenticated Electron-session control remain in privileged modules; the
    renderer receives sanitized projections and closed intents.
45. `security.independent-authorization` Authentication, Composition Admission, Attempt Admission, and Operation
    Authorization remain independent, and every sensitive operation checks
    current authority against its actual resource.
46. `security.privileged-posture` The privileged Exam Security Coordinator owns local Secure Exam Posture;
    renderer state, context keys, restored state, and remote presentation data
    never establish readiness.
47. `security.online-only` Candidate examination interaction requires continuous authenticated server
    connectivity and has no offline grace or offline editing mode. Connection
    loss blocks new interaction while preserving accepted and outcome-unknown
    work for reconciliation.
48. `security.containment-before-presentation` Capability denial and work protection precede blocked-state presentation;
    recovery restores interaction only after fresh authentication, admission,
    policy, monitor health, reconciliation, and authorization.
49. `security.fenced-participation` One fenced Attempt Participation generation is current. Ordinary close is
    prohibited during active participation; trusted-process loss requires
    server-authorized re-entry and a new generation before interaction resumes.
50. `security.integrity-vocabulary` Native Observation, Security Signal, Detector Finding, Integrity Evidence,
    Integrity Flag, Review Outcome, and Consequence remain distinct. The
    renderer receives no raw observation or evidence stream.

## Native capabilities

51. `native.passive-sources` Native observation packages are passive mechanical fact sources. They
    receive no exam policy, accommodation, detector rule, posture, or generic
    control command; the Exam Security Coordinator owns interpretation and
    separate closed adapters own effects.
52. `native.process-boundaries` The attempt-scoped Exam Security Coordinator runs in a dedicated utility
    process behind a private authenticated protocol. Electron main owns process
    supervision, permission prompting, candidate-window enforcement, and the
    fail-closed renderer projection.
53. `native.single-display-window` Candidate admission requires one verified maximized constrained candidate
    window and exactly one connected usable display target with no mirrored,
    virtual, remote, or specialized secondary target.
54. `native.race-free-session` Every observation source opens with one race-free snapshot/sequence
    boundary and reports ordered bounded events, health, permission, gaps, and
    resets. Event loss and uncertainty are explicit and never become misconduct
    by themselves.
55. `native.fail-closed` Required source, process, permission, topology, protocol, or enforcement
    loss blocks interaction. Restart creates a new source instance and gap and
    cannot restore readiness without complete fresh checks.
56. `native.abnormal-loss-contained` Abnormal privileged-process loss never releases candidate-window
    constraints or authorizes departure; it creates a Participation
    Interruption and follows recovery or re-entry.
57. `native.packaged-conformance` A native platform claim requires packaged conformance on each supported
    Windows/macOS version and architecture. Mocks and generic Electron behavior
    cannot establish an OS capability guarantee.

## User settings

58. `settings.server-authority` The User Settings Document is one server-authoritative, Principal-owned,
    bounded JSONC document with an opaque revision. Its virtual `settings.json`
    is neither a host file nor an Attempt Workspace resource.
59. `settings.static-registry` Only the frozen Proctor settings registry can make a preference effective.
    Unknown keys remain inactive, prohibited keys never resolve, and remote
    content or schemas cannot register behavior.
60. `settings.no-authority` Settings personalize packaged presentation and editor behavior but never
    grant capability, authorize an operation, configure monitoring or security,
    or enter precedence from workspace content and restored state.
61. `settings.dedicated-window` SettingsWindow is a Session-bound authenticated non-workbench window with no
    role or Attempt authority. It is unavailable during active candidate
    participation, and candidate preload exposes no settings mutation surface.
62. `settings.frozen-candidate-baseline` A Candidate Settings Baseline is fenced once per Exam Attempt and survives
    renderer restart, Participation Interruption, and authorized re-entry.
    Remote settings changes cannot alter it.
63. `settings.stronger-live-constraints` Current trusted policy, platform, accessibility, and packaged safety
    constraints may change the Effective Candidate Settings Projection without
    mutating the baseline or the User Settings Document.
64. `settings.conditional-writes` Settings writes use an expected opaque revision and idempotency key. There
    is no last-write-wins or offline mutation queue, and protected caches never
    become authority or silently fall back to plaintext.

## Toolchain and release

65. `toolchain.single-esm-graph` Desktop TypeScript uses one private locked npm graph, strict NodeNext ESM,
    independent no-emit type and runtime checks, and esbuild as its only
    application emitter and bundler. Source layers are not packages.
66. `toolchain.closed-packages` Production processes and compositions enter through closed Proctor-owned
    manifests. Package inventory, fuses, ASAR integrity, signing, and tests prove
    the exact shipped artifact and its exclusions.
67. `toolchain.native-schema-authority` Native protocols have one language-neutral schema authority, generated
    TypeScript/Rust views, runtime validation, explicit bounds, and target-bound
    signed artifacts. Building one capability does not require shipping another.
68. `toolchain.signed-capability-matrix` Secure-candidate support exists only for tuples present in the signed
    release capability matrix and proven on packaged target-native artifacts.
69. `toolchain.attempt-safe-updates` Updates never install, restart, or downgrade the application during active
    or interrupted participation. Admission and current security policy govern
    release compatibility.
