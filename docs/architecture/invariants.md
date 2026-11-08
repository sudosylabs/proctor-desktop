# Architecture invariants

Change these rules only by updating this document and its rationale in the same
change.

## Product and state

1. `product.exam-workbench` Proctor Desktop is a programming-examination workbench; every Candidate Exam
   Attempt includes an IDE workspace, but the product is not a general-purpose
   editor.
2. `product.remote-workspace` Attempt Workspace identity does not derive from a local or remote-VM
   filesystem path.
3. `product.no-local-process` The Candidate renderer never receives a local process, shell, or
   generic execution handle. Code execution is absent until its boundary is
   accepted.
4. `product.integrity-flag` An Integrity Flag records evidence and never represents an automatic finding
   of guilt or a grade.
5. `product.independent-gates` Server readiness, authentication, authenticated navigation, Attempt
   admission, operation authorization, authoritative Attempt state, and local
   Secure Exam Posture remain independent decisions.

## Source and modules

6. `source.namespace` Proctor-owned application source lives under `src/prctr/`.
7. `source.layer-direction` Dependencies follow the layer order in
   [`source-code-organization`](../../.agents/skills/source-code-organization/SKILL.md).
8. `source.deep-modules` Modules expose small interfaces, keep internal seams private, and select
   concrete adapters in process composition roots.
9. `source.interface-tests` Tests cross the same interface as callers and assert observable behavior.
10. `source.static-contributions` User-visible features enter through static Proctor-owned contribution
    manifests; remote data selects only instances of packaged capabilities.
11. `source.contribution-boundaries` A Proctor-authored contribution lives in one
    `workbench/contrib/<feature>` folder with no environment folder except a
    `common/` for DOM-free modules, imports no other contribution, and is
    reached from the shell and services only through a service, registry,
    command, or context key.
12. `source.constructor-injection` Workbench services are `createDecorator`
    identifiers resolved by one strict instantiation service per window; a class
    that takes services declares them in its constructor and is created with
    `createInstance`, never assembled by hand or looked up by name.

## Renderer, windows, and privilege

13. `renderer.plain-dom` Renderer UI uses plain TypeScript, DOM APIs, and co-located CSS.
14. `renderer.no-ambient-node` Renderer code receives no ambient Node.js or unrestricted Electron access.
15. `renderer.sandboxed` Renderer sandboxing and context isolation remain enabled.
16. `composition.immutable-window` Electron main selects LaunchWindow, AuthenticatedWindow, or CandidateWindow
    before renderer bootstrap; renderer state and external input cannot select
    or change the window kind.
17. `composition.candidate-transition` CandidateWindow exists only for active secure participation, closes
    AuthenticatedWindow when opened, returns to AuthenticatedWindow on
    suspension/departure, and is never restored directly after relaunch.
18. `preload.capability-allowlist` Preload exposes an explicit capability allowlist for its window kind rather
    than generic IPC.
19. `privilege.validate-authorize` Privileged processes validate inputs and authorize each operation; renderer
    context and visibility state never authorize privileged behavior.
20. `identity.credential-custody` Authentication credentials, installation private keys, and OS-store handles
    remain outside renderers.
21. `runtime.handle-isolation` Electron, Node.js, and native handles do not cross environment-neutral or
    renderer interfaces.
22. `diagnostics.sensitive-data` Sensitive exam, identity, browser, observation, and credential data
    does not enter ordinary logs, telemetry, or crash metadata.

## Design system

23. `design.shared-system` LaunchWindow, AuthenticatedWindow, and CandidateWindow use one Proctor-owned
    semantic token and reusable-control system; VS Code token and glyph
    identifiers are not Proctor interfaces.
24. `design.static-registration` Themes, tokens, icons, and style enter through static Proctor composition;
    remote content and examinations cannot register or inject them.
25. `design.presentation-not-authority` Presentation cannot authorize an operation or become authoritative
    examination, security, or integrity state, and color or iconography never
    communicates consequential state alone.
26. `design.accessibility` Interactive surfaces target WCAG 2.2 AA, prefer native semantics, and ship
    keyboard, focus, zoom, high-contrast, reduced-motion, and screen-reader
    behavior with their interface.
27. `design.css-ownership` CSS is co-located with its DOM owner, follows the accepted cascade, and does
    not expose another module's internal selectors as a styling seam.
28. `design.control-interface` A reusable control has a small Proctor-owned interface, caller-owned domain
    state, explicit lifecycle ownership, and deterministic explorer and test
    evidence through that interface.
29. `design.test-code-excluded` Control Explorer, fixture, baseline, and test-adapter code is unreachable
    from production AuthenticatedWindow and CandidateWindow manifests.

## Upstream

30. `upstream.evidence-not-authority` VS Code is evidence, not authority over Proctor product behavior or module
    boundaries.
31. `upstream.boundary-grill` A VS Code behavior cluster is admitted only after its Proctor workflow,
    interface, assumptions, dependency closure, competing treatments, and
    behavioral-fidelity obligations have been grilled. Product scope narrows
    through explicit exclusions; admitted behavior retains relevant upstream
    correctness, lifecycle, failure, performance, accessibility, and test
    obligations unless a stronger Proctor constraint owns a verified
    divergence.
32. `upstream.exact-provenance` Every admitted cluster records exact revisions, source blobs, dispositions,
    licenses, divergence, and verification in one canonical registry manifest.
33. `upstream.license-preservation` Applicable upstream notices and copyright headers are preserved.
34. `upstream.product-assumptions-excluded` Microsoft identity, services, endpoints, branding, telemetry, marketplace,
    and update assumptions are never inherited by source proximity.
35. `upstream.single-revision-closure` One admitted cluster and its transferred closure use one upstream commit;
    independent clusters interact through accepted Proctor interfaces.
36. `upstream.no-aggregate-entrypoints` Upstream aggregate entrypoints never select Proctor services or product
    contributions.

## Attempt Workspace

37. `workspace.stable-entry-identity` A stable Workspace Entry Reference identifies an entry across rename/move;
    its mutable case-sensitive POSIX-relative path is neither identity,
    authorization, nor a host path.
38. `workspace.opaque-content-version` A Workspace Content Version is an opaque provider token and does not imply
    retained historical reads or one server File Revision per save.
39. `workspace.acknowledged-durability` Only an authoritative acknowledgement establishes server durability;
    provider completion, events, cache, recovery, and editor cleanliness do not.
40. `workspace.distinct-states` Authoritative Workspace Snapshot, Working Workspace Overlay, protected local
    recovery/cache remain distinct states.
41. `workspace.protected-recovery` Recovery Records use privileged encrypted storage and opaque identifiers;
    the renderer receives neither raw paths nor a generic filesystem interface.
42. `workspace.provider-projection` A VS Code-compatible filesystem provider is a caller-side projection over
    the Proctor workspace module. URI possession, registration, connectivity,
    capability projection, and context keys never authorize.
43. `workspace.orthogonal-state` Content relation, mutation progress, recovery protection, availability, and
    access remain independent facts and durability language derives from them.
44. `workspace.protect-unacknowledged-work` Conflicted, rejected, uncertain, or revoked local work remains protected
    until acknowledged replacement or explicit discard.
45. `workspace.submission-readiness` Only acknowledged authoritative workspace state at a Workspace Cursor can
    become submission-ready; the workspace module never submits.
46. `workspace.exam-resources-separated` Exam Resources use a separate read-only catalog/provider and never enter
    the Working Workspace Overlay or Submission.
47. `workspace.v1-contract` The initial server adapter uses integer cursors, current whole-file reads,
    ordered refresh, idempotent results, and only create-directory,
    create-file, replace-content, move/rename, and delete mutations.

## Identity and exam security

48. `security.public-readiness` LaunchWindow consumes only safe public Institution availability and Desktop/
    protocol compatibility; internal server setup and dependency health never
    enter the client projection.
49. `security.privileged-credential-custody` Credentials, cookies, provider secrets, installation private keys, store
    handles, and authenticated transport remain privileged; renderers receive
    sanitized projections and closed intents.
50. `security.system-browser-authentication` LaunchWindow renders no authentication method or form. The server-hosted
    system-browser flow owns authentication/account choice and returns only a
    state/PKCE-bound one-use code through an exact loopback callback.
51. `security.registered-desktop-key` Each Institution uses a distinct registered Desktop key; access/refresh
    credentials and protected requests are sender-constrained to it without
    claiming official-binary attestation.
52. `security.independent-authorization` Authentication, navigation, Attempt Admission, and Operation Authorization
    remain independent, and every sensitive operation checks current authority
    against its actual resource.
53. `security.authoritative-attempt-state` Ready, active, suspended, and submitted are server-owned Attempt states;
    reallow produces ready and only successful secure join produces active.
54. `security.active-session-lock` Only active Attempt state binds one Desktop Session, revokes other Sessions,
    and blocks new Session issuance; ready, suspended, and submitted do not.
55. `security.candidate-attempt-exclusion` One candidate has at most one unresolved Attempt across all Sittings;
    competing admission never creates another unresolved Attempt.
56. `security.privileged-posture` The privileged Exam Security Coordinator owns local Secure Exam Posture;
    renderer state and authoritative Attempt `ready` never establish it.
57. `security.online-only` Candidate interaction requires continuous authenticated participation and has
    no offline editing grace; brief reconnect may retain active state only inside
    the authoritative lease. Frozen policy has no separate expiry authority.
58. `security.containment-before-presentation` Capability denial and work protection precede blocked-state presentation
    and authoritative refetch; recovery requires fresh complete gates.
59. `security.pause-suspension` Pause keeps CandidateWindow, Participation, and Session lock while blocking
    interactions; suspension protects work then returns to AuthenticatedWindow.
60. `security.fenced-participation` One fenced Attempt Participation generation is current. Stale generations
    never operate, and relaunch follows normal authenticated navigation before
    any ready join.
61. `security.integrity-vocabulary` Native Observation, Security Signal, Detector Finding, Integrity Evidence,
    Integrity Flag, Review Outcome, and Consequence remain distinct. Renderers
    receive no raw observation or evidence stream.

## Native capabilities

62. `native.passive-sources` Native packages are passive mechanical fact sources. They receive no exam
    policy or generic control command; the coordinator interprets facts and
    separate closed adapters own effects.
63. `native.initial-scope` The accepted first-release native scope includes source/permission health,
    CandidateWindow and display topology, remote interactive-session facts,
    process/application and OS-session state, private clipboard and clipboard-
    change observation, printing, removable storage, bounded virtualization and
    network configuration, camera/microphone endpoint state, content protection,
    and continuity. Each sub-capability declares enforce, observe, or unavailable
    coverage without implying global external-capture detection.
64. `native.process-boundaries` The Attempt-scoped coordinator runs in a dedicated utility process behind a
    private authenticated protocol. Electron main owns supervision, permissions,
    CandidateWindow enforcement, and fail-closed renderer projection.
65. `native.single-display-window` Candidate admission requires one verified maximized constrained
    CandidateWindow and exactly one physical usable display with no mirrored,
    virtual, remote, or specialized secondary target.
66. `native.race-free-session` Every source opens with one race-free snapshot/sequence boundary and reports
    bounded events, health, permission, gaps, and resets.
67. `native.fail-closed` Required source, process, permission, topology, protocol, or enforcement loss
    blocks interaction; restart repeats complete checks and never restores
    readiness alone.
68. `native.abnormal-loss-contained` Abnormal privileged-process loss preserves CandidateWindow containment,
    fences participation, and follows authoritative suspension/re-entry.
69. `native.packaged-conformance` A native platform claim requires packaged conformance on each declared OS/
    architecture tuple; mocks and generic Electron behavior prove no OS claim.

## User settings and Attempt Configuration

70. `settings.server-authority` The User Settings Document is one server-authoritative Principal-owned
    bounded JSONC document with an opaque revision; virtual `settings.json` is
    neither a host file nor an Attempt Workspace resource.
71. `settings.static-registry` Only the packaged Proctor registry makes a preference effective. Unknown
    keys remain inactive, prohibited keys never resolve, and remote content or
    schemas cannot register behavior.
72. `settings.no-authority` Settings personalize packaged presentation/editor behavior but never grant
    capability, authorize operations, configure security/browser/execution, or
    enter precedence from workspace/restored state.
73. `settings.authenticated-page` User Settings editing is a Session-bound page inside AuthenticatedWindow;
    Candidate preload exposes no settings source, cache, draft, or mutation.
74. `settings.frozen-attempt-configuration` The server validates and freezes one closed candidate-safe Attempt
    Configuration; re-entry uses the exact stored object rather than current
    User Settings.
75. `settings.stronger-live-constraints` Current trusted platform, accessibility, and safety constraints may
    narrow the Effective Attempt Configuration without mutating the frozen
    object or User Settings Document.
76. `settings.conditional-writes` Settings writes use expected opaque revision and idempotency key. There is
    no last-write-wins/offline queue, and protected cache never becomes authority
    or silently falls back to plaintext.

## Integrated browser

77. `browser.revision-frozen-policy` Candidate navigation uses one closed Exam Revision-frozen Browser Policy;
    only an explicit immutable live correction may change it for an open Sitting.
78. `browser.privileged-enforcement` Privileged Desktop code checks canonical top-level navigation, redirects,
    schemes, external opens, downloads, and subresource containment; renderer
    state and a displayed URL never authorize navigation.
79. `browser.minimized-activity` Browser Activity records only browser lifecycle and top-level navigation/
    redirect/blocked attempts with sensitive URL components removed; allowed
    activity is not Integrity Evidence.
80. `browser.ordered-delivery` Activity uses source-instance monotonic sequences, encrypted protected
    spooling, at-least-once idempotent delivery, exact content receipts distinct
    from settlement, terminal gaps, and exact Attempt-manager-plus-action access.

## Toolchain and release

81. `toolchain.single-esm-graph` Desktop TypeScript uses one private locked npm graph, strict NodeNext ESM,
    independent no-emit type/runtime checks, and esbuild as its application
    emitter/bundler. Source layers are not packages.
82. `toolchain.closed-packages` Production processes and windows enter through closed Proctor-owned manifests;
    inventory, fuses, ASAR integrity, signing, and tests prove the artifact.
83. `toolchain.native-schema-authority` Native protocols have one language-neutral schema authority, generated
    TypeScript/Rust views, runtime validation, bounds, and target-bound artifacts.
84. `toolchain.signed-capability-matrix` Secure-candidate support exists only for tuples proven on packaged target-
    native artifacts and named in the signed capability matrix.
85. `toolchain.central-distribution` Central Proctor distribution owns signed installers/update feeds;
    Institution servers publish compatibility and build-revocation policy only.
86. `toolchain.attempt-safe-updates` Updates never stage during active/paused participation and never install,
    restart, or downgrade while CandidateWindow or unresolved continuity exists.
