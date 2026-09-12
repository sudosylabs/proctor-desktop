/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import {
	Disposable,
	DisposableStore,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import { validateSvgForPreview } from './imageData.js';

export interface PreviewImageValidator extends IDisposable {
	validate(bytes: Uint8Array, mediaType: string, token: CancellationToken): Promise<void>;
}

const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 1000;
const MAX_ACTIVE_WORKERS = 2;
let activeWorkers = 0;

/** Owns terminable metadata parsing, including known image-size non-terminating inputs. */
export class ImageMetadataService extends Disposable implements PreviewImageValidator {
	private readonly pending = new Set<() => void>();
	private ended = false;

	/** Only the literal packaged asset bundle supplies this source; documents cannot choose it. */
	constructor(private readonly workerSource: string) {
		super();
	}

	async validate(bytes: Uint8Array, mediaType: string, token: CancellationToken): Promise<void> {
		if (this.ended || token.isCancellationRequested) throw new CancellationError();
		if (bytes.byteLength < 6 || bytes.byteLength > MAX_BYTES)
			throw new Error('Invalid image size');
		if (mediaType === 'image/svg+xml') {
			validateSvgForPreview(bytes);
			return;
		}
		if (activeWorkers >= MAX_ACTIVE_WORKERS)
			throw new Error('Image validation capacity exceeded');
		const deadline = performance.now() + TIMEOUT_MS;
		await new Promise<void>((resolve, reject) => {
			const cleanup = new DisposableStore();
			let worker: Worker | undefined;
			let url: string | undefined;
			let done = false;
			const cancel = (): void => finish(new CancellationError());
			const finish = (error?: Error): void => {
				if (done) return;
				done = true;
				this.pending.delete(cancel);
				try {
					worker?.terminate();
				} finally {
					if (url) URL.revokeObjectURL(url);
					cleanup.dispose();
					activeWorkers--;
				}
				if (error) reject(error);
				else resolve();
			};
			activeWorkers++;
			this.pending.add(cancel);
			try {
				const timer = setTimeout(
					() => finish(new Error('Image validation timed out')),
					TIMEOUT_MS
				);
				cleanup.add({ dispose: () => clearTimeout(timer) });
				cleanup.add(token.onCancellationRequested(cancel));
				if (this.ended || token.isCancellationRequested) {
					cancel();
					return;
				}
				url = URL.createObjectURL(
					new Blob([this.workerSource], { type: 'text/javascript' })
				);
				worker = new Worker(url, { name: 'Proctor image metadata' });
				worker.onerror = (event): void => {
					event.preventDefault();
					finish(new Error('Invalid image metadata'));
				};
				worker.onmessageerror = (): void => finish(new Error('Invalid image metadata'));
				worker.onmessage = (event: MessageEvent<unknown>): void => {
					if (performance.now() >= deadline) {
						finish(new Error('Image validation timed out'));
						return;
					}
					const value = event.data;
					finish(
						value && typeof value === 'object' && Reflect.get(value, 'valid') === true
							? undefined
							: new Error('Invalid image metadata')
					);
				};
				// Transfer an owned copy; the caller's authorized lease remains intact.
				const copy = new Uint8Array(bytes);
				worker.postMessage({ bytes: copy, mediaType }, [copy.buffer]);
			} catch {
				finish(new Error('Image validation unavailable'));
			}
		});
	}

	override dispose(): void {
		if (this.ended) return;
		this.ended = true;
		for (const cancel of [...this.pending]) cancel();
		super.dispose();
	}
}
