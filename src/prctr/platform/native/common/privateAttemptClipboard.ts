export const MAX_PRIVATE_CLIPBOARD_BYTES = 1_048_576;

export type CandidateClipboardMode = 'private_attempt' | 'disabled';
export type CandidateClipboardWriteResult = 'stored' | 'disabled';

export type PrivateAttemptClipboardErrorCode =
  | 'clipboard_disposed'
  | 'clipboard_payload_too_large';

export class PrivateAttemptClipboardError extends Error {
  readonly code: PrivateAttemptClipboardErrorCode;

  constructor(code: PrivateAttemptClipboardErrorCode) {
    super(code);
    this.name = 'PrivateAttemptClipboardError';
    this.code = code;
  }
}

function encodeBoundedUtf8(value: string, maximum: number): Uint8Array | undefined {
  let length = 0;
  for (const character of value) {
    length += encodedLength(normalizedCodePoint(character));
    if (length > maximum) return undefined;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const character of value) {
    const codePoint = normalizedCodePoint(character);
    if (codePoint <= 0x7F) {
      bytes[offset++] = codePoint;
    } else if (codePoint <= 0x7FF) {
      bytes[offset++] = 0xC0 | (codePoint >> 6);
      bytes[offset++] = 0x80 | (codePoint & 0x3F);
    } else if (codePoint <= 0xFFFF) {
      bytes[offset++] = 0xE0 | (codePoint >> 12);
      bytes[offset++] = 0x80 | ((codePoint >> 6) & 0x3F);
      bytes[offset++] = 0x80 | (codePoint & 0x3F);
    } else {
      bytes[offset++] = 0xF0 | (codePoint >> 18);
      bytes[offset++] = 0x80 | ((codePoint >> 12) & 0x3F);
      bytes[offset++] = 0x80 | ((codePoint >> 6) & 0x3F);
      bytes[offset++] = 0x80 | (codePoint & 0x3F);
    }
  }
  return bytes;
}

function decodeUtf8(bytes: Uint8Array): string {
  const characters: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const first = bytes[offset++] ?? 0;
    if (first <= 0x7F) {
      characters.push(String.fromCodePoint(first));
    } else if (first <= 0xDF) {
      const second = bytes[offset++] ?? 0;
      characters.push(String.fromCodePoint(((first & 0x1F) << 6) | (second & 0x3F)));
    } else if (first <= 0xEF) {
      const second = bytes[offset++] ?? 0;
      const third = bytes[offset++] ?? 0;
      characters.push(String.fromCodePoint(
        ((first & 0x0F) << 12) | ((second & 0x3F) << 6) | (third & 0x3F)
      ));
    } else {
      const second = bytes[offset++] ?? 0;
      const third = bytes[offset++] ?? 0;
      const fourth = bytes[offset++] ?? 0;
      characters.push(String.fromCodePoint(
        ((first & 0x07) << 18) | ((second & 0x3F) << 12)
          | ((third & 0x3F) << 6) | (fourth & 0x3F)
      ));
    }
  }
  return characters.join('');
}

function normalizedCodePoint(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0xFFFD;
  return codePoint >= 0xD800 && codePoint <= 0xDFFF ? 0xFFFD : codePoint;
}

function encodedLength(codePoint: number): number {
  if (codePoint <= 0x7F) return 1;
  if (codePoint <= 0x7FF) return 2;
  if (codePoint <= 0xFFFF) return 3;
  return 4;
}

/**
 * CandidateWindow-only clipboard storage. This module deliberately has no host
 * clipboard adapter and retains only a bounded UTF-8 buffer owned by this
 * instance.
 */
export class PrivateAttemptClipboard {
  readonly #mode: CandidateClipboardMode;
  #bytes: Uint8Array | undefined;
  #disposed = false;

  constructor(mode: CandidateClipboardMode) {
    this.#mode = mode;
  }

  get mode(): CandidateClipboardMode {
    return this.#mode;
  }

  get retainedByteLength(): number {
    return this.#bytes?.byteLength ?? 0;
  }

  writeText(value: string): CandidateClipboardWriteResult {
    this.#assertActive();
    if (this.#mode === 'disabled') return 'disabled';

    const encoded = encodeBoundedUtf8(value, MAX_PRIVATE_CLIPBOARD_BYTES);
    if (encoded === undefined) {
      throw new PrivateAttemptClipboardError('clipboard_payload_too_large');
    }
    this.#eraseBuffer();
    this.#bytes = encoded;
    return 'stored';
  }

  readText(): string | undefined {
    this.#assertActive();
    if (this.#mode === 'disabled' || this.#bytes === undefined) return undefined;
    return decodeUtf8(this.#bytes);
  }

  clear(): void {
    this.#assertActive();
    this.#eraseBuffer();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#eraseBuffer();
  }

  #assertActive(): void {
    if (this.#disposed) throw new PrivateAttemptClipboardError('clipboard_disposed');
  }

  #eraseBuffer(): void {
    this.#bytes?.fill(0);
    this.#bytes = undefined;
  }
}
