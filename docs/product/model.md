# Product model

This is the canonical desktop-facing subset of Proctor's product language. Add
terms when a real desktop workflow needs them; do not mirror the entire server
model preemptively.

Versioned Proctor Server contracts govern transferred data while this document
governs the language used in the Desktop codebase. A server implementation or
wire name does not silently change these accepted product relationships.

## System

**Proctor Server**

The authoritative application server for durable product state,
authorization, examination coordination, and submission records.

_Avoid_: Backend helper, desktop database

**Desktop Client**

The installed Proctor application that presents local workflows and mediates
trusted operating-system capabilities. It is a client of the Proctor Server.

_Avoid_: Server, source of truth

**Institution**

The organization represented by one Proctor Server installation. Its public
display identity helps a User confirm where they are signing in; it is not a
server-health or authorization statement.

_Avoid_: Tenant, server setup state

**Proctor Server Origin**

The normalized, verified HTTP origin for one self-hosted Proctor installation.
The desktop pins it for public readiness, authorization, and the resulting
Session; an arbitrary URL, redirect target, or upstream identity-provider origin
is not a Proctor Server Origin.

_Avoid_: Tenant, provider URL, arbitrary backend URL

**Desktop Authorization**

The short-lived transaction through which the Desktop Client starts one
server-hosted authentication flow in the system browser and exchanges one
server-issued code with the pinned Proctor Server using state, PKCE, a
registered installation key, and an exact loopback callback. The server-hosted
page owns the available local or external method, account choice, and explicit
approval. The transaction is not the User's later Session or an upstream
provider token.

_Avoid_: Desktop login form, embedded-browser authentication, Session

**Desktop Installation**

One Institution-specific registered public key whose private key is held by the
privileged Desktop through an approved operating-system store. Proof from that
key sender-constrains Desktop credentials and requests. It establishes a
registered Desktop key, not that an untampered official binary is running.

_Avoid_: Device fingerprint, hardware identity, binary attestation

**LaunchWindow**

The signed-out window for selecting and safely describing one Proctor Server,
checking compatibility and availability, and starting Desktop Authorization.
It contains no authentication method or credential form.

_Avoid_: Login window, setup-status console

**AuthenticatedWindow**

The normal signed-in application window. It presents the currently authorized
student, teacher/Exam Manager, administration, account, and settings areas
without turning Role names or navigation state into authority.

_Avoid_: ProctorWindow, role window, SettingsWindow

**CandidateWindow**

The constrained window used only while securely participating in one Exam
Attempt. Opening it closes the AuthenticatedWindow. Application relaunch never
restores it directly; re-entry starts from normal authenticated navigation.

_Avoid_: Candidate role, ordinary student home, restored exam window

**Principal**

The authenticated security identity acting in an operation, including its
credential and authentication context.

_Avoid_: User when authentication context matters

**User Settings Document**

One server-authoritative, Principal-owned JSONC document containing portable
approved IDE and presentation preferences. `settings.json` is its virtual
user-facing representation rather than a host file or Attempt Workspace
resource.

_Avoid_: Workspace settings, local settings file, security policy

**Attempt Configuration**

The closed, candidate-safe configuration derived by the Desktop from its
packaged registry, the User Settings Document, and authoritative constraints,
then validated and frozen by the Proctor Server for one Exam Attempt. Re-entry
uses the exact stored configuration; stronger current accessibility or safety
constraints may only narrow its effective projection.

_Avoid_: Candidate Settings Baseline, current user settings, arbitrary editor
configuration

## Examination work

**Exam**

A reusable authored assessment containing material and configuration that may
be delivered through one or more exam sittings.

_Avoid_: Exam Sitting, exam session

**Exam Revision**

An immutable published generation of an exam's authored content and delivery
configuration.

_Avoid_: Exam Sitting, draft edit

**Exam Sitting**

A scheduled delivery of an exam to a defined eligible population.

_Avoid_: Exam Revision, exam session

**Exam Attempt**

One student's private, durable body of work while participating in an exam; its
acknowledged work survives interruption and submission.

_Avoid_: Exam session, workspace

Its lifecycle states are `ready`, `active`, `suspended`, and `submitted`.
`ready` means a manager has reallowed a suspended Attempt but a successful
secure join has not yet made it active. Only active state carries one bound
Desktop Session and current Attempt Participation generation.

**Attempt Workspace**

The isolated, remote-first collection of working files belonging to one exam
attempt. It may contain source code, project configuration, permitted assets,
and generated or other permitted files; it is not an arbitrary local folder.

_Avoid_: Shared workspace, arbitrary local folder

**Workspace File**

A file in one Attempt Workspace. The desktop identifies it independently of its
mutable Workspace Path and uses an opaque provider-issued content version for
acknowledgement and conflict checks. That token does not imply that the server
creates a retained File Revision for every save.

_Avoid_: Local file, File Revision

**Workspace Path**

The normalized, case-sensitive POSIX-relative location of an entry within one
Attempt Workspace. It is mutable hierarchy metadata rather than identity,
authorization, or a host filesystem path.

_Avoid_: Local path, remote-VM path

**Acknowledged Workspace State**

Attempt Workspace state the Proctor Server has confirmed durable. Protected
local recovery and a clean-looking editor do not establish acknowledgement.

_Avoid_: Local backup, cached workspace

**Exam Resource**

A read-only file deliberately made available to students to explain or support
an exam, such as a PDF, image, or Markdown document. It belongs to the delivered
exam material, not the student's Attempt Workspace.

_Avoid_: Arbitrary attachment

**Submission**

A sealed manifest of the exact acknowledged Attempt Workspace state presented
for grading at one submission point. The server chooses how that state maps to
its File Entry, File Revision, and other persistence models.

_Avoid_: Exam Attempt, copied folder

**Secure Exam Posture**

The privileged desktop assessment of whether current authenticated policy,
connectivity, monitoring, and controls permit candidate interaction. Its local
lifecycle is uninitialized, checking, compliant, degraded, contained, failed,
or stopped and is independent of authoritative Exam Attempt state,
authentication, and guilt.

_Avoid_: Login state, renderer context key, cheating verdict

**Exam Security Policy**

The canonical server-frozen effective envelope for one Exam Attempt. It combines
the Exam Revision's declared rules with resolved accommodations and exceptions,
selects only packaged Desktop capability identifiers and bounded configuration,
and is bound to a digest used by preflight and integrity delivery. The Desktop
evaluates it but does not author, weaken, or resolve it.

_Avoid_: User Settings, renderer configuration, local exception

**Attempt Participation**

One continuous, server-recognized candidate desktop participation in an Exam
Attempt. It has a fenced generation so an authorized later participation cannot
be confused with a stale or terminated client process.

_Avoid_: Exam Attempt, Session, application window

**Participation Interruption**

A local period in which required privileged client continuity is uncertain or
lost. Brief transport recovery inside the server Participation lease may retain
the active generation; confirmed lease, policy, or bound-Session loss causes
the server to suspend the Attempt. It is never submission, an Integrity Flag,
or guilt.

_Avoid_: Automatic cheating violation, ordinary logout

**Execution Environment**

The isolated remote environment that projects acknowledged Attempt Workspace
state and hosts the candidate's permitted execution. The integrated terminal
attaches to its remote PTY; its filesystem is not a second Workspace authority.

_Avoid_: Local shell, Attempt Workspace, terminal window

**Browser Policy**

The Exam Revision-frozen allowlist and navigation rules enforced by the
privileged integrated Candidate browser. Only an explicit immutable live
correction may change it for an open Sitting.

_Avoid_: User browser settings, arbitrary URL filter

**Browser Activity**

The minimized, ordered record of integrated-browser open/close and top-level
navigation, redirect, or blocked-navigation events for one Attempt. It excludes
subresources, page content, cookies, headers, and general system-browser
history. Allowed activity is not Integrity Evidence.

_Avoid_: Browser history, web content, Integrity Flag

**Native Observation**

A bounded mechanical fact reported by a privileged operating-system capability,
including its source, sequence, time, schema, and known gaps. It is an input to
security evaluation rather than a conclusion about candidate conduct.

_Avoid_: Integrity Flag, cheating event

**Security Signal**

A normalized policy input derived from one or more observations, source-health
facts, connectivity facts, or other trusted state.

_Avoid_: Raw native event, guilt

**Detector Finding**

A versioned rule result derived from identified signals with its uncertainty
and gaps preserved. It may support containment or server review but is not an
Integrity Flag or consequence by itself.

_Avoid_: Cheating verdict

**Integrity Evidence**

Minimized, purpose-specific material retained to support an Integrity Flag or
authorized review. It has stricter access and retention than ordinary audit or
diagnostic data.

_Avoid_: Security audit record, application log

**Integrity Flag**

A recorded indication of suspected examination-rule violation. It is evidence
for review, not a finding of guilt.

_Avoid_: Cheating verdict, automatic violation

## Relationship rules

- A Desktop Client acts for an authenticated Principal.
- An Exam Sitting delivers one Exam Revision.
- An Exam Attempt belongs to one student and one Exam Sitting.
- An Attempt Workspace belongs to one Exam Attempt.
- An Attempt Workspace is identified independently of any local or remote host
  filesystem path.
- A Workspace File keeps its identity when its Workspace Path changes.
- A Submission seals identified, acknowledged workspace state; it is not merely
  a copy of whichever files happen to be present locally.
- One Exam Attempt may have more than one sequential Attempt Participation after
  successful secure joins from ready, but never more than one current generation.
- One candidate may have at most one unresolved Exam Attempt (`ready`, `active`,
  or `suspended`) across all Exam Sittings.
- A current student cannot simultaneously hold current teacher/staff,
  Academic Unit membership, Role Binding, Exam Manager, or system-administrator
  relationships. Those non-student responsibilities may overlap with each
  other. Historical ended relationships do not conflict.
- Disabled account, no current affiliation, and no assigned access are distinct
  states.
- A Participation Interruption never establishes guilt or submission; confirmed
  continuity loss is represented by authoritative Attempt suspension.
- Native Observations may become Security Signals and Detector Findings before
  minimized material becomes Integrity Evidence.
- An Integrity Flag records evidence and never determines guilt by itself.
