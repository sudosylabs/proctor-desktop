import { createElementFactory } from '../../../../base/browser/documentElements.js';

/** Local import limits are separate from the server's 5 MiB upload limit. */
export const photoImportLimits = Object.freeze({
	bytes: 32 * 1024 * 1024,
	pixels: 64_000_000,
	side: 16384
});

export class PhotoImportError extends Error {
	constructor(readonly reason: 'photoInvalid' | 'photoTooLarge') {
		super(reason);
	}
}

/** Read dimensions before invoking an image decoder; never decode an unbounded source. */
export function inspectPhoto(bytes: Uint8Array): { width: number; height: number; type: string } {
	if (!bytes.length || bytes.length > photoImportLimits.bytes)
		throw new PhotoImportError('photoTooLarge');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const ascii = (offset: number, value: string): boolean =>
		[...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
	let width = 0,
		height = 0,
		type = '';
	if (bytes.length >= 24 && ascii(0, '\x89PNG\r\n\x1a\n') && ascii(12, 'IHDR')) {
		width = view.getUint32(16);
		height = view.getUint32(20);
		type = 'image/png';
	} else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
		type = 'image/jpeg';
		let offset = 2;
		while (offset + 4 <= bytes.length) {
			if (bytes[offset++] !== 0xff) break;
			while (bytes[offset] === 0xff) offset++;
			const marker = bytes[offset++];
			if (marker === undefined || marker === 0xda || marker === 0xd9) break;
			if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
			if (offset + 2 > bytes.length) break;
			const length = view.getUint16(offset);
			if (length < 2 || offset + length > bytes.length) break;
			if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
				height = view.getUint16(offset + 3);
				width = view.getUint16(offset + 5);
				break;
			}
			offset += length;
		}
	} else if (bytes.length >= 30 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
		type = 'image/webp';
		if (ascii(12, 'VP8X')) {
			// Animated sources introduce frame selection; accept static photos only.
			if ((bytes[20]! & 2) !== 0) throw new PhotoImportError('photoInvalid');
			width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
			height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
		} else if (
			ascii(12, 'VP8 ') &&
			bytes[23] === 0x9d &&
			bytes[24] === 1 &&
			bytes[25] === 0x2a
		) {
			width = view.getUint16(26, true) & 0x3fff;
			height = view.getUint16(28, true) & 0x3fff;
		} else if (ascii(12, 'VP8L') && bytes[20] === 0x2f) {
			const bits = view.getUint32(21, true);
			width = (bits & 0x3fff) + 1;
			height = ((bits >>> 14) & 0x3fff) + 1;
		}
	}
	if (!width || !height) throw new PhotoImportError('photoInvalid');
	if (
		width > photoImportLimits.side ||
		height > photoImportLimits.side ||
		width * height > photoImportLimits.pixels
	)
		throw new PhotoImportError('photoTooLarge');
	return { width, height, type };
}

export interface PhotoCrop {
	readonly x: number;
	readonly y: number;
	readonly zoom: number;
}
export function photoCropRect(width: number, height: number, crop: PhotoCrop) {
	const clamp = (n: number, low: number, high: number) =>
		Math.min(high, Math.max(low, Number.isFinite(n) ? n : low));
	const size = Math.min(width, height) / clamp(crop.zoom, 1, 4);
	return {
		x: clamp(crop.x * width - size / 2, 0, width - size),
		y: clamp(crop.y * height - size / 2, 0, height - size),
		size
	};
}

export async function decodePhoto(file: File): Promise<ImageBitmap> {
	if (!file.size || file.size > photoImportLimits.bytes)
		throw new PhotoImportError('photoTooLarge');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const metadata = inspectPhoto(bytes);
	const bitmap = await createImageBitmap(new Blob([bytes], { type: metadata.type }), {
		imageOrientation: 'from-image'
	});
	if (
		!bitmap.width ||
		!bitmap.height ||
		bitmap.width * bitmap.height > photoImportLimits.pixels ||
		bitmap.width > photoImportLimits.side ||
		bitmap.height > photoImportLimits.side
	) {
		bitmap.close();
		throw new PhotoImportError('photoTooLarge');
	}
	return bitmap;
}

export async function encodePhoto(
	document: Document,
	bitmap: ImageBitmap,
	crop: PhotoCrop
): Promise<Uint8Array> {
	const rect = photoCropRect(bitmap.width, bitmap.height, crop);
	const canvas = createElementFactory(document)('canvas');
	canvas.width = canvas.height = Math.max(1, Math.min(512, Math.floor(rect.size)));
	const context = canvas.getContext('2d');
	if (!context) throw new PhotoImportError('photoInvalid');
	context.drawImage(
		bitmap,
		rect.x,
		rect.y,
		rect.size,
		rect.size,
		0,
		0,
		canvas.width,
		canvas.height
	);
	const blob = await new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(value) => (value ? resolve(value) : reject(new PhotoImportError('photoInvalid'))),
			'image/png'
		)
	);
	return new Uint8Array(await blob.arrayBuffer());
}
