/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { validatePreviewImage } from '../common/imageDimensions.js';

// This entrypoint is bundled as a fixed application asset. Potentially hostile
// parsers never execute on the workbench thread; its owner terminates this worker.
self.onmessage = (event: MessageEvent<unknown>): void => {
	const input = event.data;
	let valid = false;
	try {
		if (!input || typeof input !== 'object') throw new Error('Invalid request');
		const { bytes, mediaType } = input as { bytes?: unknown; mediaType?: unknown };
		if (!(bytes instanceof Uint8Array) || typeof mediaType !== 'string')
			throw new Error('Invalid request');
		validatePreviewImage(bytes, mediaType);
		valid = true;
	} catch {
		// Parser errors carry no document content or native paths to the owner.
	}
	self.postMessage({ valid });
};
