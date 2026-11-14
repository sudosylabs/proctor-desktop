# Desktop/server contract

These references own the accepted Desktop/server wire models, canonical bytes,
operation mappings, limits, and failure outcomes. They describe one current
contract. Replace superseded development models and fixtures; use plain model
names and one codec per concern. Data revisions, Participation generations,
and artifact identities retain their concurrency and provenance meanings.

Load the relevant branch before implementing or reviewing an adapter, server
agreement fixture, admission path, or protected delivery boundary:

| Concern                                                                                             | Contract owner                                    |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Shared aliases, closed objects, authentication, canonical JSON and hashes                           | [Conventions](conventions.md)                     |
| Authored native families, compiled rules, screen recording, certification and lease-based authority | [Security policy](security-policy.md)             |
| Readiness overview, preflight, atomic Connect, security control, renewal and native containment     | [Secure participation](secure-participation.md)   |
| Native records, server evaluation, receipts, gaps, closure, quotas, metadata and screen clips       | [Protected delivery](protected-delivery.md)       |
| Desktop derivation, server freeze, exact provenance and compatible-build re-entry                   | [Attempt Configuration](attempt-configuration.md) |
| Rule specificity, canonical paths, browser sources, grouped evidence, access and retention          | [Browser](browser.md)                             |
| Minimum affected capabilities, transactional gates and oldest-first acknowledgement                 | [Live corrections](live-corrections.md)           |

TypeScript blocks are wire-model notation with cross-file references. They are
not generated production codecs. Runtime validation includes the textual bounds
and cross-field invariants, including those that TypeScript aliases cannot express.
Paths are relative to the server's existing API root; server source paths identify
server-owned implementation seams, not local runtime dependencies.

Architecture documents own process and product boundaries and link here for the
exact contract. [Project status](../project/status.md#server-integration-baseline)
owns implementation progress. Agreement does not claim that an endpoint, Desktop
adapter, or signed native certification is available.

Initial security resolution uses published selections, the release baseline
rules, verified certification/catalogs, and existing admission/revocation fences. Institution
restriction inheritance, accommodations, and exception authoring/revocation are
excluded; exception references are empty. Nonempty Institution allowlists require
an authenticated catalog owner. Emergency native-policy blocking uses suspension;
selective live strengthening is excluded. Simultaneous student and teacher
affiliations remain accepted.
