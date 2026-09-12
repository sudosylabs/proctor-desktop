/** XML metadata stays inert; the original SVG is decoded only in the sandbox's img element. */
export function validateSvgForPreview(bytes: Uint8Array): void {
	if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) {
		throw new Error('Invalid SVG size');
	}
	const document = new DOMParser().parseFromString(
		new TextDecoder('utf-8', { fatal: true }).decode(bytes),
		'image/svg+xml'
	);
	const root = document.documentElement;
	if (
		root.localName !== 'svg' ||
		root.namespaceURI !== 'http://www.w3.org/2000/svg' ||
		document.querySelector('parsererror')
	) {
		throw new Error('Invalid SVG');
	}
	const svg = root as unknown as SVGSVGElement;
	const length = (value: SVGLength, fallback: number): number =>
		value.unitType === 2 ? (fallback * value.valueInSpecifiedUnits) / 100 : value.value;
	const width = root.hasAttribute('width') ? length(svg.width.baseVal, 300) : 300;
	const height = root.hasAttribute('height') ? length(svg.height.baseVal, 150) : 150;
	if (
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0 ||
		height <= 0 ||
		width > 16384 ||
		height > 16384 ||
		width * height > 16 * 1024 * 1024
	) {
		throw new Error('Image dimensions exceed preview limits');
	}
}

/** Data URLs avoid exposing a file-origin Blob URL across an opaque sandbox. */
export function previewImageData(bytes: Uint8Array, mediaType: string): string {
	const parts: string[] = [];
	for (let offset = 0; offset < bytes.length; offset += 32768) {
		parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
	}
	return `data:${mediaType};base64,${btoa(parts.join(''))}`;
}
