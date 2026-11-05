# Shared server API client

All Proctor Server HTTP I/O uses the privileged `ServerHttpTransport`. The
session-bound `ServerApiClient` owns the typed operation surface, response
validation, Query Core cache, observers and WebSocket connections. Existing
authentication lifecycle code supplies fresh proofs and credentials; it never
hands those credentials to a renderer.

## Contract and regeneration

`resources/server-api/openapi.json` is the pinned server contract. The
`server.api` generator produces operation/DTO types, a runtime contract and a
method/path coverage inventory. Shared path parameters, status-specific
responses, request media types, required fields, idempotency headers and error
schemas come from that artifact. Runtime schema validation complements static
types. Ordinary response objects tolerate additive fields; request objects and
required wire types remain checked.

Use `npm run api:sync -- <server-openapi.json> [server-revision]` to import a new
contract without modifying the server checkout. Review the snapshot, generated
inventory, type errors and contract tests together. `npm run check:generated`
detects stale generated outputs. The installed application uses only packaged
artifacts and does not read a server checkout or download schemas.

## Requests and failures

Privileged consumers select an operation ID and its generated parameters/body.
The client serializes JSON, binary and multipart requests, retains response
headers and distinguishes content from bodyless/conditional responses. Request
deadlines, response byte limits, cancellation and origin checks apply before
publication. Redirects, ambient cookies and the HTTP cache are disabled.

`ServerApiError` separates server Problem Details from network, timeout,
cancellation, invalid request/response, blocked redirect and ended-session
failures. Server codes, safe field errors and request IDs remain available to
the capability owner. Error messages never incorporate credentials, bodies or
raw transport exceptions. Renderer projections deliberately expose only the
failure information that their capability permits.

Refresh rotation retains its existing single-flight and ambiguous-outcome
rules. An explicit DPoP nonce challenge can be retried with a new proof.
Ordinary mutations are sent once; uncertain outcomes belong to the domain's
idempotency/reconciliation flow. Query Core retries only classified transient
reads. A server Retry-After delays those retries.

## Query ownership

One authenticated session owns one API client and its in-memory cache. Session
teardown aborts requests, closes connections, disposes observations and clears
the cache before a different account can use the window. A late result cannot
publish into the next session. The cache is not persisted.

Query Core owns shared reads, deduplication, freshness, garbage collection and
invalidation. Native window focus and connectivity feed the privileged owner.
Node-owned polling timers run only while an observation exists and the client
is online and focused; Query Core's browser timer assumptions are not used in
Electron main. Existing data remains visible during background refresh.
Capabilities clear restricted projections when access ends or is denied.

Account and exam activity use separate authorized observation channels. A page
subscribes to its closed intent and disposes that subscription with its content.
No renderer can select an arbitrary operation, URL, credential, query key or
different account. Settings reads/writes use the same client, while the settings
service continues to own the draft, revision fence and ambiguous-write recovery.

## Realtime and future providers

The WebSocket route has a dedicated authenticated upgrade adapter and a
session-owned realtime client. It bounds JSON envelopes and pending commands,
correlates replies by sequence, applies command and handshake deadlines, checks
ping replies, and owns cancellation and teardown. Callers explicitly opt in to
reconnection with bounded backoff and jitter. Network loss pauses reconnects;
revoked credentials and authorization failures stop them.

The realtime client tracks the server connection ID and processed event sequence.
It accepts retained events before the resume hello, detects gaps, and exposes a
sticky resynchronization requirement when continuity is lost. Domain owners
re-read authoritative state, restore subscriptions, and acknowledge that
requirement before issuing ordinary commands. Action-specific payload validation
and reconciliation of unconfirmed outcomes remain with those owners. Commands
are never replayed; reconnect never reopens an Attempt or grants participation.
Capability owners map relevant events to query-key prefixes; unrelated events do
not implicitly refresh pages. Realtime invalidations coalesce and let
in-flight reads finish before the following authoritative refresh. Mutations use
stronger cancellation fencing. Lost event continuity invalidates active queries
once and leaves domain resynchronization explicitly required. Binary downloads
preserve bytes and headers for higher-level resource validation.

Mattermost's client and WebSocket lifecycle informed the comparison: centralized
execution, reply tracking, health checks, reconnect and missed-event recovery.
This implementation uses Proctor's wire protocol and native credential boundary;
it does not import Mattermost's client, browser token storage or chat state.

A Candidate FileService provider will sit above the Attempt Workspace service,
which uses this client for server transport. Working overlays, protected
recovery, version conflicts, settlement and participation authority remain in
their existing domain owners. Query freshness never grants permission to act.
