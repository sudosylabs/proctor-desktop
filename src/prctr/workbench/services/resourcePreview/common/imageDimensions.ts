const ascii = (bytes: Uint8Array, offset: number, value: string): boolean =>
	value.length + offset <= bytes.byteLength &&
	[...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
	signature.length <= bytes.byteLength &&
	signature.every((value, index) => bytes[index] === value);

function hasAvifBrand(bytes: Uint8Array): boolean {
	if (bytes.byteLength < 16 || !ascii(bytes, 4, 'ftyp')) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let headerLength = 8;
	let boxLength = view.getUint32(0);
	if (boxLength === 1) {
		if (bytes.byteLength < 24 || view.getUint32(8) !== 0) return false;
		headerLength = 16;
		boxLength = view.getUint32(12);
	} else if (boxLength === 0) {
		boxLength = bytes.byteLength;
	}
	if (boxLength < headerLength + 8 || boxLength > bytes.byteLength) return false;
	if (ascii(bytes, headerLength, 'avif') || ascii(bytes, headerLength, 'avis')) return true;
	for (let offset = headerLength + 8; offset + 4 <= boxLength; offset += 4) {
		if (ascii(bytes, offset, 'avif') || ascii(bytes, offset, 'avis')) return true;
	}
	return false;
}

/** Reject a declared media type that does not match the image container signature. */
export function matchesPreviewImageMediaType(bytes: Uint8Array, mediaType: string): boolean {
	switch (mediaType) {
		case 'image/png':
			return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		case 'image/jpeg':
			return startsWith(bytes, [0xff, 0xd8, 0xff]);
		case 'image/gif':
			return ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a');
		case 'image/bmp':
		case 'image/x-ms-bmp':
			return ascii(bytes, 0, 'BM');
		case 'image/x-icon':
		case 'image/vnd.microsoft.icon':
			return startsWith(bytes, [0x00, 0x00, 0x01, 0x00]);
		case 'image/webp':
			return ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP');
		case 'image/avif':
			return hasAvifBrand(bytes);
		default:
			return false;
	}
}

/** Bound the bitmap that Chromium decoded before it can enter the preview host. */
export function isPreviewImageDimensionAllowed(width: number, height: number): boolean {
	return (
		Number.isFinite(width) &&
		Number.isFinite(height) &&
		width > 0 &&
		height > 0 &&
		width <= 16384 &&
		height <= 16384 &&
		width * height <= 16 * 1024 * 1024
	);
}
