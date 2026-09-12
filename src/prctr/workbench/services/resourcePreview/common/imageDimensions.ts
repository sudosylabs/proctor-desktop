import { imageSize } from 'image-size';

const formats: Readonly<Record<string, readonly string[]>> = {
	'image/png': ['png'],
	'image/jpeg': ['jpg'],
	'image/gif': ['gif'],
	'image/bmp': ['bmp'],
	'image/x-ms-bmp': ['bmp'],
	'image/x-icon': ['ico'],
	'image/vnd.microsoft.icon': ['ico'],
	'image/webp': ['webp'],
	'image/avif': ['avif', 'heif'],
	'image/svg+xml': ['svg']
};

/** All formats selected by VS Code's image preview, bounded before native decode. */
export function validatePreviewImage(
	bytes: Uint8Array,
	mediaType: string
): { width: number; height: number } {
	const expectedTypes = formats[mediaType];
	if (!expectedTypes) {
		throw new Error('Unsupported image type');
	}
	if (bytes.byteLength < 6 || bytes.byteLength > 20 * 1024 * 1024) {
		throw new Error('Invalid image size');
	}
	let metadata;
	try {
		metadata = imageSize(bytes);
	} catch {
		throw new Error('Invalid image metadata');
	}
	if (!metadata.type || !expectedTypes.includes(metadata.type)) {
		throw new Error('Image type does not match content');
	}
	for (const size of [metadata, ...(metadata.images ?? [])]) {
		if (
			!Number.isFinite(size.width) ||
			!Number.isFinite(size.height) ||
			size.width <= 0 ||
			size.height <= 0 ||
			size.width > 16384 ||
			size.height > 16384 ||
			size.width * size.height > 16 * 1024 * 1024
		) {
			throw new Error('Image dimensions exceed preview limits');
		}
	}
	return { width: metadata.width, height: metadata.height };
}
