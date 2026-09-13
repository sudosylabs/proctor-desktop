/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	isPreviewImageDimensionAllowed,
	matchesPreviewImageMediaType
} from '../common/imageDimensions.js';

// This entrypoint is bundled as a fixed application asset. Potentially hostile
// decoders never execute on the workbench thread; its owner terminates this worker.
self.onmessage = async (event: MessageEvent<unknown>): Promise<void> => {
	const input = event.data;
	let valid = false;
	let bitmap: ImageBitmap | undefined;
	try {
		if (!input || typeof input !== 'object') throw new Error('Invalid request');
		const { bytes, mediaType } = input as { bytes?: unknown; mediaType?: unknown };
		if (!(bytes instanceof Uint8Array) || typeof mediaType !== 'string')
			throw new Error('Invalid request');
		if (!matchesPreviewImageMediaType(bytes, mediaType))
			throw new Error('Image type does not match content');
		const content = new Uint8Array(bytes);
		bitmap = await createImageBitmap(new Blob([content.buffer], { type: mediaType }));
		valid = isPreviewImageDimensionAllowed(bitmap.width, bitmap.height);
	} catch {
		// Decoder errors carry no document content or native paths to the owner.
	} finally {
		bitmap?.close();
	}
	self.postMessage({ valid });
};
