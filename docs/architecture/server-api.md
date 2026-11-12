# Shared server API client

All Proctor Server HTTP I/O goes through the privileged `ServerHttpTransport`.
One authenticated Session owns one `SessionApi`: typed operations from the
packaged contract, the Session's read cache (`SessionReads`) and its live
server events (`ServerEvents`). The Session owner signs every request through
`SessionRequestSigner`; no other module holds a credential, and none reaches a
renderer.

## Contract and regeneration

`resources/server-api/openapi.json` is the pinned server contract. The
`server.api` generator produces operation and DTO types, a runtime contract and
a method/path coverage inventory. The runtime contract carries only what Desktop
executes: each operation's route, authentication, idempotency, resolved
parameters, request media, success responses and accepted media types, plus the
named schemas, with prose removed. `serverContract.ts` compiles each schema's
validator once, on first use. Requests are held to the exact schema; responses
tolerate additive fields. Operations whose JSON is canonical or signed are named
in `strictIntegerOperations`, never matched by path.

Use `npm run api:sync -- <server-openapi.json> [server-revision]` to import a new
contract without modifying the server checkout. Review the snapshot, generated
inventory, type errors and contract tests together. `npm run check:generated`
detects stale generated outputs. The installed application uses only packaged
artifacts and never reads a server checkout or downloads schemas.

## Requests and failures

A privileged capability names an operation ID with its generated parameters and
body; it never builds a URL. `requestEncoding.ts` validates and encodes the
request, keeps it on the pinned origin and refuses caller-supplied credential
headers. `responseDecoding.ts` checks the declared status and media type, and
parses JSON strictly. Request deadlines, response byte limits, cancellation and
origin checks apply before anything is published. Redirects, ambient cookies
and the HTTP cache are disabled.

`ServerApiError` separates server Problem Details from network, timeout,
cancellation, invalid request or response, blocked redirect and ended-session
failures. Its message names only the kind and status, never credentials, bodies
or the underlying exception. Each capability maps a failure to its own closed
renderer reason in one function.

`SessionRequestSigner` gives every send a fresh DPoP proof and answers a nonce
challenge once. It refreshes access through the single-flight refresh before
expiry, and once more on `invalid_token`. A credential still refused ends the
Session there, so no capability signs out on its own. Refresh rotation keeps its
ambiguous-outcome barrier. Changes are sent once; an uncertain outcome belongs
to the domain's idempotency or reconciliation flow.

## Reads

Each capability service (Account, Administration, Exam Activity, settings) takes
a small port from the Session owner and reads through `SessionReads` under its
own key. A read throws its failure, so the cache retries only transient reads,
honouring Retry-After. `invalidate()` fences reads after a change. `refresh()`
is the coalesced hint an event gives: reads in flight finish, then the observed
reads re-read once. Electron main owns the polling timers, which run only while
a read is observed and the Session is online and focused. Session teardown
aborts requests, closes events and clears the cache, which is never persisted.

Renderers observe a closed capability intent through
`CapabilityObservationChannel`. Every answer is authorized again for the frame
that started the observation, and a destroyed window's observations end
immediately. No renderer can name an operation, URL, credential, query key or
another account.

## Realtime

`ServerEvents` holds one connection per Session. It opens when something
subscribes, closes when nothing needs it, and reconnects with bounded, jittered
backoff. It pauses while offline and stops for good when the Session ends or
refuses the upgrade. Every inbound frame is parsed strictly and checked as an
envelope; frames, pending commands, subscriptions and the pre-hello buffer are
bounded.

A consumer subscribes to a typed event from `serverEventCatalog.ts`. A user
event needs no scope; a resource event names its resource, and the server
authorizes it. Subscriptions are reference-counted and restored after a fresh
reconnect. The client resumes from its checkpoint when the server can replay.
Otherwise, after a gap, `resync_required` or an unreadable event, it reports lost
continuity once, after subscriptions are back. `SessionApi` then refreshes every
observed read. A listener's error never affects another listener or the
connection. Events only hint: they never grant access or complete a transition.

The catalog is provisional and hand-written from the server's event
constructors. Its validators read only the fields Desktop uses and ignore the
rest. It is to be replaced by types generated from the server's realtime
schemas.

The Attempt owner sends commands through its `ServerCommandChannel`. A command
is sent once and never replayed: a lost reply settles `unconfirmed`. After lost
continuity the channel refuses commands until its holder re-reads authoritative
state and calls `resynchronized()`. Reconnecting never reopens an Attempt or
grants participation.
