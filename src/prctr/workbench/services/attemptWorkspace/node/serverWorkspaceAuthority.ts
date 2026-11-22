import { createHash } from 'node:crypto';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ServerApiError } from '../../../../platform/serverApi/common/serverApi.js';
import type { components } from '../../../../platform/serverApi/common/serverApi.generated.js';
import type { SessionApi } from '../../../../platform/serverApi/node/sessionApi.js';
import {
	WORKSPACE_V1_HARD_LIMITS,
	type WorkspaceAccess,
	type WorkspaceCursor,
	type WorkspaceEntry,
	type WorkspaceEntryReference,
	type WorkspaceContentVersion,
	type WorkspaceLimits
} from '../common/attemptWorkspace.js';
import type {
	AuthoritativeWorkspacePort,
	AuthoritativeWorkspaceSnapshot,
	AuthoritativeWorkspaceRead,
	WorkspaceMutationCommand,
	WorkspaceMutationResult,
	WorkspaceChangeFeed
} from '../common/internalPorts.js';
import { workspacePath } from '../common/path.js';

type ServerEntry = components['schemas']['CandidateExamWorkspaceItemResponse'];
type Mutation = components['schemas']['CandidateWorkspaceBatchMutation'];
type Change = components['schemas']['CandidateWorkspaceJournalEntryResponse'];
/** Supplied only by the privileged admitted-Participation owner. Never a renderer DTO. */
export interface WorkspaceServerBinding {
	readonly attemptId: string;
	readonly workspaceId: string;
	readonly participationId: string;
	readonly generation: number;
	readonly connectionId: string;
	readonly credential: string;
	readonly epoch: number;
	readonly access: WorkspaceAccess;
}
export interface WorkspaceServerAuthorityOptions {
	readonly api: Pick<SessionApi, 'request'>;
	readonly current: () => WorkspaceServerBinding;
	readonly limits: WorkspaceLimits;
}

/** Direct protected requests; query-cache freshness never authorizes Workspace operations. */
export class ServerWorkspaceAuthority implements AuthoritativeWorkspacePort {
	readonly #lifetime = new AbortController();
	#snapshot: AuthoritativeWorkspaceSnapshot | undefined;
	constructor(private readonly options: WorkspaceServerAuthorityOptions) {}
	dispose(): void {
		this.#lifetime.abort();
		this.#snapshot = undefined;
	}
	async getSnapshot(): Promise<AuthoritativeWorkspaceSnapshot> {
		const scope = this.#scope();
		for (let restart = 0; restart < 3; restart++) {
			const entries: WorkspaceEntry[] = [];
			const seen = new Set<string>();
			const paths = new Set<string>();
			const pages = new Set<string>();
			let next: string | undefined;
			let cursor: number | undefined;
			let refresh = false;
			do {
				const response = await this.options.api.request(
					'listCandidateExamWorkspace',
					{
						path: { exam_attempt_id: scope.attemptId },
						header: headers(scope),
						query: { limit: 200, ...(next ? { cursor: next } : {}) }
					},
					{ signal: this.#lifetime.signal, maxResponseBytes: 4 * 1024 * 1024 }
				);
				this.#check(scope);
				if (response.status !== 200) throw new ServerApiError('invalidResponse');
				const page = response.value;
				if (page.workspace_id !== scope.workspaceId)
					throw new ServerApiError('invalidResponse');
				if (
					page.refresh_required ||
					(cursor !== undefined && page.workspace_cursor !== cursor)
				) {
					refresh = true;
					break;
				}
				cursor = page.workspace_cursor;
				for (const value of page.items) {
					const entry = decodeEntry(value);
					if (seen.has(entry.reference) || paths.has(entry.path))
						throw new ServerApiError('invalidResponse');
					seen.add(entry.reference);
					paths.add(entry.path);
					entries.push(entry);
					if (entries.length > this.options.limits.effectiveEntries)
						throw new ServerApiError('invalidResponse');
				}
				next = page.next_cursor;
				if (next) {
					if (pages.has(next) || pages.size >= 25)
						throw new ServerApiError('invalidResponse');
					pages.add(next);
				}
			} while (next);
			if (refresh) continue;
			if (!Number.isSafeInteger(cursor) || Number(cursor) < 0)
				throw new ServerApiError('invalidResponse');
			const total = entries.reduce((sum, entry) => sum + (entry.byteSize ?? 0), 0);
			if (
				total > this.options.limits.effectiveTotalBytes ||
				entries.some(
					(entry) => (entry.byteSize ?? 0) > this.options.limits.effectiveFileBytes
				)
			)
				throw new ServerApiError('invalidResponse');
			const snapshot = Object.freeze({
				cursor: cursor as WorkspaceCursor,
				entries: Object.freeze(entries),
				access: Object.freeze({ ...scope.access }),
				availability: 'online' as const
			});
			if (!this.#snapshot || snapshot.cursor >= this.#snapshot.cursor)
				this.#snapshot = snapshot;
			return snapshot;
		}
		throw new ServerApiError('invalidResponse');
	}
	async readCurrent(reference: WorkspaceEntryReference): Promise<AuthoritativeWorkspaceRead> {
		const scope = this.#scope();
		for (let retry = 0; retry < 3; retry++) {
			const snapshot =
				retry === 0 && this.#snapshot ? this.#snapshot : await this.getSnapshot();
			const entry = snapshot.entries.find((value) => value.reference === reference);
			if (
				entry?.kind !== 'file' ||
				!entry.contentVersion ||
				!entry.mediaType ||
				!entry.sha256
			)
				throw new ServerApiError('invalidResponse');
			const response = await this.options.api.request(
				'getCandidateExamWorkspaceContent',
				{
					path: {
						exam_attempt_id: scope.attemptId,
						attempt_workspace_entry_id: reference
					},
					header: headers(scope)
				},
				{
					signal: this.#lifetime.signal,
					maxResponseBytes: this.options.limits.effectiveFileBytes
				}
			);
			this.#check(scope);
			if (response.status !== 200 || !(response.value instanceof Uint8Array))
				throw new ServerApiError('invalidResponse');
			if (response.headers.etag !== `"${entry.contentVersion}"`) continue;
			if (
				response.value.byteLength !== entry.byteSize ||
				digest(response.value) !== entry.sha256
			)
				throw new ServerApiError('invalidResponse');
			return {
				reference,
				content: response.value,
				contentVersion: entry.contentVersion,
				mediaType: entry.mediaType
			};
		}
		throw new ServerApiError('invalidResponse');
	}
	async dispatch(
		command: WorkspaceMutationCommand,
		cancellation: CancellationToken
	): Promise<WorkspaceMutationResult> {
		if (cancellation.isCancellationRequested) return { kind: 'notDispatched' };
		let scope: WorkspaceServerBinding;
		try {
			scope = this.#scope();
		} catch {
			return { kind: 'rejected', code: 'authorization' };
		}
		if (!scope.access[command.kind]) return { kind: 'rejected', code: 'authorization' };
		const abort = new AbortController();
		const listener = cancellation.onCancellationRequested(() => abort.abort());
		const signal = AbortSignal.any([abort.signal, this.#lifetime.signal]);
		let received = false;
		try {
			const { mutation, content } = batchMutation(command);
			const response = await this.options.api.request(
				'applyCandidateExamWorkspaceBatch',
				{
					header: { ...headers(scope), 'Idempotency-Key': command.idempotencyKey },
					path: { exam_attempt_id: scope.attemptId },
					body: {
						manifest: {
							participation_id: scope.participationId,
							generation: scope.generation,
							mutations: [mutation],
							...(command.kind === 'delete' &&
							command.expectedWorkspaceCursor !== undefined
								? { expected_workspace_cursor: command.expectedWorkspaceCursor }
								: {})
						},
						...(content ? { content: [content] } : {})
					}
				},
				{ signal }
			);
			if (response.status !== 200) throw new ServerApiError('invalidResponse');
			const receipt = response.value;
			received = true;
			this.#check(scope);
			const change = receipt.changes[0];
			if (
				receipt.workspace_id !== scope.workspaceId ||
				receipt.changes.length !== 1 ||
				!change ||
				change.operation !== operations[command.kind] ||
				change.cursor !== receipt.workspace_cursor ||
				receipt.first_workspace_cursor !== receipt.workspace_cursor
			)
				throw new ServerApiError('invalidResponse');
			validateChange(command, change);
			const snapshot = await this.getSnapshot();
			this.#check(scope);
			if (snapshot.cursor < receipt.workspace_cursor)
				throw new ServerApiError('invalidResponse');
			const acknowledgedEntry = acknowledged(command, change, snapshot);
			return {
				kind: 'acknowledged',
				cursor: receipt.workspace_cursor as WorkspaceCursor,
				snapshot,
				...(acknowledgedEntry ? { acknowledgedEntry } : {}),
				...('localReference' in command && acknowledgedEntry
					? {
							referenceMappings: {
								[command.localReference]: acknowledgedEntry.reference
							}
						}
					: {})
			};
		} catch (error) {
			if (received) return { kind: 'outcomeUnknown' };
			if (error instanceof ServerApiError && error.kind === 'invalidRequest')
				return { kind: 'invalidCommand' };
			if (error instanceof ServerApiError && error.kind === 'server') {
				const code = error.problem?.code;
				if (
					code === 'exam.attempt.workspace.entry_limit' ||
					code === 'exam.attempt.workspace.size_limit'
				)
					return { kind: 'rejected', code: 'quota' };
				if (code === 'exam.attempt.workspace.content_conflict')
					return { kind: 'conflicted', conflict: 'advancedContent' };
				if (code === 'exam.attempt.workspace.entry_conflict')
					return { kind: 'conflicted', conflict: 'authoritativeDeletion' };
				if (
					code === 'exam.attempt.workspace.cursor_conflict' ||
					code === 'exam.attempt.workspace.directory_not_empty'
				)
					return { kind: 'conflicted', conflict: 'incompatibleSubtreeMove' };
				if (code === 'exam.attempt.workspace.path_conflict')
					return {
						kind: 'conflicted',
						conflict:
							command.kind === 'createDirectory' || command.kind === 'createFile'
								? 'localCreationCollision'
								: 'destinationCollision'
					};
				// A rate-limited batch stages nothing, so the command can be sent again later.
				if (code === 'exam.attempt.workspace.rate_limited' || error.status === 429)
					return { kind: 'notDispatched' };
				// In-progress/key conflicts and unknown 409s do not establish the original outcome.
				if (error.status === 409) return { kind: 'outcomeUnknown' };
				if (error.status === 401 || error.status === 403 || error.status === 404)
					return { kind: 'rejected', code: 'authorization' };
				if (error.status === 413) return { kind: 'rejected', code: 'size' };
				if (error.status === 400 || error.status === 422) return { kind: 'invalidCommand' };
			}
			return { kind: 'outcomeUnknown' };
		} finally {
			listener.dispose();
		}
	}
	async lookupResult(
		key: string,
		command?: WorkspaceMutationCommand
	): Promise<WorkspaceMutationResult | undefined> {
		if (
			!command ||
			command.idempotencyKey !== key ||
			command.replayUntil === undefined ||
			Date.now() >= command.replayUntil
		)
			return { kind: 'outcomeUnknown' };
		const result = await this.dispatch(command, CancellationToken.None);
		// A denied replay cannot establish whether the original request committed.
		return result.kind === 'rejected' ||
			result.kind === 'invalidCommand' ||
			result.kind === 'notDispatched'
			? { kind: 'outcomeUnknown' }
			: result;
	}
	async changesAfter(cursor: WorkspaceCursor): Promise<WorkspaceChangeFeed> {
		const scope = this.#scope();
		const response = await this.options.api.request(
			'listCandidateExamWorkspaceChanges',
			{
				path: { exam_attempt_id: scope.attemptId },
				header: headers(scope),
				query: { workspace_cursor: cursor, limit: 200 }
			},
			{ signal: this.#lifetime.signal }
		);
		this.#check(scope);
		if (response.status !== 200 || response.value.workspace_id !== scope.workspaceId)
			throw new ServerApiError('invalidResponse');
		if (response.value.refresh_required) return { kind: 'gap' };
		// Journal entries intentionally omit complete content metadata. Refresh through the
		// cursor-pinned manifest rather than inventing metadata or partial snapshots.
		const snapshot = await this.getSnapshot();
		this.#check(scope);
		return snapshot.cursor < cursor
			? { kind: 'inconsistent' }
			: { kind: 'changes', from: cursor, to: snapshot.cursor, snapshot };
	}
	#scope(): WorkspaceServerBinding {
		const scope = this.options.current();
		if (this.#lifetime.signal.aborted || !scope.access.read)
			throw new ServerApiError('sessionEnded');
		return { ...scope, access: { ...scope.access } };
	}
	#check(scope: WorkspaceServerBinding): void {
		const current = this.#scope();
		if (
			current.epoch !== scope.epoch ||
			current.attemptId !== scope.attemptId ||
			current.workspaceId !== scope.workspaceId ||
			current.participationId !== scope.participationId ||
			current.generation !== scope.generation ||
			current.connectionId !== scope.connectionId
		)
			throw new ServerApiError('sessionEnded');
	}
}
const operations = {
	createDirectory: 'create_directory',
	createFile: 'create_file',
	replaceContent: 'replace_file',
	move: 'move_entry',
	delete: 'delete_entry'
} as const;
export function headers(scope: WorkspaceServerBinding) {
	return {
		'X-Proctor-Attempt-Credential': scope.credential,
		'X-Proctor-Attempt-Connection-ID': scope.connectionId
	};
}
export function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
function decodeEntry(value: ServerEntry): WorkspaceEntry {
	const path = workspacePath(value.path);
	if (
		value.kind === 'file' &&
		(!value.content_version ||
			!value.media_type ||
			!value.sha256 ||
			!Number.isSafeInteger(value.size) ||
			Number(value.size) < 0)
	)
		throw new ServerApiError('invalidResponse');
	return Object.freeze({
		reference: value.id as WorkspaceEntryReference,
		path,
		kind: value.kind,
		...(value.kind === 'file'
			? {
					contentVersion: value.content_version as WorkspaceContentVersion,
					mediaType: value.media_type!,
					byteSize: value.size!,
					sha256: value.sha256!
				}
			: {})
	});
}
function batchMutation(command: WorkspaceMutationCommand): {
	readonly mutation: Mutation;
	readonly content?: Uint8Array;
} {
	switch (command.kind) {
		case 'createDirectory':
			return { mutation: { operation: 'create_directory', path: command.path } };
		case 'createFile':
			return {
				mutation: {
					operation: 'create_file',
					path: command.path,
					media_type: command.mediaType,
					size: command.content.byteLength,
					sha256: digest(command.content)
				},
				content: command.content
			};
		case 'replaceContent':
			return {
				mutation: {
					operation: 'replace_file',
					entry_id: command.reference,
					expected_path: command.expectedPath,
					expected_content_version: command.expectedContentVersion,
					media_type: command.mediaType,
					size: command.content.byteLength,
					sha256: digest(command.content)
				},
				content: command.content
			};
		case 'move':
			return {
				mutation: {
					operation: 'move_entry',
					entry_id: command.reference,
					expected_path: command.currentPath,
					destination_path: command.destination
				}
			};
		case 'delete':
			return {
				mutation: {
					operation: 'delete_entry',
					entry_id: command.reference,
					expected_path: command.expectedPath,
					...(command.recursive ? { recursive: true } : {}),
					...(command.expectedContentVersion
						? { expected_content_version: command.expectedContentVersion }
						: {})
				}
			};
	}
}
/** The journal change must describe exactly the requested mutation. */
function validateChange(command: WorkspaceMutationCommand, change: Change): void {
	if ('reference' in command && change.entry_id !== command.reference)
		throw new ServerApiError('invalidResponse');
	const kind = command.kind === 'createDirectory' ? 'directory' : 'file';
	if (command.kind !== 'move' && command.kind !== 'delete' && change.kind !== kind)
		throw new ServerApiError('invalidResponse');
	if (command.kind === 'delete') {
		if (change.old_path !== command.expectedPath || change.new_path !== undefined)
			throw new ServerApiError('invalidResponse');
		return;
	}
	const path =
		command.kind === 'move'
			? command.destination
			: command.kind === 'replaceContent'
				? command.expectedPath
				: command.path;
	const previous =
		command.kind === 'move'
			? command.currentPath
			: command.kind === 'replaceContent'
				? command.expectedPath
				: undefined;
	if (change.new_path !== path || change.old_path !== previous)
		throw new ServerApiError('invalidResponse');
	if (change.kind === 'file' && !change.content_version)
		throw new ServerApiError('invalidResponse');
}
/**
 * The acknowledged entry as of the change itself, independent of newer snapshot state. Content
 * metadata comes from the command for writes, and from the snapshot for a moved file only when
 * the snapshot still holds the acknowledged content version.
 */
function acknowledged(
	command: WorkspaceMutationCommand,
	change: Change,
	snapshot: AuthoritativeWorkspaceSnapshot
): WorkspaceEntry | undefined {
	if (command.kind === 'delete') return undefined;
	const reference = change.entry_id as WorkspaceEntryReference;
	const path = workspacePath(change.new_path!);
	if (change.kind === 'directory') return Object.freeze({ reference, path, kind: 'directory' });
	const contentVersion = change.content_version as WorkspaceContentVersion;
	if ('content' in command)
		return Object.freeze({
			reference,
			path,
			kind: 'file',
			contentVersion,
			mediaType: command.mediaType,
			byteSize: command.content.byteLength,
			sha256: digest(command.content)
		});
	const current = snapshot.entries.find(
		(entry) => entry.reference === reference && entry.contentVersion === contentVersion
	);
	return current ? Object.freeze({ ...current, path }) : undefined;
}
export function workspaceLimitsFromCapacity(
	capacity: components['schemas']['ExamCapacityPolicy']
): WorkspaceLimits {
	const limits = {
		effectiveEntries: capacity.workspace_maximum_entries,
		effectiveFileBytes: capacity.workspace_maximum_file_bytes,
		effectiveTotalBytes: capacity.workspace_maximum_total_bytes,
		editorModelBytes: WORKSPACE_V1_HARD_LIMITS.editorModelBytes
	};
	if (
		Object.entries(limits).some(
			([key, value]) =>
				!Number.isSafeInteger(value) ||
				value < 1 ||
				value > WORKSPACE_V1_HARD_LIMITS[key as keyof WorkspaceLimits]
		) ||
		limits.effectiveTotalBytes < limits.effectiveFileBytes
	)
		throw new ServerApiError('invalidResponse');
	return Object.freeze(limits);
}
