# Server contract conventions

These aliases describe wire validation, not unrestricted Go/TypeScript aliases:

```typescript
type ID = string; // Existing server canonical domain ID, where one exists.
type OpaqueID = string; // ASCII [A-Za-z0-9][A-Za-z0-9._:-]{0,127}.
type SHA256 = string; // ^sha256:[0-9a-f]{64}$.
type RegistryFingerprint = string; // ^fnv1a64:[0-9a-f]{16}$; non-security identity.
type Revision = string; // Opaque comparison-only token, <=128 ASCII bytes.
type SafeInt = number; // Integer in [0, 9007199254740991].
type PositiveInt = number; // Integer in [1, 9007199254740991].
type Instant = string; // Existing RFC3339 UTC server timestamp convention.
type NativeMode = 'disabled' | 'observe' | 'enforce';
type CandidateCapability = 'browser' | 'submission' | 'terminal' | 'workspace';
```

All objects are closed: reject unknown and duplicate members at every depth.
Arrays are bounded and duplicate-free where they represent sets. Required
booleans are explicit; omission is not false. Optional members are omitted,
except where a type expressly permits null. Parse UTF-8 strictly. Reject unsafe
integer values rather than rounding them in either language. Client occurrence
times are provenance; database time decides expiry, authorization, and leases.

Use SHA-256 for policy/configuration/command identities. The FNV registry
fingerprint is only a packaged parity selector and is never an authenticity
proof. Its acceptance is additionally fenced by the verified release catalog.

For new canonical JSON documents, require UTF-8 JSON with recursively sorted
ASCII property names, no insignificant whitespace, preserved array order,
ordinary JSON string escaping, and decimal integer numbers. Strings retain
their exact Unicode scalar sequence; no normalization occurs during hashing.
Reject lone surrogates and fractional/exponent representations of integer
fields before canonicalization. JSON string serialization must match
`JSON.stringify` for valid scalar strings; Go's HTML escaping must be disabled.
Hash the exact canonical bytes. The `digest` member, signatures, and transport
metadata are outside the object being hashed. Ship shared byte-and-hash fixtures,
including non-ASCII strings, HTML-sensitive characters, and escapes. Replace
superseded codecs and their fixtures with this single canonical representation.

Protected routes use existing registered Desktop Session/DPoP authorization.
The authenticated Principal owns User, Institution, Session, and registration
identity. Repeated identity fields are consistency assertions, never selection
or delegation authority. Keep credentials out of URLs, response examples,
audit, ordinary logs, and renderer projections. A DPoP proof is not a claim of
binary attestation or, by itself, a signature over an arbitrary request body.

Contract route paths are relative to the server's existing API root. Replace the
current HTTP/realtime DTOs, validators, handlers, OpenAPI definitions, and Desktop
adapters together. Do not introduce parallel routes or a negotiation mechanism
for the replaced contract. Exact verified-build admission remains a security
requirement. Transport mappings must preserve the operation semantics documented here.

## Canonical byte fixtures

The format is JSON.stringify-compatible canonical bytes; disabling Go HTML escaping
alone is insufficient. Shared fixtures must include actual U+2028/U+2029 scalars,
non-ASCII scalar strings, `<>&`, quotes, slashes/backslashes, nested key ordering,
array order, duplicate keys, invalid UTF-8, lone surrogates, safe-integer bounds,
and integer exponent/fraction spellings. Follow the lexical rejection
of fractional/exponent representations for integer fields. Normalize negative
zero to canonical zero wherever zero is a valid integer; reject it where the
field requires a positive value. Compare exact UTF-8 bytes and SHA-256 hashes.
Do not maintain separate acceptable Go and Desktop serializations.
