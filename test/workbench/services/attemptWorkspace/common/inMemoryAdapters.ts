import { CancellationToken } from '../../../../../src/prctr/base/common/cancellation.ts';
import type {
	ExamResourceEntry,
	WorkspaceAccess,
	WorkspaceContentVersion,
	WorkspaceCursor,
	WorkspaceEntry,
	WorkspaceEntryReference,
	WorkspacePath
} from '../../../../../src/prctr/workbench/services/attemptWorkspace/common/attemptWorkspace.ts';
import type {
	AuthoritativeWorkspacePort,
	AuthoritativeWorkspaceRead,
	AuthoritativeWorkspaceSnapshot,
	ExamResourcePort,
	ProtectedContentPort,
	RecoveryRecord,
	WorkspaceChangeFeed,
	WorkspaceIdFactory,
	WorkspaceMutationCommand,
	WorkspaceMutationResult
} from '../../../../../src/prctr/workbench/services/attemptWorkspace/common/internalPorts.ts';

const fullAccess: WorkspaceAccess = Object.freeze({
	read: true,
	createDirectory: true,
	createFile: true,
	replaceContent: true,
	move: true,
	delete: true
});
export interface InitialFile {
	readonly reference: string;
	readonly path: string;
	readonly content: string;
	readonly mediaType?: string;
}
export type DispatchBehavior =
	'acknowledge' | 'conflict' | 'reject' | 'throw' | 'transportUnavailable' | 'unknownAfterApply';

export class InMemoryWorkspaceAuthority implements AuthoritativeWorkspacePort {
	readonly #entries = new Map<WorkspaceEntryReference, WorkspaceEntry>();
	readonly #content = new Map<WorkspaceEntryReference, Uint8Array>();
	readonly #results = new Map<string, { signature: string; result: WorkspaceMutationResult }>();
	readonly dispatchLog: WorkspaceMutationCommand[] = [];
	readonly dispatchBehaviors: DispatchBehavior[] = [];
	access: WorkspaceAccess = fullAccess;
	availability: AuthoritativeWorkspaceSnapshot['availability'] = 'online';
	changeFeedMode: 'changes' | 'expired' | 'gap' | 'inconsistent' = 'changes';
	changeFeedOverride: WorkspaceChangeFeed | undefined;
	dispatchBarrier: Promise<void> | undefined;
	readBarrier: Promise<void> | undefined;
	readonly responseBarriers: Array<Promise<void> | undefined> = [];
	readonly afterApplyHooks: Array<((command: WorkspaceMutationCommand) => void) | undefined> = [];
	activeDispatches = 0;
	maximumConcurrentDispatches = 0;
	getSnapshotCalls = 0;
	readCalls = 0;
	readFailures = 0;
	#cursor = 0;
	#stableSequence = 0;
	#versionSequence = 0;
	constructor(files: readonly InitialFile[] = []) {
		for (const file of files) {
			const reference = file.reference as WorkspaceEntryReference;
			const content = new TextEncoder().encode(file.content);
			this.#entries.set(
				reference,
				Object.freeze({
					reference,
					path: file.path as WorkspacePath,
					kind: 'file',
					contentVersion: this.#version(),
					mediaType: file.mediaType ?? 'text/plain',
					byteSize: content.byteLength
				})
			);
			this.#content.set(reference, content);
		}
	}
	async getSnapshot(): Promise<AuthoritativeWorkspaceSnapshot> {
		this.getSnapshotCalls++;
		return this.#snapshot();
	}
	async readCurrent(reference: WorkspaceEntryReference): Promise<AuthoritativeWorkspaceRead> {
		this.readCalls++;
		if (this.readFailures > 0) {
			this.readFailures--;
			throw new Error('read unavailable');
		}
		const entry = this.#entries.get(reference);
		const content = this.#content.get(reference);
		if (
			entry?.kind !== 'file' ||
			entry.contentVersion === undefined ||
			entry.mediaType === undefined ||
			content === undefined
		)
			throw new Error('not found');
		const result = {
			reference,
			content: new Uint8Array(content),
			contentVersion: entry.contentVersion,
			mediaType: entry.mediaType
		};
		await this.readBarrier;
		return result;
	}
	async dispatch(
		command: WorkspaceMutationCommand,
		cancellation = CancellationToken.None
	): Promise<WorkspaceMutationResult> {
		if (cancellation.isCancellationRequested) return { kind: 'notDispatched' };
		const signature = commandSignature(command);
		const prior = this.#results.get(command.idempotencyKey);
		if (prior !== undefined)
			return prior.signature === signature ? prior.result : { kind: 'invalidCommand' };
		this.dispatchLog.push(command);
		const responseBarrier = this.responseBarriers.shift();
		this.activeDispatches++;
		this.maximumConcurrentDispatches = Math.max(
			this.maximumConcurrentDispatches,
			this.activeDispatches
		);
		try {
			await this.dispatchBarrier;
			const behavior = this.dispatchBehaviors.shift() ?? 'acknowledge';
			if (behavior === 'throw') throw new Error('transport rejected');
			if (behavior === 'transportUnavailable') return { kind: 'transportUnavailable' };
			if (behavior === 'conflict') {
				const result = {
					kind: 'conflicted',
					conflict: 'advancedContent',
					snapshot: this.#snapshot()
				} as const;
				this.#results.set(command.idempotencyKey, { signature, result });
				await responseBarrier;
				return result;
			}
			if (behavior === 'reject') {
				const result = { kind: 'rejected', code: 'authorization' } as const;
				this.#results.set(command.idempotencyKey, { signature, result });
				await responseBarrier;
				return result;
			}
			const applied = this.#apply(command);
			this.afterApplyHooks.shift()?.(command);
			this.#results.set(command.idempotencyKey, { signature, result: applied });
			await responseBarrier;
			return behavior === 'unknownAfterApply' ? { kind: 'outcomeUnknown' } : applied;
		} finally {
			this.activeDispatches--;
		}
	}
	async lookupResult(idempotencyKey: string): Promise<WorkspaceMutationResult | undefined> {
		return this.#results.get(idempotencyKey)?.result;
	}
	async changesAfter(cursor: WorkspaceCursor): Promise<WorkspaceChangeFeed> {
		if (this.changeFeedOverride !== undefined) return this.changeFeedOverride;
		if (this.changeFeedMode !== 'changes') return { kind: this.changeFeedMode };
		return {
			kind: 'changes',
			from: cursor,
			to: this.#cursor as WorkspaceCursor,
			snapshot: this.#snapshot()
		};
	}
	createExternally(reference: string, path: string, value: string): void {
		const key = reference as WorkspaceEntryReference;
		if (
			this.#entries.has(key) ||
			[...this.#entries.values()].some((entry) => entry.path === path)
		)
			throw new Error('already exists');
		const content = new TextEncoder().encode(value);
		this.#setEntry(
			{
				reference: key,
				path: path as WorkspacePath,
				kind: 'file',
				contentVersion: this.#version(),
				mediaType: 'text/plain',
				byteSize: content.byteLength
			},
			content
		);
		this.#cursor++;
	}
	replaceExternally(reference: string, value: string): void {
		const key = reference as WorkspaceEntryReference;
		const entry = this.#entries.get(key);
		if (entry?.kind !== 'file') throw new Error('missing');
		const content = new TextEncoder().encode(value);
		this.#entries.set(key, {
			...entry,
			contentVersion: this.#version(),
			byteSize: content.byteLength
		});
		this.#content.set(key, content);
		this.#cursor++;
	}
	moveExternally(reference: string, destination: string): void {
		const key = reference as WorkspaceEntryReference;
		const entry = this.#entries.get(key);
		if (entry === undefined) throw new Error('missing');
		const from = entry.path;
		for (const [candidateReference, candidate] of this.#entries)
			if (candidate.path === from || candidate.path.startsWith(`${from}/`))
				this.#entries.set(
					candidateReference,
					Object.freeze({
						...candidate,
						path: `${destination}${candidate.path.slice(from.length)}` as WorkspacePath
					})
				);
		this.#cursor++;
	}
	#setEntry(entry: WorkspaceEntry, content?: Uint8Array): void {
		this.#entries.set(entry.reference, Object.freeze(entry));
		if (content !== undefined) this.#content.set(entry.reference, new Uint8Array(content));
	}
	#apply(
		command: WorkspaceMutationCommand
	): Extract<WorkspaceMutationResult, { kind: 'acknowledged' | 'conflicted' }> {
		const destinationExists = (path: WorkspacePath): boolean =>
			[...this.#entries.values()].some((entry) => entry.path === path);
		let mappings: Record<string, WorkspaceEntryReference> | undefined;
		if (command.kind === 'createDirectory' || command.kind === 'createFile') {
			if (destinationExists(command.path))
				return {
					kind: 'conflicted',
					conflict: 'localCreationCollision',
					snapshot: this.#snapshot()
				};
			const reference = `entry:${++this.#stableSequence}` as WorkspaceEntryReference;
			mappings = { [command.localReference]: reference };
			if (command.kind === 'createDirectory')
				this.#setEntry({ reference, path: command.path, kind: 'directory' });
			else
				this.#setEntry(
					{
						reference,
						path: command.path,
						kind: 'file',
						contentVersion: this.#version(),
						mediaType: command.mediaType,
						byteSize: command.content.byteLength
					},
					command.content
				);
		} else {
			const entry = this.#entries.get(command.reference);
			if (entry === undefined)
				return {
					kind: 'conflicted',
					conflict: 'authoritativeDeletion',
					snapshot: this.#snapshot()
				};
			if (command.kind === 'replaceContent') {
				if (entry.contentVersion !== command.expectedContentVersion)
					return {
						kind: 'conflicted',
						conflict: 'advancedContent',
						snapshot: this.#snapshot()
					};
				this.#setEntry(
					{
						...entry,
						contentVersion: this.#version(),
						mediaType: command.mediaType,
						byteSize: command.content.byteLength
					},
					command.content
				);
			} else if (command.kind === 'move') {
				if (entry.path !== command.currentPath || destinationExists(command.destination))
					return {
						kind: 'conflicted',
						conflict: 'destinationCollision',
						snapshot: this.#snapshot()
					};
				const from = entry.path;
				for (const [reference, candidate] of [...this.#entries])
					if (candidate.path === from || candidate.path.startsWith(`${from}/`))
						this.#entries.set(
							reference,
							Object.freeze({
								...candidate,
								path: `${command.destination}${candidate.path.slice(from.length)}` as WorkspacePath
							})
						);
			} else {
				if (
					command.expectedContentVersion !== undefined &&
					entry.contentVersion !== command.expectedContentVersion
				)
					return {
						kind: 'conflicted',
						conflict: 'advancedContent',
						snapshot: this.#snapshot()
					};
				const path = entry.path;
				for (const [reference, candidate] of [...this.#entries])
					if (candidate.path === path || candidate.path.startsWith(`${path}/`)) {
						this.#entries.delete(reference);
						this.#content.delete(reference);
					}
			}
		}
		this.#cursor++;
		const snapshot = this.#snapshot();
		return {
			kind: 'acknowledged',
			cursor: snapshot.cursor,
			snapshot,
			...(mappings === undefined ? {} : { referenceMappings: mappings })
		};
	}
	#snapshot(): AuthoritativeWorkspaceSnapshot {
		return Object.freeze({
			cursor: this.#cursor as WorkspaceCursor,
			access: Object.freeze({ ...this.access }),
			availability: this.availability,
			entries: Object.freeze(
				[...this.#entries.values()]
					.sort((a, b) => a.path.localeCompare(b.path))
					.map((entry) => Object.freeze({ ...entry }))
			)
		});
	}
	#version(): WorkspaceContentVersion {
		return `version:${++this.#versionSequence}` as WorkspaceContentVersion;
	}
}

export class InMemoryProtectedContent implements ProtectedContentPort {
	readonly records = new Map<string, RecoveryRecord>();
	readonly failStorageIds = new Set<string>();
	failWrites = false;
	failDeletes = false;
	failWriteOnCall: number | undefined;
	failDeleteOnCall: number | undefined;
	putBarrier: Promise<void> | undefined;
	putCalls = 0;
	deleteCalls = 0;
	async loadRecovery(): Promise<readonly RecoveryRecord[]> {
		return [...this.records.values()].map(cloneRecoveryRecord);
	}
	async putRecovery(record: RecoveryRecord): Promise<void> {
		this.putCalls++;
		if (
			this.failWrites ||
			this.failStorageIds.has(record.storageId) ||
			this.putCalls === this.failWriteOnCall
		)
			throw new Error('storage full');
		await this.putBarrier;
		this.records.set(record.storageId, cloneRecoveryRecord(record));
	}
	async deleteRecovery(storageId: string): Promise<void> {
		this.deleteCalls++;
		if (this.failDeletes || this.deleteCalls === this.failDeleteOnCall)
			throw new Error('storage unavailable');
		this.records.delete(storageId);
	}
}
export class DeterministicWorkspaceIds implements WorkspaceIdFactory {
	#key = 0;
	#reference = 0;
	nextIdempotencyKey(): string {
		return `mutation-key-${++this.#key}`;
	}
	nextLocalReference(): WorkspaceEntryReference {
		return `local:${++this.#reference}` as WorkspaceEntryReference;
	}
	recoveryStorageId(reference: WorkspaceEntryReference, generation: number): string {
		return `recovery:${reference}:${generation}`;
	}
}
export class InMemoryExamResourcePort implements ExamResourcePort {
	constructor(
		readonly resources: readonly (ExamResourceEntry & { readonly content: Uint8Array })[]
	) {}
	async list(): Promise<readonly ExamResourceEntry[]> {
		return this.resources.map(({ content: _content, ...entry }) => Object.freeze(entry));
	}
	async read(reference: string) {
		const value = this.resources.find((entry) => entry.reference === reference);
		if (value === undefined) throw new Error('not found');
		return { ...value, content: new Uint8Array(value.content) };
	}
}

function commandSignature(command: WorkspaceMutationCommand): string {
	return JSON.stringify(command, (_key, value: unknown) =>
		value instanceof Uint8Array ? [...value] : value
	);
}
function cloneRecoveryRecord(record: RecoveryRecord): RecoveryRecord {
	return {
		...record,
		mutation:
			'content' in record.mutation
				? { ...record.mutation, content: new Uint8Array(record.mutation.content) }
				: { ...record.mutation },
		...(record.baseContent === undefined
			? {}
			: { baseContent: new Uint8Array(record.baseContent) }),
		...(record.conflictAuthoritativeContent === undefined
			? {}
			: {
					conflictAuthoritativeContent: new Uint8Array(
						record.conflictAuthoritativeContent
					)
				}),
		...(record.content === undefined ? {} : { content: new Uint8Array(record.content) })
	};
}
