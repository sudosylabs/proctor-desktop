import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import {
	FileChangeType,
	FilePermission,
	FileSystemProviderCapabilities,
	FileSystemProviderErrorCode,
	FileType,
	createFileSystemProviderError,
	type IFileSystemProviderWithFileReadWriteCapability,
	type IFileDeleteOptions,
	type IFileOverwriteOptions,
	type IFileWriteOptions,
	type IStat,
	type IWatchOptions
} from '../../../../platform/files/common/files.js';
import type {
	AttemptWorkspaceSession,
	ExamResourceCatalog
} from '../../../services/attemptWorkspace/common/attemptWorkspace.js';
import {
	AttemptWorkspaceFileSystemProvider,
	ExamResourceFileSystemProvider,
	WorkspaceProviderError
} from './workspaceFileSystemProvider.js';

let metadataClock = Date.now();

/** VS Code's FileService consumes this adapter; the session owns all durability. */
export class WorkspaceFileServiceProvider
	extends Disposable
	implements IFileSystemProviderWithFileReadWriteCapability
{
	readonly capabilities =
		FileSystemProviderCapabilities.FileReadWrite |
		FileSystemProviderCapabilities.PathCaseSensitive;
	readonly onDidChangeCapabilities = Event.None;
	readonly onDidChangeFile;
	readonly #provider: AttemptWorkspaceFileSystemProvider;
	readonly #metadata = new Map<string, { signature: string; mtime: number }>();
	#disposed = false;
	constructor(
		scope: string,
		private readonly session: AttemptWorkspaceSession
	) {
		super();
		this.#provider = this._register(new AttemptWorkspaceFileSystemProvider(scope, session));
		this._register(
			session.observe().onDidChange((projection) => {
				const paths = new Set<string>(['/']);
				for (const entry of projection.entries) {
					let path = `/${entry.path}`;
					while (path) {
						paths.add(path);
						path = path.slice(0, path.lastIndexOf('/'));
					}
				}
				for (const key of this.#metadata.keys())
					if (!paths.has(URI.parse(key).path)) this.#metadata.delete(key);
			})
		);
		this.onDidChangeFile = Event.map(this.#provider.onDidChangeFile, (changes) =>
			changes.map((change) => ({
				resource: URI.parse(change.uri),
				type:
					change.type === 'added'
						? FileChangeType.ADDED
						: change.type === 'deleted'
							? FileChangeType.DELETED
							: FileChangeType.UPDATED
			}))
		);
	}
	watch(resource: URI, options: IWatchOptions) {
		this.#check(resource);
		return this.#provider.watch(resource.toString(), options);
	}
	stat(resource: URI): Promise<IStat> {
		return this.#call(resource, () => {
			const stat = this.#provider.stat(resource.toString());
			// The server has no timestamps. Each observed content identity gets a monotonic
			// local stamp, including remote replacements that do not change overlay generation.
			const key = resource.toString();
			const signature = JSON.stringify([stat.type, stat.size, stat.contentVersion]);
			let metadata = this.#metadata.get(key);
			if (!metadata || metadata.signature !== signature) {
				metadata = { signature, mtime: ++metadataClock };
				this.#metadata.set(key, metadata);
			}
			return {
				type: stat.type === 'file' ? FileType.File : FileType.Directory,
				size: stat.size,
				ctime: 0,
				mtime: metadata.mtime
			};
		});
	}
	readdir(resource: URI): Promise<[string, FileType][]> {
		return this.#call(resource, () =>
			this.#provider
				.readDirectory(resource.toString())
				.map(([name, kind]) => [name, kind === 'file' ? FileType.File : FileType.Directory])
		);
	}
	readFile(resource: URI): Promise<Uint8Array> {
		return this.#call(resource, () => this.#provider.readFile(resource.toString()));
	}
	writeFile(resource: URI, bytes: Uint8Array, options: IFileWriteOptions): Promise<void> {
		return this.#call(resource, () => {
			if (options.atomic || options.unlock)
				throw createFileSystemProviderError(
					'Unsupported Workspace write option',
					FileSystemProviderErrorCode.Unavailable
				);
			const path = resource.path.slice(1);
			const mediaType =
				this.session.observe().current.entries.find((entry) => entry.path === path)
					?.mediaType ?? 'application/octet-stream';
			return this.#provider.writeFile(resource.toString(), bytes, { ...options, mediaType });
		});
	}
	mkdir(resource: URI): Promise<void> {
		return this.#call(resource, () => this.#provider.createDirectory(resource.toString()));
	}
	delete(resource: URI, options: IFileDeleteOptions): Promise<void> {
		return this.#call(resource, () => {
			if (options.useTrash || options.atomic)
				throw createFileSystemProviderError(
					'Unsupported Workspace deletion option',
					FileSystemProviderErrorCode.Unavailable
				);
			return this.#provider.delete(resource.toString(), options.recursive);
		});
	}
	rename(from: URI, to: URI, options: IFileOverwriteOptions): Promise<void> {
		return this.#call(from, () => {
			this.#check(to);
			return this.#provider.rename(from.toString(), to.toString(), options.overwrite);
		});
	}
	override dispose(): void {
		this.#disposed = true;
		this.#metadata.clear();
		super.dispose();
	}
	#check(resource: URI): void {
		if (
			this.#disposed ||
			!this.session.observe().current.access.read ||
			resource.query ||
			resource.fragment
		)
			throw createFileSystemProviderError(
				'Workspace access is unavailable',
				FileSystemProviderErrorCode.NoPermissions
			);
	}
	async #call<T>(resource: URI, operation: () => T | Promise<T>): Promise<T> {
		try {
			this.#check(resource);
			const result = await operation();
			this.#check(resource);
			return result;
		} catch (error) {
			throw translate(error);
		}
	}
}

/** Separate immutable, readonly provider: resources never enter workspace recovery. */
export class ExamResourceFileServiceProvider
	extends Disposable
	implements IFileSystemProviderWithFileReadWriteCapability
{
	readonly capabilities =
		FileSystemProviderCapabilities.FileReadWrite |
		FileSystemProviderCapabilities.PathCaseSensitive |
		FileSystemProviderCapabilities.Readonly;
	readonly onDidChangeCapabilities = Event.None;
	readonly onDidChangeFile = Event.None;
	readonly #provider: ExamResourceFileSystemProvider;
	#disposed = false;
	constructor(
		scope: string,
		private readonly catalog: ExamResourceCatalog
	) {
		super();
		this.#provider = this._register(new ExamResourceFileSystemProvider(scope, catalog));
	}
	watch(resource: URI, _options: IWatchOptions) {
		this.#check(resource);
		return { dispose() {} };
	}
	stat(resource: URI): Promise<IStat> {
		return this.#call(resource, () => {
			const stat = this.#provider.stat(resource.toString());
			return {
				type: stat.type === 'file' ? FileType.File : FileType.Directory,
				size: stat.size,
				ctime: 0,
				mtime: 0,
				permissions: FilePermission.Readonly
			};
		});
	}
	readdir(resource: URI): Promise<[string, FileType][]> {
		return this.#call(resource, () =>
			this.#provider
				.readDirectory(resource.toString())
				.map(([name, kind]) => [name, kind === 'file' ? FileType.File : FileType.Directory])
		);
	}
	readFile(resource: URI): Promise<Uint8Array> {
		return this.#call(resource, () => this.#provider.readFile(resource.toString()));
	}
	async writeFile(): Promise<never> {
		return this.#readonly();
	}
	async mkdir(): Promise<never> {
		return this.#readonly();
	}
	async delete(): Promise<never> {
		return this.#readonly();
	}
	async rename(): Promise<never> {
		return this.#readonly();
	}
	override dispose(): void {
		this.#disposed = true;
		super.dispose();
	}
	#readonly(): never {
		throw createFileSystemProviderError(
			'Exam Resources are read only',
			FileSystemProviderErrorCode.NoPermissions
		);
	}
	#check(resource: URI): void {
		if (
			this.#disposed ||
			!this.catalog.observe().current.available ||
			resource.query ||
			resource.fragment
		)
			throw createFileSystemProviderError(
				'Exam Resource access is unavailable',
				FileSystemProviderErrorCode.NoPermissions
			);
	}
	async #call<T>(resource: URI, operation: () => T | Promise<T>): Promise<T> {
		try {
			this.#check(resource);
			const result = await operation();
			this.#check(resource);
			return result;
		} catch (error) {
			throw translate(error);
		}
	}
}
function translate(error: unknown): Error {
	if (error instanceof WorkspaceProviderError)
		return createFileSystemProviderError(
			error.message,
			FileSystemProviderErrorCode[error.code]
		);
	if (error instanceof Error && 'code' in error) return error;
	return createFileSystemProviderError(
		'Resource operation is unavailable',
		FileSystemProviderErrorCode.Unavailable
	);
}
