# Attempt Configuration contract

The accepted wire contract uses the [shared conventions](conventions.md).
[Contract map and implementation status](README.md) separate agreement from availability.

## Derived and frozen model

Desktop derives the closed Candidate-safe subset from the server-stored
User Settings source using its packaged registry and runtime constraints. The
server validates and freezes it; derivation grants no permission. Whole-source
User Settings persistence remains a separate existing contract.

```typescript
interface AttemptConfigurationCandidate {
  manifest_fingerprint: SHA256;
  registry_fingerprint: RegistryFingerprint;
  desktop_build: OpaqueID;
  desktop_target: OpaqueID;
  user_settings_revision: Revision;
  presentation: {
    color_theme: 'light' | 'dark' | 'hcLight' | 'hcDark';
    prefer_high_contrast: boolean;
    zoom_percent: number; // Integer 80..200; default 100.
    editor_font_size_px: number; // Integer 12..24; default 14.
    editor_line_height_px: number; // Integer 16..40; default 22.
    reduced_motion: boolean;
    screen_reader_mode: 'auto' | 'on' | 'off';
    announcement_mode: 'auto' | 'verbose' | 'minimal';
    cursor_style: 'line' | 'block' | 'underline';
    cursor_blinking: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';
  };
  approved_commands: OpaqueID[]; // 0..128; sorted unique approved catalog IDs.
  approved_keybindings: OpaqueID[]; // 0..128; sorted unique approved catalog IDs.
}
interface FrozenAttemptConfiguration extends AttemptConfigurationCandidate {
  attempt_configuration_revision: Revision;
  digest: SHA256;
}
```

The font/line-height limits above intentionally match the current packaged
Desktop subset. Pixel line height is independent of font size; validate it
against its own bound without silently interpreting it as a percentage. Preserve
explicit high-contrast themes, booleans, and announcement/cursor modes without
lossy tri-state conversion. Stronger runtime accessibility constraints still
narrow only the effective projection, not the frozen source.

`desktop_build` is the verified Desktop build ID and `desktop_target` the exact
catalog target tuple; compare both with the registered Session/build admission.
`registry_fingerprint` is the exact packaged FNV identity, for example
`fnv1a64:35ec2f0722dc930e`. A specific example value is not the contract. Extend the build catalog's registry fingerprint
validation to this explicit type; retain separate SHA-256 digests for the
verified artifact, configuration manifest, and frozen document. Replacing the
prefix of an FNV value with sha256 is not a conversion.

The configuration manifest remains server-admitted immutable agreement data.
Its fingerprint covers this schema, bounds, enum meanings, and the exact
release-owned command/keybinding catalog. Desktop packaging supplies the same
catalog data; an end-user request cannot introduce an identifier or key chord.
Each keybinding catalog entry identifies its associated command; selected
keybindings must resolve to selected commands, and command IDs must belong to
Candidate-safe contributions. Empty arrays remain valid when a release has no
approved entries. Do not admit all syntactically valid strings merely to avoid
the current empty-catalog rejection.

Raw key expressions and arbitrary commands are not approved catalog IDs.

## Freeze, digest, and re-entry

Bound the candidate/frozen configuration at 16 KiB canonical bytes. At first
admission, recheck the acknowledged user_settings_revision in the existing
atomic Connect transaction, validate the complete object against verified
build/manifest and authoritative constraints, then store the exact normalized
candidate object. Reject out-of-bounds values; return a typed compatibility or
constraint result instead of silently changing the candidate's proposal.

Create one opaque attempt_configuration_revision on first successful freeze.
The digest hashes the complete candidate object, including registry identity,
build/target, and source revision provenance, excluding the server-created
revision/digest fields. Replace the previous semantic-only digest implementation
and fixtures. There is one stored representation and one hashing rule.

On retry/rejoin, return the exact frozen object through the owning privileged
Desktop preflight/security-bootstrap response. Do not reconstruct it from current
settings or substitute current build metadata for the original provenance. The
normal candidate renderer receives only effective presentation, approved IDs,
and its configuration revision/digest; the privileged adapter retains provenance.
Manager endpoints, audit, and generic realtime hints must not expose the User
Settings revision or the full preference object.

Keep the server's existing ability to admit a later verified build that can
reproduce the frozen manifest. Original build/target are provenance, while the
current build's exact current manifest identity decides reproducibility.
Compare current manifest compatibility, not equality with original build/target
provenance; a compatible patched build may re-enter.
An unrecognized manifest or malformed current object fails re-entry rather than
rewriting the frozen object. Recreate incompatible development Attempts when
replacing the model; retain no adapter for the previous representation.

## Example first-admission presentation

This is the exact presentation portion that a default Desktop derives; it is
not a replacement User Settings document:

```json
{
  "color_theme": "dark",
  "prefer_high_contrast": false,
  "zoom_percent": 100,
  "editor_font_size_px": 14,
  "editor_line_height_px": 22,
  "reduced_motion": false,
  "screen_reader_mode": "auto",
  "announcement_mode": "auto",
  "cursor_style": "line",
  "cursor_blinking": "blink"
}
```

## Acceptance tests

- Exact cross-language byte/hash fixtures, default presentation, all enum values,
  boundary fonts/line heights, explicit high-contrast theme, and unknown fields.
- Real FNV registry selector is accepted only for its verified release tuple;
  unregistered/colliding/mismatched manifest or build never grants capability.
- All five cursor modes roundtrip. Pixel line height never changes unit.
- Every selected command/keybinding must exist in the same packaged catalog;
  raw chords, unknown IDs, invalid pairs, duplicate IDs, and oversized lists fail.
- Initial source revision changes during join cause conflict; exact retries
  reuse one frozen revision/digest; rejoin ignores newer User Settings.
- Compatible patched build retains original provenance and exact values;
  an unrecognized manifest blocks without rewriting. Previous object shapes and
  semantic-only digest fixtures are removed.
- Renderer projection, logs, audit, and manager endpoints keep settings source
  and configuration provenance out of unauthorized surfaces.
