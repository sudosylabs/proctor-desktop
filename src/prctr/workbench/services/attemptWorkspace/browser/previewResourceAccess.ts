import { Emitter, type Event } from '../../../../base/common/event.js';
import type { IDisposable } from '../../../../base/common/lifecycle.js';
import { CancellationError } from '../../../../base/common/errors.js';
import type { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { extUri } from '../../../../base/common/resources.js';
import type { IFileService } from '../../../../platform/files/common/files.js';
import type {
	PreviewDocumentLease,
	PreviewResourceAccess
} from '../../resourcePreview/common/resourcePreview.js';

export interface PreviewReadAuthorization {
	readonly epoch: number;
	readonly revision: string;
	readonly mediaType: string;
}
export interface FilePreviewAccessOptions {
	readonly files: Pick<IFileService, 'readFile'>;
	/** Exact logical roots, never local OS folders. One read cannot cross between them. */
	readonly roots: readonly URI[];
	readonly maximumBytes: number;
	readonly onDidRevoke: Event<void>;
	readonly authorize: (resource: URI) => PreviewReadAuthorization | undefined;
	/** Closed navigation intent handled by the owning workbench/browser policy. */
	readonly openLink: (source: URI, reference: string) => Promise<void>;
}
/** Shares FileService/provider authority; previews never obtain an independent file or network channel. */
export class FilePreviewResourceAccess implements PreviewResourceAccess {
	readonly #roots: readonly URI[];
	readonly #revoked = new Emitter<void>();
	readonly onDidRevoke = this.#revoked.event;
	readonly #revocation: IDisposable;
	readonly #leases = new Set<PreviewDocumentLease>();
	#disposed = false;
	constructor(private readonly options: FilePreviewAccessOptions) {
		if (!Number.isSafeInteger(options.maximumBytes) || options.maximumBytes < 1)
			throw new RangeError('Invalid preview read limit');
		this.#roots = Object.freeze(
			options.roots.map((root) => {
				if (
					!['prctr-workspace', 'prctr-exam-resource'].includes(root.scheme) ||
					!root.authority ||
					root.query ||
					root.fragment
				)
					throw new Error('Invalid preview root');
				return root;
			})
		);
		this.#revocation = options.onDidRevoke(() => this.dispose());
	}
	async readRelative(
		source: string,
		reference: string,
		token: CancellationToken
	): Promise<PreviewDocumentLease> {
		const sourceUri = URI.parse(source, true);
		const sourceAccess = this.#authorize(sourceUri);
		const root = this.#root(sourceUri);
		if (
			!reference ||
			reference.length > 4096 ||
			reference.includes('\\') ||
			/[\p{Cc}]/u.test(reference)
		)
			throw new Error('Invalid preview reference');
		const target = URI.parse(new URL(reference, sourceUri.toString()).toString(), true);
		if (target.query || target.fragment || !extUri.isEqualOrParent(target, root))
			throw new Error('Preview reference is outside its source root');
		const access = this.#authorize(target);
		if (token.isCancellationRequested) throw new CancellationError();
		const value = await this.options.files.readFile(
			target,
			{ limits: { size: this.options.maximumBytes } },
			token
		);
		const bytes = new Uint8Array(value.value.buffer);
		try {
			if (token.isCancellationRequested) throw new CancellationError();
			this.#check(sourceUri, sourceAccess);
			this.#check(target, access);
			if (bytes.byteLength > this.options.maximumBytes)
				throw new RangeError('Preview exceeds read limit');
			const lease: PreviewDocumentLease = Object.freeze({
				resource: target.toString(),
				revision: access.revision,
				mediaType: access.mediaType,
				bytes,
				dispose: () => {
					bytes.fill(0);
					this.#leases.delete(lease);
				}
			});
			this.#leases.add(lease);
			return lease;
		} catch (error) {
			bytes.fill(0);
			throw error;
		}
	}
	async openLink(source: string, reference: string): Promise<void> {
		const uri = URI.parse(source, true);
		this.#authorize(uri);
		if (!reference || reference.length > 4096 || /[\p{Cc}]/u.test(reference))
			throw new Error('Invalid preview link');
		await this.options.openLink(uri, reference);
	}
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const lease of this.#leases) lease.dispose();
		this.#revoked.fire();
		this.#revocation.dispose();
		this.#revoked.dispose();
	}
	#root(uri: URI): URI {
		const root = this.#roots.find((candidate) => extUri.isEqualOrParent(uri, candidate));
		if (!root) throw new Error('Preview resource is outside its authorized roots');
		return root;
	}
	#authorize(uri: URI): PreviewReadAuthorization {
		if (this.#disposed || uri.query || uri.fragment)
			throw new Error('Preview access is unavailable');
		this.#root(uri);
		const access = this.options.authorize(uri);
		if (!access) throw new Error('Preview access is unavailable');
		return { ...access };
	}
	#check(uri: URI, before: PreviewReadAuthorization): void {
		const after = this.#authorize(uri);
		if (
			after.epoch !== before.epoch ||
			after.revision !== before.revision ||
			after.mediaType !== before.mediaType
		)
			throw new Error('Preview access changed during read');
	}
}
