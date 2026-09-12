/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { WORKSPACE_V1_HARD_LIMITS, WORKSPACE_V1_MAX_RECOVERY_RESTORE_BYTES, type AttemptWorkspaceSession, type WorkspaceAccess, type WorkspaceChange, type WorkspaceChangeResult, type WorkspaceContentVersion, type WorkspaceEntry, type WorkspaceEntryReference, type WorkspaceLimits, type WorkspaceObservation, type WorkspacePath, type WorkspaceProjection, type WorkspaceRead, type WorkspaceReadResult, type WorkspaceSettlement, type WorkspaceSettlementBlocker, type WorkspaceSettlementResult, type WorkspaceStateFacts, type WorkspaceViewGeneration } from './attemptWorkspace.js';
import type { AuthoritativeWorkspacePort, AuthoritativeWorkspaceSnapshot, ProtectedContentPort, RecoveryRecord, WorkspaceIdFactory, WorkspaceMutationCommand, WorkspaceMutationResult } from './internalPorts.js';
import { pathsOverlap, workspacePath } from './path.js';
import { decodeTextContent, mergeNonOverlappingText } from './threeWayMerge.js';

type OperationState = 'acknowledged' | 'conflicted' | 'conflictPending' | 'discarded' | 'inFlight' | 'outcomeUnknown' | 'queued' | 'rejected';
type RecoveryState = 'failed' | 'notRequired' | 'pending' | 'protected';
interface ContentState { readonly content: Uint8Array; readonly contentVersion: WorkspaceContentVersion; readonly mediaType: string }
interface ConflictContentState { readonly authoritative: ContentState; readonly base: ContentState; readonly local: ContentState }
interface LocalOperation { generation: WorkspaceViewGeneration; intent: Exclude<WorkspaceChange, { readonly kind: 'discard' | 'resolveConflict' }>; idempotencyKey: string; reference?: WorkspaceEntryReference; state: OperationState; recovery: RecoveryState; recoveryStorageId: string; recoveryBytes?: number; rejection?: string; base?: ContentState; baseEntry?: WorkspaceEntry; conflict?: ConflictContentState; resolvesConflictStorageId?: string; resolvesConflict?: LocalOperation; retainedForDependencies?: boolean; dispatchedCommand?: WorkspaceMutationCommand }

/** Privileged participation owner publishes gating synchronously, independently of HTTP snapshots. */
export interface WorkspaceAuthorization {
 readonly current: () => WorkspaceAccess;
 readonly onDidChange: Event<void>;
}
export interface AttemptWorkspaceSessionOptions { readonly authorization?: WorkspaceAuthorization; readonly authority: AuthoritativeWorkspacePort; readonly protectedContent: ProtectedContentPort; readonly ids: WorkspaceIdFactory; readonly snapshot: AuthoritativeWorkspaceSnapshot; readonly recoveryRecords: readonly RecoveryRecord[]; readonly limits: WorkspaceLimits }

export async function createAttemptWorkspaceSession(options: Omit<AttemptWorkspaceSessionOptions, 'snapshot' | 'recoveryRecords'>): Promise<AttemptWorkspaceSession> {
	const [snapshot, recoveryRecords] = await Promise.all([options.authority.getSnapshot(), options.protectedContent.loadRecovery()]);
	return new AttemptWorkspaceSessionImpl({ ...options, snapshot, recoveryRecords });
}

export class AttemptWorkspaceSessionImpl extends Disposable implements AttemptWorkspaceSession {
	readonly #options: AttemptWorkspaceSessionOptions;
	readonly #changeEmitter = this._register(new Emitter<WorkspaceProjection>()); readonly #onDidChange: Event<WorkspaceProjection> = this.#changeEmitter.event;
	readonly #lifecycleCancellation = new CancellationTokenSource();
	readonly #operations: LocalOperation[] = []; readonly #referenceMappings = new Map<WorkspaceEntryReference, WorkspaceEntryReference>(); readonly #authoritativeContent = new Map<WorkspaceEntryReference, ContentState>(); readonly #conflicts = new Map<WorkspaceEntryReference, ConflictContentState>();
	#snapshot: AuthoritativeWorkspaceSnapshot; #generation = 0; #projection: WorkspaceProjection; #authorityWritable: boolean; #protectedContentWritable = true; #retainedRecoveryBytes = 0; #stateSerial: Promise<void> = Promise.resolve(); #disposed = false;
	constructor(options: AttemptWorkspaceSessionOptions) {
		super(); this.#options = options; validateLimits(options.limits); this.#snapshot = cloneSnapshot(options.snapshot); this.#authorityWritable = options.snapshot.availability === 'online';
		for (const operation of restoreRecoveryOperations(options.recoveryRecords, options.limits)) {
			this.#operations.push(operation); this.#generation = Math.max(this.#generation, operation.generation); this.#retainedRecoveryBytes += operation.recoveryBytes ?? 0;
			if (operation.reference !== undefined && operation.conflict !== undefined) { this.#conflicts.set(operation.reference, operation.conflict); this.#authoritativeContent.set(operation.reference, cloneContentState(operation.conflict.authoritative)); }
		}
		this.#projection = this.#deriveProjection();
		if (options.authorization) this._register(options.authorization.onDidChange(() => this.#publish()));
	}
	observe(): WorkspaceObservation { this.#assertLive(); return Object.freeze({ current: this.#projection, onDidChange: this.#onDidChange }); }
	async read(request: WorkspaceRead): Promise<WorkspaceReadResult> {
		this.#assertLive(); const reference = this.#resolveReference(request.reference);
		if (!this.#currentAccess().read) throw new Error('Current Workspace access does not permit content reads');
		if (request.version !== undefined && request.version !== 'current') return this.#readConflict(request.reference, request.version);
		const entry = this.#projection.entries.find(candidate => candidate.reference === reference || candidate.reference === request.reference); if (entry?.kind !== 'file') throw new Error('Workspace file is unavailable');
		const local = this.#workingContentRead(request.reference); if (local !== undefined) return local;
		const startedGeneration = this.#generation; const startedCursor = this.#snapshot.cursor;
		const result = await this.#options.authority.readCurrent(reference);
		this.#assertLive(); if (!this.#currentAccess().read) throw new Error('Current Workspace access does not permit content reads'); const currentReference = this.#resolveReference(request.reference); const currentLocal = this.#workingContentRead(request.reference); if (currentLocal !== undefined) return currentLocal;
		const currentEntry = this.#projection.entries.find(candidate => candidate.reference === currentReference || candidate.reference === request.reference); if (currentEntry?.kind !== 'file') throw new Error('Workspace file is unavailable');
		if (currentReference !== reference || (startedGeneration !== this.#generation || startedCursor !== this.#snapshot.cursor) && currentEntry.contentVersion !== result.contentVersion) return this.read(request);
		const content = copyBytes(result.content); this.#authoritativeContent.set(currentReference, Object.freeze({ content: copyBytes(content), contentVersion: result.contentVersion, mediaType: result.mediaType })); return Object.freeze({ reference: currentReference, content, contentVersion: result.contentVersion, mediaType: result.mediaType, byteSize: content.byteLength, source: 'authoritative' });
	}
	change(intent: Exclude<WorkspaceChange, { readonly kind: 'discard' | 'resolveConflict' }>): WorkspaceChangeResult {
		this.#assertLive();
		const validation = this.#validateChange(intent); if (validation !== undefined) return validation;
		const pathConflict = intent.kind === 'move' ? this.#pathConflictFor(intent.reference) : undefined;
		if (pathConflict !== undefined && this.#hasPendingPathConflictResolution(pathConflict)) return reject('unsupported', 'A path-conflict resolution is already pending; settle it before choosing another destination.');
		if (pathConflict !== undefined && (pathConflict.intent.kind === 'createDirectory' || pathConflict.intent.kind === 'createFile') && !this.#currentAccess()[pathConflict.intent.kind]) return reject('accessDenied', 'Current Workspace access does not permit creation at the authorized conflict-resolution path.');
		const resolvedIntent = pathConflict?.intent.kind === 'createDirectory' ? { kind: 'createDirectory' as const, path: intent.kind === 'move' ? intent.destination : pathConflict.intent.path } : pathConflict?.intent.kind === 'createFile' ? { kind: 'createFile' as const, path: intent.kind === 'move' ? intent.destination : pathConflict.intent.path, content: copyBytes(pathConflict.intent.content), mediaType: pathConflict.intent.mediaType } : intent;
		if (pathConflict !== undefined && (resolvedIntent.kind === 'createDirectory' || resolvedIntent.kind === 'createFile')) { const resolutionValidation = this.#validateTranslatedPathResolution(resolvedIntent, pathConflict); if (resolutionValidation !== undefined) return resolutionValidation; }
		const generation = ++this.#generation as WorkspaceViewGeneration;
		let reference: WorkspaceEntryReference | undefined;
		if (intent.kind === 'createDirectory' || intent.kind === 'createFile') reference = this.#options.ids.nextLocalReference(); else reference = intent.reference;
		const base = intent.kind === 'replaceContent' ? this.#contentStateFor(intent.reference) : undefined;
		const baseEntry = 'reference' in intent ? pathConflict?.intent.kind === 'move' ? this.#snapshot.entries.find(entry => entry.reference === this.#resolveReference(intent.reference)) : pathConflict === undefined ? this.#projection.entries.find(entry => entry.reference === intent.reference || entry.reference === this.#resolveReference(intent.reference)) : undefined : undefined;
		const operation: LocalOperation = { generation, intent: normalizeIntent(resolvedIntent), idempotencyKey: this.#options.ids.nextIdempotencyKey(), reference, state: 'queued', recovery: 'pending', recoveryStorageId: this.#options.ids.recoveryStorageId(reference, generation), ...(base === undefined ? {} : { base }), ...(baseEntry === undefined ? {} : { baseEntry: cloneEntry(baseEntry) }), ...(pathConflict === undefined ? {} : { resolvesConflictStorageId: pathConflict.recoveryStorageId, resolvesConflict: pathConflict }) };
		this.#operations.push(operation); this.#publish(); return Object.freeze({ accepted: true, generation, ...(reference === undefined ? {} : { reference }) });
	}
	discard(reference: WorkspaceEntryReference): Promise<WorkspaceChangeResult> { this.#assertLive(); return this.#enqueueState(() => this.#discard(reference)); }
	resolveConflict(reference: WorkspaceEntryReference, resolution: Extract<WorkspaceChange, { readonly kind: 'resolveConflict' }>['resolution']): Promise<WorkspaceChangeResult> { this.#assertLive(); return this.#enqueueState(() => this.#resolveConflict(reference, resolution)); }
	settle(request: WorkspaceSettlement): Promise<WorkspaceSettlementResult> {
		this.#assertLive(); if (!Number.isSafeInteger(request.throughGeneration) || request.throughGeneration < 0 || request.throughGeneration > this.#generation) throw new RangeError('Settlement generation is outside the current Workspace View');
		return this.#enqueueState(() => this.#settle(request));
	}
	async #settle(request: WorkspaceSettlement): Promise<WorkspaceSettlementResult> {
		const requestCancellation = request.cancellation ?? CancellationToken.None;
		const cancellation = new CancellationTokenSource(requestCancellation); if (requestCancellation.isCancellationRequested) cancellation.cancel();
		const lifecycleListener = this.#lifecycleCancellation.token.onCancellationRequested(() => cancellation.cancel());
		try {
			if (request.kind === 'protect' || request.kind === 'controlledClose' || request.kind === 'persist') { await this.#protectThrough(request.throughGeneration); this.#assertLive(); }
			if (request.kind === 'reconcile') { await this.#reconcileThrough(request.throughGeneration); this.#assertLive(); }
			if (request.kind === 'persist') { await this.#reconcileUnknown(request.throughGeneration); this.#assertLive(); await this.#persistThrough(request.throughGeneration, cancellation.token); this.#assertLive(); }
			const blockers = this.#blockers(request.throughGeneration);
			const protectedState = this.#operations.filter(operation => operation.generation <= request.throughGeneration && !isFinished(operation.state)).every(operation => operation.recovery === 'protected');
			const acknowledged = blockers.length === 0;
			return Object.freeze({ kind: request.kind, throughGeneration: request.throughGeneration, protected: protectedState, acknowledged, ...(acknowledged ? { cursor: this.#snapshot.cursor } : {}), blockers: Object.freeze(blockers) });
		} finally { lifecycleListener.dispose(); cancellation.dispose(); }
	}
	async #protectThrough(generation: WorkspaceViewGeneration): Promise<void> {
		await this.#retryRetainedAcknowledgements(); this.#assertLive();
		for (const operation of this.#operations) {
			if (operation.generation > generation || isFinished(operation.state) || operation.recovery === 'protected') continue;
			try { const record = this.#recoveryRecord(operation); const recoveryBytes = this.#assertRecoveryEnvelope(operation, record); await this.#options.protectedContent.putRecovery(record); this.#assertLive(); operation.recovery = 'protected'; this.#setRecoveryBytes(operation, recoveryBytes); this.#protectedContentWritable = true; }
			catch (error) { if (this.#disposed) throw error; operation.recovery = 'failed'; this.#protectedContentWritable = false; }
		}
		this.#publish();
	}
	async #persistThrough(generation: WorkspaceViewGeneration, cancellation: CancellationToken): Promise<void> {
		const attempted = new Set<LocalOperation>();
		while (true) {
			const pending = this.#operations.filter(operation => operation.generation <= generation && operation.state === 'queued' && !attempted.has(operation));
			if (pending.length === 0 || cancellation.isCancellationRequested) return;
			const batch: LocalOperation[] = [];
			for (const operation of pending) {
				if (batch.length === 4) break;
				if (this.#hasEarlierOverlappingUnfinished(operation)) continue;
				if (operation.recovery !== 'protected' && this.#requiresProtectedBridge(operation)) continue;
				if (batch.every(other => !scopesOverlap(this.#operationScopes(operation), this.#operationScopes(other)))) batch.push(operation);
			}
			if (batch.length === 0) return;
			for (const operation of batch) attempted.add(operation);
			await Promise.all(batch.map(operation => this.#dispatch(operation, cancellation))); this.#assertLive();
		}
	}
	async #dispatch(operation: LocalOperation, cancellation: CancellationToken): Promise<void> {
		if (cancellation.isCancellationRequested) return; this.#assertLive();
		if (!this.#currentAccess()[operation.intent.kind]) return;
		let command: WorkspaceMutationCommand;
		try { command = operation.dispatchedCommand ?? { ...this.#compileCommand(operation), replayUntil: Date.now() + 23 * 60 * 60 * 1000 }; operation.dispatchedCommand = command; }
		catch { operation.state = 'rejected'; operation.rejection = 'invalidCommand'; await this.#syncProtectedRecovery(operation); this.#publish(); return; }
		const hadProtectedRecovery = operation.recoveryBytes !== undefined;
		operation.state = 'inFlight'; await this.#syncProtectedRecovery(operation); this.#assertLive(); if (!this.#currentAccess()[operation.intent.kind] || cancellation.isCancellationRequested || operation.recovery === 'failed' && (hadProtectedRecovery || this.#requiresProtectedBridge(operation))) { operation.state = 'queued'; this.#publish(); return; } this.#publish();
		let result: WorkspaceMutationResult;
		try { result = await this.#options.authority.dispatch(command, cancellation); }
		catch (error) { if (this.#disposed) throw error; this.#authorityWritable = false; result = { kind: 'outcomeUnknown' }; }
		this.#assertLive();
		await this.#applyMutationResult(operation, result); this.#assertLive();
	}
	async #applyMutationResult(operation: LocalOperation, result: WorkspaceMutationResult): Promise<void> {
		this.#assertLive();
		switch (result.kind) {
			case 'acknowledged': {
				const hadProtectedRecovery = operation.recovery === 'protected'; operation.state = 'acknowledged'; this.#authorityWritable = true; this.#adoptSnapshot(result.snapshot);
				if (hadProtectedRecovery) operation.retainedForDependencies = true;
				for (const [local, stable] of Object.entries(result.referenceMappings ?? {})) { this.#referenceMappings.set(local as WorkspaceEntryReference, stable); this.#rebaseMappedReferences(local as WorkspaceEntryReference, stable); }
				this.#rememberAcknowledgedContent(operation, result.acknowledgedEntry === undefined ? result.snapshot : { ...result.snapshot, entries: [result.acknowledgedEntry] });
				this.#advanceDependentContentBase(operation, result.acknowledgedEntry === undefined ? result.snapshot : { ...result.snapshot, entries: [result.acknowledgedEntry] });
				const dependentsDurable = await this.#rewriteDependentRecovery(operation); this.#assertLive();
				if (!hadProtectedRecovery) operation.recovery = 'notRequired';
				if (operation.resolvesConflict !== undefined) { operation.resolvesConflict.state = 'discarded'; operation.resolvesConflict.retainedForDependencies = operation.resolvesConflict.recoveryBytes !== undefined; }
				if (operation.resolvesConflictStorageId !== undefined && operation.reference !== undefined) this.#conflicts.delete(operation.reference);
				if (dependentsDurable) { await this.#retireAcknowledgedRecovery(operation); this.#assertLive(); }
				await this.#retryRetainedAcknowledgements(operation); this.#assertLive();
				break;
			}
			case 'conflicted': this.#authorityWritable = true; await this.#handleConflict(operation, result); this.#assertLive(); break;
			case 'rejected': case 'invalidCommand': this.#authorityWritable = true; operation.state = 'rejected'; operation.rejection = result.kind === 'rejected' ? result.code : result.kind; break;
			case 'outcomeUnknown': operation.state = 'outcomeUnknown'; break;
			case 'notDispatched': operation.state = 'queued'; break;
			case 'transportUnavailable': this.#authorityWritable = false; operation.state = 'queued'; break;
		}
		await this.#syncProtectedRecovery(operation); this.#assertLive();
		this.#compactFinishedOperations();
		this.#publish();
	}
	async #handleConflict(operation: LocalOperation, result: Extract<WorkspaceMutationResult, { kind: 'conflicted' }>): Promise<void> {
		operation.state = 'conflicted'; operation.rejection = result.conflict; if (result.snapshot !== undefined) this.#adoptSnapshot(result.snapshot);
		if (result.conflict !== 'advancedContent' || operation.intent.kind !== 'replaceContent' || operation.base === undefined || operation.reference === undefined) return;
		let authoritativeRead;
		try { authoritativeRead = await this.#options.authority.readCurrent(this.#resolveReference(operation.reference)); this.#assertLive(); } catch (error) { if (this.#disposed) throw error; operation.state = 'conflictPending'; return; }
		const authoritative: ContentState = Object.freeze({ content: copyBytes(authoritativeRead.content), contentVersion: authoritativeRead.contentVersion, mediaType: authoritativeRead.mediaType });
		const local: ContentState = Object.freeze({ content: copyBytes(operation.intent.content), contentVersion: `local:${operation.generation}` as WorkspaceContentVersion, mediaType: operation.intent.mediaType });
		const base = cloneContentState(operation.base); const conflict = Object.freeze({ authoritative, base, local }); operation.conflict = conflict; this.#authoritativeContent.set(authoritativeRead.reference, cloneContentState(authoritative)); this.#conflicts.set(operation.reference, conflict);
		const baseText = decodeTextContent(base.content, base.mediaType); const localText = decodeTextContent(local.content, local.mediaType); const authoritativeText = decodeTextContent(authoritative.content, authoritative.mediaType);
		if (baseText === undefined || localText === undefined || authoritativeText === undefined) return;
		const merged = mergeNonOverlappingText(baseText, localText, authoritativeText); if (merged.kind === 'overlap') return;
		if (merged.value === authoritativeText) { try { await this.#options.protectedContent.deleteRecovery(operation.recoveryStorageId); this.#assertLive(); operation.state = 'discarded'; operation.recovery = 'notRequired'; this.#setRecoveryBytes(operation, undefined); this.#conflicts.delete(operation.reference); this.#compactFinishedOperations(); } catch (error) { if (this.#disposed) throw error; this.#protectedContentWritable = false; } return; }
		const content = new TextEncoder().encode(merged.value); const intent = { kind: 'replaceContent' as const, reference: this.#resolveReference(operation.reference), content, mediaType: local.mediaType }; if (this.#validateChange(intent) !== undefined) return;
		const generation = ++this.#generation as WorkspaceViewGeneration;
		this.#operations.push({ generation, intent, idempotencyKey: this.#options.ids.nextIdempotencyKey(), reference: operation.reference, state: 'queued', recovery: 'pending', recoveryStorageId: this.#options.ids.recoveryStorageId(operation.reference, generation), base: authoritative, baseEntry: this.#snapshot.entries.find(entry => entry.reference === intent.reference), resolvesConflictStorageId: operation.recoveryStorageId, resolvesConflict: operation });
	}
	async #reconcileUnknown(generation: WorkspaceViewGeneration): Promise<void> {
		for (const operation of this.#operations.filter(value => value.generation <= generation && (value.state === 'outcomeUnknown' || value.state === 'conflictPending'))) {
			const result = await this.#options.authority.lookupResult(operation.idempotencyKey, operation.dispatchedCommand); this.#assertLive(); if (result !== undefined) { await this.#applyMutationResult(operation, result); this.#assertLive(); }
		}
	}
	async #reconcileThrough(generation: WorkspaceViewGeneration): Promise<void> {
		await this.#reconcileUnknown(generation); this.#assertLive(); const cursor = this.#snapshot.cursor; const feed = await this.#options.authority.changesAfter(cursor); this.#assertLive();
		if (feed.kind === 'changes' && feed.from === cursor && feed.to >= feed.from && feed.snapshot.cursor === feed.to) this.#adoptSnapshot(feed.snapshot); else { const snapshot = await this.#options.authority.getSnapshot(); this.#assertLive(); this.#adoptSnapshot(snapshot); }
		this.#publish();
	}
	async #discard(reference: WorkspaceEntryReference): Promise<WorkspaceChangeResult> {
		const resolved = this.#resolveReference(reference); const affected = this.#operations.filter(operation => !isFinished(operation.state) && operation.reference !== undefined && (operation.reference === reference || this.#resolveReference(operation.reference) === resolved));
		if (affected.length === 0) return reject('invalidReference', 'No working change exists for this reference.');
		if (affected.some(operation => operation.state === 'inFlight' || operation.state === 'outcomeUnknown')) return reject('unsupported', 'Reconcile in-flight or uncertain work before discard.');
		try { for (const operation of affected) { await this.#options.protectedContent.deleteRecovery(operation.recoveryStorageId); this.#assertLive(); } }
		catch (error) { if (this.#disposed) throw error; for (const operation of affected) if (operation.recovery === 'protected') { try { await this.#options.protectedContent.putRecovery(this.#recoveryRecord(operation)); this.#assertLive(); } catch (restoreError) { if (this.#disposed) throw restoreError; operation.recovery = 'failed'; } } this.#publish(); return reject('durabilityUnavailable', 'Protected recovery could not be removed; the working change remains active.'); }
		const generation = ++this.#generation as WorkspaceViewGeneration; for (const operation of affected) { operation.state = 'discarded'; operation.recovery = 'notRequired'; this.#setRecoveryBytes(operation, undefined); } this.#conflicts.delete(reference); this.#compactFinishedOperations(); this.#publish(); return Object.freeze({ accepted: true, generation, reference });
	}
	async #resolveConflict(reference: WorkspaceEntryReference, resolution: 'authoritative' | 'local' | { readonly content: Uint8Array; readonly mediaType: string }): Promise<WorkspaceChangeResult> {
		const resolved = this.#resolveReference(reference); const conflicted = [...this.#operations].reverse().find(operation => operation.reference !== undefined && (operation.reference === reference || this.#resolveReference(operation.reference) === resolved) && operation.state === 'conflicted'); if (conflicted === undefined) return reject('invalidReference', 'No conflict exists for this reference.');
		if (resolution === 'authoritative') return this.#discard(reference);
		const content = resolution === 'local' && (conflicted.intent.kind === 'replaceContent' || conflicted.intent.kind === 'createFile') ? conflicted.intent.content : typeof resolution === 'object' ? resolution.content : undefined; const mediaType = resolution === 'local' && (conflicted.intent.kind === 'replaceContent' || conflicted.intent.kind === 'createFile') ? conflicted.intent.mediaType : typeof resolution === 'object' ? resolution.mediaType : undefined;
		if (content === undefined || mediaType === undefined) return reject('unsupported', 'This conflict requires explicit content.');
		const conflict = this.#conflicts.get(reference) ?? this.#conflicts.get(resolved); if (conflict === undefined) return reject('unsupported', 'This conflict cannot replace content at the current authoritative entry.');
		const intent = { kind: 'replaceContent' as const, reference: resolved, content, mediaType }; const validation = this.#validateChange(intent); if (validation !== undefined) return validation;
		const generation = ++this.#generation as WorkspaceViewGeneration;
		const operation: LocalOperation = { generation, intent: { ...intent, content: copyBytes(content) }, idempotencyKey: this.#options.ids.nextIdempotencyKey(), reference, state: 'queued', recovery: 'pending', recoveryStorageId: this.#options.ids.recoveryStorageId(reference, generation), base: cloneContentState(conflict.authoritative), baseEntry: this.#snapshot.entries.find(entry => entry.reference === this.#resolveReference(reference)), resolvesConflictStorageId: conflicted.recoveryStorageId, resolvesConflict: conflicted }; this.#operations.push(operation); this.#publish(); return Object.freeze({ accepted: true, generation, reference });
	}
	#validateChange(intent: Exclude<WorkspaceChange, { readonly kind: 'discard' | 'resolveConflict' }>): WorkspaceChangeResult | undefined {
		const access = this.#currentAccess();
		if (!this.#authorityWritable && !this.#protectedContentWritable) return reject('durabilityUnavailable', 'Neither server persistence nor protected recovery can currently accept new work.');
		if (!access[intent.kind]) return reject('accessDenied', 'Current Workspace access does not permit this change.');
		try { if (intent.kind === 'createDirectory' || intent.kind === 'createFile') workspacePath(intent.path); else if (intent.kind === 'move') workspacePath(intent.destination); } catch { return reject('invalidPath', 'Workspace paths must be case-sensitive POSIX-relative paths.'); }
		const originalReference = 'reference' in intent ? intent.reference : undefined;
		const resolvedReference = originalReference === undefined ? undefined : this.#resolveReference(originalReference);
		if (originalReference !== undefined && resolvedReference !== undefined && this.#projection.entries.every(entry => entry.reference !== originalReference && entry.reference !== resolvedReference)) return reject('invalidReference', 'Workspace entry reference is not current.');
		if ((intent.kind === 'createDirectory' || intent.kind === 'createFile') && this.#projection.entries.length >= this.#options.limits.effectiveEntries) return reject('sizeLimit', 'Change exceeds the effective Workspace entry limit.');
		if (intent.kind === 'delete') { const target = this.#projection.entries.find(entry => entry.reference === resolvedReference); if (target?.kind === 'file' && intent.recursive) return reject('unsupported', 'Recursive deletion requires a directory.'); if (target?.kind === 'directory' && !intent.recursive && this.#projection.entries.some(entry => entry.path.startsWith(`${target.path}/`))) return reject('unsupported', 'Directory is not empty.'); }
		if (intent.kind === 'createFile' || intent.kind === 'replaceContent') {
			if (intent.content.byteLength > this.#options.limits.effectiveFileBytes) return reject('sizeLimit', 'File exceeds the effective Workspace file limit.');
			const replaced = intent.kind === 'replaceContent' ? this.#projection.entries.find(entry => entry.reference === intent.reference || entry.reference === resolvedReference)?.byteSize ?? 0 : 0; const total = this.#projection.entries.reduce((sum, entry) => sum + (entry.byteSize ?? 0), 0) - replaced + intent.content.byteLength; if (total > this.#options.limits.effectiveTotalBytes) return reject('sizeLimit', 'Change exceeds the effective Workspace total limit.');
			if (intent.kind === 'replaceContent' && this.#contentStateFor(intent.reference) === undefined) return reject('durabilityUnavailable', 'Read current file content before replacing it so conflicts can preserve the exact base.');
		}
		return undefined;
	}
	#validateTranslatedPathResolution(intent: Extract<WorkspaceChange, { readonly kind: 'createDirectory' | 'createFile' }>, conflict: LocalOperation): WorkspaceChangeResult | undefined {
		if (intent.kind === 'createFile' && intent.content.byteLength > this.#options.limits.effectiveFileBytes) return reject('sizeLimit', 'File exceeds the effective Workspace file limit.');
		const reference = conflict.reference; if (reference === undefined) return reject('invalidReference', 'Workspace conflict no longer identifies a current entry.');
		const entries = new WorkspaceOverlayIndex(this.#snapshot.entries);
		for (const operation of this.#operations) if (!isFinished(operation.state)) entries.apply(operation, candidate => this.#resolveReference(candidate));
		entries.apply({ generation: (this.#generation + 1) as WorkspaceViewGeneration, intent, idempotencyKey: '', reference, state: 'queued', recovery: 'pending', recoveryStorageId: '' }, candidate => this.#resolveReference(candidate));
		const total = entries.values().reduce((sum, entry) => sum + (entry.byteSize ?? 0), 0);
		return total > this.#options.limits.effectiveTotalBytes ? reject('sizeLimit', 'Change exceeds the effective Workspace total limit.') : undefined;
	}
	#compileCommand(operation: LocalOperation): WorkspaceMutationCommand {
		const intent = operation.intent;
		if (intent.kind === 'createDirectory') return { kind: intent.kind, idempotencyKey: operation.idempotencyKey, path: workspacePath(intent.path), expectDestinationAbsent: true, localReference: operation.reference as WorkspaceEntryReference };
		if (intent.kind === 'createFile') return { kind: intent.kind, idempotencyKey: operation.idempotencyKey, path: workspacePath(intent.path), content: copyBytes(intent.content), mediaType: intent.mediaType, expectDestinationAbsent: true, localReference: operation.reference as WorkspaceEntryReference };
		const reference = this.#resolveReference(intent.reference); const entry = this.#snapshot.entries.find(candidate => candidate.reference === reference);
		if (intent.kind === 'replaceContent') { const expectedPath = operation.baseEntry?.path; if (expectedPath === undefined) throw new Error('Replace command lacks its exact accepted path'); const expectedContentVersion = operation.base?.contentVersion; if (expectedContentVersion === undefined || String(expectedContentVersion).startsWith('local:')) throw new Error('Replace command lacks its exact authoritative base version'); return { kind: intent.kind, idempotencyKey: operation.idempotencyKey, reference, content: copyBytes(intent.content), mediaType: intent.mediaType, expectedPath, expectedContentVersion }; }
		if (intent.kind === 'move') { const currentPath = operation.baseEntry?.path; if (currentPath === undefined) throw new Error('Move command lacks its exact accepted path'); return { kind: intent.kind, idempotencyKey: operation.idempotencyKey, reference, currentPath, destination: workspacePath(intent.destination), expectDestinationAbsent: true }; }
		const expectedEntry = operation.baseEntry ?? entry; if (expectedEntry === undefined) throw new Error('Delete command lacks its exact accepted entry'); return { kind: intent.kind, idempotencyKey: operation.idempotencyKey, reference, expectedPath: expectedEntry.path, ...(intent.recursive === true ? { recursive: true, expectedWorkspaceCursor: this.#snapshot.cursor } : {}), ...(expectedEntry.contentVersion === undefined ? {} : { expectedContentVersion: expectedEntry.contentVersion }) };
	}
	#recoveryRecord(operation: LocalOperation): RecoveryRecord { const snapshotEntry = operation.reference === undefined ? undefined : this.#snapshot.entries.find(candidate => candidate.reference === this.#resolveReference(operation.reference as WorkspaceEntryReference)); const entry = operation.baseEntry ?? snapshotEntry; const baseContentVersion = operation.base?.contentVersion ?? entry?.contentVersion; const content = operation.intent.kind === 'createFile' || operation.intent.kind === 'replaceContent' ? copyBytes(operation.intent.content) : undefined; const operationState = operation.state === 'inFlight' ? 'outcomeUnknown' : operation.state === 'conflicted' || operation.state === 'conflictPending' || operation.state === 'outcomeUnknown' || operation.state === 'rejected' ? operation.state : 'queued'; const resolvesConflictStorageId = operation.resolvesConflict?.recoveryStorageId ?? operation.resolvesConflictStorageId; const conflict = resolvesConflictStorageId === undefined ? operation.conflict ?? (operation.reference === undefined ? undefined : this.#conflicts.get(operation.reference) ?? this.#conflicts.get(this.#resolveReference(operation.reference))) : undefined; return { storageId: operation.recoveryStorageId, generation: operation.generation, reference: operation.reference as WorkspaceEntryReference, operationState, ...(operation.rejection === undefined ? {} : { rejection: operation.rejection }), ...(entry === undefined ? {} : { basePath: entry.path, baseKind: entry.kind }), ...(baseContentVersion === undefined ? {} : { baseContentVersion }), ...(operation.base === undefined ? {} : { baseContent: copyBytes(operation.base.content), baseMediaType: operation.base.mediaType }), ...(conflict === undefined ? {} : { conflictAuthoritativeContentVersion: conflict.authoritative.contentVersion, conflictAuthoritativeContent: copyBytes(conflict.authoritative.content), conflictAuthoritativeMediaType: conflict.authoritative.mediaType }), ...(resolvesConflictStorageId === undefined ? {} : { resolvesConflictStorageId }), ...(content === undefined ? {} : { content }), idempotencyKey: operation.idempotencyKey, ...(operation.dispatchedCommand === undefined ? {} : { dispatchedCommand: cloneCommand(operation.dispatchedCommand) }), mutation: normalizeIntent(operation.intent) }; }
	#adoptSnapshot(snapshot: AuthoritativeWorkspaceSnapshot): void { if (snapshot.cursor < this.#snapshot.cursor) return; this.#snapshot = cloneSnapshot(snapshot); this.#authorityWritable = snapshot.availability === 'online'; }
	async #syncProtectedRecovery(operation: LocalOperation): Promise<void> {
		if (operation.recovery !== 'protected' || isFinished(operation.state)) return;
		try { const record = this.#recoveryRecord(operation); const recoveryBytes = this.#assertRecoveryEnvelope(operation, record); await this.#options.protectedContent.putRecovery(record); this.#assertLive(); this.#setRecoveryBytes(operation, recoveryBytes); this.#protectedContentWritable = true; }
		catch (error) { if (this.#disposed) throw error; operation.recovery = 'failed'; this.#protectedContentWritable = false; }
	}
	#assertRecoveryEnvelope(candidate: LocalOperation, record: RecoveryRecord): number { const candidateBytes = validateRecoveryRecordBytes(record, this.#options.limits); const retainedBytes = this.#retainedRecoveryBytes - (candidate.recoveryBytes ?? 0) + candidateBytes; if (retainedBytes > WORKSPACE_V1_MAX_RECOVERY_RESTORE_BYTES) throw new RangeError('Protected Workspace recovery exceeds the packaged restore safety limit'); return candidateBytes; }
	#setRecoveryBytes(operation: LocalOperation, bytes: number | undefined): void { this.#retainedRecoveryBytes -= operation.recoveryBytes ?? 0; operation.recoveryBytes = bytes; this.#retainedRecoveryBytes += bytes ?? 0; if (this.#retainedRecoveryBytes < 0) throw new Error('Protected Workspace recovery byte accounting is inconsistent'); }
	#deriveProjection(): WorkspaceProjection {
		const entries = new WorkspaceOverlayIndex(this.#snapshot.entries);
		const facts = new Map<WorkspaceEntryReference, WorkspaceStateFacts>();
		for (const operation of this.#operations) {
			if (isFinished(operation.state)) continue;
			const affected = entries.affectedReferences(operation, reference => this.#resolveReference(reference));
			entries.apply(operation, reference => this.#resolveReference(reference));
			for (const reference of affected) {
				if (!entries.has(reference)) continue;
				const previous = facts.get(reference) ?? UNCHANGED_WORKSPACE_FACTS;
				facts.set(reference, combineWorkspaceFacts(previous, operation));
			}
		}
		const projected = entries.values().sort((left, right) => left.path.localeCompare(right.path)).map(entry => Object.freeze({ ...entry, facts: facts.get(entry.reference) ?? UNCHANGED_WORKSPACE_FACTS }));
		return Object.freeze({ generation: this.#generation as WorkspaceViewGeneration, cursor: this.#snapshot.cursor, entries: Object.freeze(projected), availability: this.#snapshot.availability, access: this.#currentAccess() });
	}
	#blockers(generation: WorkspaceViewGeneration): WorkspaceSettlementBlocker[] {
		const blockers: WorkspaceSettlementBlocker[] = []; for (const operation of this.#operations) { if (operation.generation > generation || isFinished(operation.state)) continue; if (operation.recovery === 'failed') blockers.push(Object.freeze({ generation: operation.generation, kind: 'protectionFailed', ...(operation.reference === undefined ? {} : { reference: operation.reference }) })); const kind = operation.state === 'conflicted' || operation.state === 'conflictPending' ? 'conflicted' : operation.state === 'rejected' ? 'rejected' : operation.state === 'outcomeUnknown' ? 'outcomeUnknown' : operation.state === 'inFlight' ? 'inFlight' : 'queued'; blockers.push(Object.freeze({ generation: operation.generation, kind, ...(operation.reference === undefined ? {} : { reference: operation.reference }) })); } return blockers;
	}
	#operationScopes(operation: LocalOperation): readonly (WorkspaceEntryReference | WorkspacePath)[] { const intent = operation.intent; const scopes: (WorkspaceEntryReference | WorkspacePath)[] = []; if (operation.reference !== undefined) { const resolved = this.#resolveReference(operation.reference); scopes.push(resolved); const entry = this.#snapshot.entries.find(candidate => candidate.reference === resolved) ?? this.#projection.entries.find(candidate => candidate.reference === resolved || candidate.reference === operation.reference); if (entry !== undefined) scopes.push(entry.path); } if (intent.kind === 'createDirectory' || intent.kind === 'createFile') scopes.push(workspacePath(intent.path)); if (intent.kind === 'move') scopes.push(workspacePath(intent.destination)); return scopes; }
	#hasEarlierOverlappingUnfinished(operation: LocalOperation): boolean { return this.#operations.some(other => other.generation < operation.generation && !isFinished(other.state) && other.state !== 'rejected' && other.state !== 'conflicted' && scopesOverlap(this.#operationScopes(operation), this.#operationScopes(other))); }
	#pathConflictFor(reference: WorkspaceEntryReference): LocalOperation | undefined { const resolved = this.#resolveReference(reference); return [...this.#operations].reverse().find(operation => operation.state === 'conflicted' && operation.reference !== undefined && (operation.reference === reference || this.#resolveReference(operation.reference) === resolved) && (operation.rejection === 'localCreationCollision' && (operation.intent.kind === 'createDirectory' || operation.intent.kind === 'createFile') || (operation.rejection === 'destinationCollision' || operation.rejection === 'incompatibleSubtreeMove') && operation.intent.kind === 'move')); }
	#hasPendingPathConflictResolution(conflict: LocalOperation): boolean { return this.#operations.some(operation => (operation.state === 'queued' || operation.state === 'inFlight' || operation.state === 'outcomeUnknown' || operation.state === 'conflictPending') && (operation.resolvesConflict === conflict || operation.resolvesConflictStorageId === conflict.recoveryStorageId)); }
	#hasProtectedDependent(operation: LocalOperation): boolean { if (operation.reference === undefined) return false; const reference = this.#resolveReference(operation.reference); return this.#operations.some(dependent => dependent.generation > operation.generation && !isFinished(dependent.state) && dependent.reference !== undefined && this.#resolveReference(dependent.reference) === reference && dependent.recoveryBytes !== undefined); }
	#requiresProtectedBridge(operation: LocalOperation): boolean { return this.#hasProtectedDependent(operation) || operation.resolvesConflict?.recoveryBytes !== undefined; }
	#latestContentOperation(reference: WorkspaceEntryReference): LocalOperation | undefined { const resolved = this.#resolveReference(reference); return [...this.#operations].reverse().find(operation => !isFinished(operation.state) && operation.reference !== undefined && (operation.reference === reference || this.#resolveReference(operation.reference) === resolved) && (operation.intent.kind === 'createFile' || operation.intent.kind === 'replaceContent')); }
	#workingContentRead(reference: WorkspaceEntryReference): WorkspaceReadResult | undefined { const local = this.#latestContentOperation(reference); if (local === undefined || (local.intent.kind !== 'createFile' && local.intent.kind !== 'replaceContent')) return undefined; const content = copyBytes(local.intent.content); return Object.freeze({ reference, content, contentVersion: `local:${local.generation}` as WorkspaceContentVersion, mediaType: local.intent.mediaType, byteSize: content.byteLength, source: 'workingOverlay' }); }
	#contentStateFor(reference: WorkspaceEntryReference): ContentState | undefined {
		const local = this.#latestContentOperation(reference); if (local !== undefined && (local.intent.kind === 'createFile' || local.intent.kind === 'replaceContent')) return Object.freeze({ content: copyBytes(local.intent.content), contentVersion: `local:${local.generation}` as WorkspaceContentVersion, mediaType: local.intent.mediaType });
		const resolved = this.#resolveReference(reference); const entry = this.#snapshot.entries.find(candidate => candidate.reference === resolved); const cached = this.#authoritativeContent.get(resolved); return entry?.contentVersion !== undefined && cached?.contentVersion === entry.contentVersion ? cloneContentState(cached) : undefined;
	}
	#readConflict(reference: WorkspaceEntryReference, version: Exclude<NonNullable<WorkspaceRead['version']>, 'current'>): WorkspaceReadResult {
		const conflict = this.#conflicts.get(reference) ?? this.#conflicts.get(this.#resolveReference(reference)); if (conflict === undefined) throw new Error('Workspace conflict content is unavailable'); const value = version === 'conflictBase' ? conflict.base : version === 'conflictLocal' ? conflict.local : conflict.authoritative; const content = copyBytes(value.content); return Object.freeze({ reference, content, contentVersion: value.contentVersion, mediaType: value.mediaType, byteSize: content.byteLength, source: version });
	}
	#rememberAcknowledgedContent(operation: LocalOperation, acknowledgedSnapshot: AuthoritativeWorkspaceSnapshot): void {
		if (operation.reference === undefined || (operation.intent.kind !== 'createFile' && operation.intent.kind !== 'replaceContent')) return; const reference = this.#resolveReference(operation.reference); const entry = acknowledgedSnapshot.entries.find(candidate => candidate.reference === reference); if (entry?.contentVersion === undefined) return; this.#authoritativeContent.set(reference, Object.freeze({ content: copyBytes(operation.intent.content), contentVersion: entry.contentVersion, mediaType: operation.intent.mediaType }));
	}
	#advanceDependentContentBase(operation: LocalOperation, acknowledgedSnapshot: AuthoritativeWorkspaceSnapshot): void {
		if (operation.reference === undefined || (operation.intent.kind !== 'createFile' && operation.intent.kind !== 'replaceContent')) return;
		const reference = this.#resolveReference(operation.reference); const entry = acknowledgedSnapshot.entries.find(candidate => candidate.reference === reference); if (entry?.contentVersion === undefined) return;
		const localVersion = `local:${operation.generation}`; const acknowledgedBase: ContentState = Object.freeze({ content: copyBytes(operation.intent.content), contentVersion: entry.contentVersion, mediaType: operation.intent.mediaType });
		for (const dependent of this.#operations) {
			if (dependent.generation <= operation.generation || dependent.state !== 'queued' || dependent.reference === undefined || this.#resolveReference(dependent.reference) !== reference) continue;
			if (dependent.intent.kind === 'replaceContent' && dependent.base?.contentVersion === localVersion) dependent.base = cloneContentState(acknowledgedBase);
			if (dependent.baseEntry?.contentVersion === localVersion) dependent.baseEntry = cloneEntry(entry);
		}
	}
	#rebaseMappedReferences(local: WorkspaceEntryReference, stable: WorkspaceEntryReference): void {
		const acknowledged = this.#snapshot.entries.find(entry => entry.reference === stable);
		for (const operation of this.#operations) {
			if (isFinished(operation.state) || operation.reference !== local) continue;
			operation.reference = stable;
			if ('reference' in operation.intent && operation.intent.reference === local) operation.intent = Object.freeze({ ...operation.intent, reference: stable });
			if (operation.baseEntry?.reference === local) operation.baseEntry = acknowledged === undefined ? Object.freeze({ ...operation.baseEntry, reference: stable }) : cloneEntry(acknowledged);
		}
	}
	async #rewriteDependentRecovery(operation: LocalOperation): Promise<boolean> {
		if (operation.reference === undefined) return true; const reference = this.#resolveReference(operation.reference); let durable = true;
		for (const dependent of this.#operations) {
			if (dependent.generation <= operation.generation || isFinished(dependent.state) || dependent.reference === undefined || this.#resolveReference(dependent.reference) !== reference || dependent.recoveryBytes === undefined) continue;
			try { const record = this.#recoveryRecord(dependent); const recoveryBytes = this.#assertRecoveryEnvelope(dependent, record); await this.#options.protectedContent.putRecovery(record); this.#assertLive(); dependent.recovery = 'protected'; this.#setRecoveryBytes(dependent, recoveryBytes); this.#protectedContentWritable = true; }
			catch (error) { if (this.#disposed) throw error; durable = false; dependent.recovery = 'failed'; this.#protectedContentWritable = false; }
		}
		return durable;
	}
	async #retireAcknowledgedRecovery(operation: LocalOperation): Promise<boolean> {
		const conflictStorageId = operation.resolvesConflict?.recoveryStorageId ?? operation.resolvesConflictStorageId;
		if (conflictStorageId !== undefined) {
			try { await this.#options.protectedContent.deleteRecovery(conflictStorageId); this.#assertLive(); }
			catch (error) { if (this.#disposed) throw error; operation.retainedForDependencies = operation.recoveryBytes !== undefined; this.#protectedContentWritable = false; return false; }
			if (operation.resolvesConflict !== undefined) { operation.resolvesConflict.recovery = 'notRequired'; this.#setRecoveryBytes(operation.resolvesConflict, undefined); operation.resolvesConflict.retainedForDependencies = false; }
		}
		if (operation.recoveryBytes !== undefined) {
			try { await this.#options.protectedContent.deleteRecovery(operation.recoveryStorageId); this.#assertLive(); }
			catch (error) { if (this.#disposed) throw error; operation.retainedForDependencies = true; this.#protectedContentWritable = false; return false; }
		}
		operation.recovery = 'notRequired'; this.#setRecoveryBytes(operation, undefined); operation.retainedForDependencies = false; this.#protectedContentWritable = true; return true;
	}
	async #retryRetainedAcknowledgements(exclude?: LocalOperation): Promise<void> { for (const operation of this.#operations) { if (operation === exclude || !operation.retainedForDependencies || operation.recoveryBytes === undefined) continue; if (!await this.#rewriteDependentRecovery(operation)) { this.#assertLive(); continue; } this.#assertLive(); await this.#retireAcknowledgedRecovery(operation); this.#assertLive(); } this.#compactFinishedOperations(); }
	#compactFinishedOperations(): void { const referenced = new Set(this.#operations.filter(operation => !isFinished(operation.state)).map(operation => operation.resolvesConflict).filter((operation): operation is LocalOperation => operation !== undefined)); for (let index = this.#operations.length - 1; index >= 0; index--) { const operation = this.#operations[index] as LocalOperation; if (isFinished(operation.state) && operation.recoveryBytes === undefined && !operation.retainedForDependencies && !referenced.has(operation)) this.#operations.splice(index, 1); } }
	#resolveReference(reference: WorkspaceEntryReference): WorkspaceEntryReference { let current = reference; const seen = new Set<WorkspaceEntryReference>(); while (this.#referenceMappings.has(current) && !seen.has(current)) { seen.add(current); current = this.#referenceMappings.get(current) as WorkspaceEntryReference; } return current; }
	#enqueueState<T>(operation: () => Promise<T>): Promise<T> { const queued = this.#stateSerial.then(() => { this.#assertLive(); return operation(); }); this.#stateSerial = queued.then(() => {}, () => {}); return queued; }
	#publish(): void { if (this.#disposed) return; this.#projection = this.#deriveProjection(); this.#changeEmitter.fire(this.#projection); }
	#currentAccess(): WorkspaceAccess {
        const snapshot = this.#snapshot.access;
        const gate = this.#options.authorization?.current();
        if (!gate) return snapshot;
        return Object.freeze({ read: snapshot.read && gate.read, createDirectory: snapshot.createDirectory && gate.createDirectory, createFile: snapshot.createFile && gate.createFile, replaceContent: snapshot.replaceContent && gate.replaceContent, move: snapshot.move && gate.move, delete: snapshot.delete && gate.delete });
    }
	#assertLive(): void { if (this.#disposed) throw new Error('AttemptWorkspaceSession is disposed'); }
	override dispose(): void { if (this.#disposed) return; this.#disposed = true; this.#lifecycleCancellation.dispose(true); super.dispose(); }
}

function normalizeIntent<T extends Exclude<WorkspaceChange, { readonly kind: 'discard' | 'resolveConflict' }>>(intent: T): T { return ('content' in intent ? { ...intent, content: copyBytes(intent.content) } : { ...intent }) as T; }
function reject(code: Extract<WorkspaceChangeResult, { accepted: false }>['code'], message: string): WorkspaceChangeResult { return Object.freeze({ accepted: false, code, message }); }
function copyBytes(value: Uint8Array): Uint8Array { return new Uint8Array(value); }
function cloneContentState(value: ContentState): ContentState { return Object.freeze({ content: copyBytes(value.content), contentVersion: value.contentVersion, mediaType: value.mediaType }); }
function isFinished(state: OperationState): boolean { return state === 'acknowledged' || state === 'discarded'; }
function validateLimits(limits: WorkspaceLimits): void { if (!Number.isSafeInteger(limits.effectiveEntries) || limits.effectiveEntries < 1 || limits.effectiveEntries > WORKSPACE_V1_HARD_LIMITS.effectiveEntries || !Number.isSafeInteger(limits.effectiveFileBytes) || !Number.isSafeInteger(limits.effectiveTotalBytes) || !Number.isSafeInteger(limits.editorModelBytes) || limits.effectiveFileBytes <= 0 || limits.effectiveFileBytes > WORKSPACE_V1_HARD_LIMITS.effectiveFileBytes || limits.effectiveTotalBytes < limits.effectiveFileBytes || limits.effectiveTotalBytes > WORKSPACE_V1_HARD_LIMITS.effectiveTotalBytes || limits.editorModelBytes !== WORKSPACE_V1_HARD_LIMITS.editorModelBytes) throw new RangeError('Workspace limits exceed packaged hard maxima or editor-model policy'); }
function restoreRecoveryOperations(records: readonly RecoveryRecord[], limits: WorkspaceLimits): readonly LocalOperation[] {
	if (!Array.isArray(records) || records.length > 4096) throw new TypeError('Protected Workspace recovery is invalid');
	validateRecoveryByteEnvelope(records, limits);
	const generations = new Set<number>(); const storageIds = new Set<string>(); const idempotencyKeys = new Set<string>();
	const restored: LocalOperation[] = records.map(record => {
		if (!Number.isSafeInteger(record.generation) || record.generation <= 0 || generations.has(record.generation) || !boundedRecoveryIdentifier(record.storageId) || storageIds.has(record.storageId) || !boundedRecoveryIdentifier(record.idempotencyKey) || idempotencyKeys.has(record.idempotencyKey) || !boundedRecoveryIdentifier(record.reference) || !['conflicted', 'conflictPending', 'outcomeUnknown', 'queued', 'rejected'].includes(record.operationState) || (record.rejection !== undefined && (typeof record.rejection !== 'string' || record.rejection.length === 0 || record.rejection.length > 128))) throw new TypeError('Protected Workspace recovery identity is invalid');
		generations.add(record.generation); storageIds.add(record.storageId); idempotencyKeys.add(record.idempotencyKey);
		validateRecoveredMutation(record.mutation, record.reference, limits.effectiveFileBytes); validateRecoveredCommand(record, limits); const mutation = normalizeIntent(record.mutation);
		const mutationContent = mutation.kind === 'createFile' || mutation.kind === 'replaceContent' ? mutation.content : undefined;
		if ((mutationContent === undefined) !== (record.content === undefined) || (mutationContent !== undefined && (record.content === undefined || !equalBytes(mutationContent, record.content)))) throw new TypeError('Protected Workspace recovery content is inconsistent');
		const hasEntryBase = record.basePath !== undefined || record.baseKind !== undefined; const completeEntryBase = record.basePath !== undefined && (record.baseKind === 'directory' || record.baseKind === 'file');
		if (((mutation.kind === 'move' || mutation.kind === 'delete' || mutation.kind === 'replaceContent') && !completeEntryBase) || (hasEntryBase && !completeEntryBase)) throw new TypeError('Protected Workspace recovery entry base is incomplete');
		if (record.basePath !== undefined) workspacePath(record.basePath);
		if (record.baseContentVersion !== undefined && !boundedRecoveryIdentifier(record.baseContentVersion)) throw new TypeError('Protected Workspace recovery content version is invalid');
		const hasContentBody = record.baseContent !== undefined || record.baseMediaType !== undefined; const completeContentBase = typeof record.baseContentVersion === 'string' && record.baseContent instanceof Uint8Array && typeof record.baseMediaType === 'string' && record.baseMediaType.length > 0 && record.baseMediaType.length <= 255;
		if ((mutation.kind === 'replaceContent' && !completeContentBase) || (hasContentBody && !completeContentBase)) throw new TypeError('Protected Workspace recovery content base is incomplete');
		const base = completeContentBase ? Object.freeze({ content: copyBytes(record.baseContent as Uint8Array), contentVersion: record.baseContentVersion as WorkspaceContentVersion, mediaType: record.baseMediaType as string }) : undefined;
		const baseEntry = completeEntryBase ? Object.freeze({ reference: record.reference, path: record.basePath as WorkspacePath, kind: record.baseKind as WorkspaceEntry['kind'], ...(record.baseContentVersion === undefined ? {} : { contentVersion: record.baseContentVersion }) }) : undefined;
		const hasConflictBody = record.conflictAuthoritativeContentVersion !== undefined || record.conflictAuthoritativeContent !== undefined || record.conflictAuthoritativeMediaType !== undefined;
		const completeConflictAuthoritative = typeof record.conflictAuthoritativeContentVersion === 'string' && boundedRecoveryIdentifier(record.conflictAuthoritativeContentVersion) && record.conflictAuthoritativeContent instanceof Uint8Array && typeof record.conflictAuthoritativeMediaType === 'string' && record.conflictAuthoritativeMediaType.length > 0 && record.conflictAuthoritativeMediaType.length <= 255;
		if ((record.operationState === 'conflicted' && record.rejection === 'advancedContent' && mutation.kind === 'replaceContent' && !completeConflictAuthoritative) || (hasConflictBody && !completeConflictAuthoritative)) throw new TypeError('Protected Workspace recovery conflict content is incomplete');
		if (completeConflictAuthoritative && (mutation.kind !== 'replaceContent' || base === undefined)) throw new TypeError('Protected Workspace recovery conflict content is inconsistent');
		const conflict = completeConflictAuthoritative && mutation.kind === 'replaceContent' && base !== undefined ? Object.freeze({ authoritative: Object.freeze({ content: copyBytes(record.conflictAuthoritativeContent as Uint8Array), contentVersion: record.conflictAuthoritativeContentVersion as WorkspaceContentVersion, mediaType: record.conflictAuthoritativeMediaType as string }), base: cloneContentState(base), local: Object.freeze({ content: copyBytes(mutation.content), contentVersion: `local:${record.generation}` as WorkspaceContentVersion, mediaType: mutation.mediaType }) }) : undefined;
		if (record.resolvesConflictStorageId !== undefined && !boundedRecoveryIdentifier(record.resolvesConflictStorageId)) throw new TypeError('Protected Workspace recovery conflict relationship is invalid');
		return { generation: record.generation as WorkspaceViewGeneration, intent: mutation, idempotencyKey: record.idempotencyKey, reference: record.reference, state: record.operationState, ...(record.dispatchedCommand === undefined ? {} : { dispatchedCommand: cloneCommand(record.dispatchedCommand) }), recovery: 'protected' as const, recoveryStorageId: record.storageId, recoveryBytes: validateRecoveryRecordBytes(record, limits), ...(record.rejection === undefined ? {} : { rejection: record.rejection }), ...(base === undefined ? {} : { base }), ...(baseEntry === undefined ? {} : { baseEntry }), ...(conflict === undefined ? {} : { conflict }), ...(record.resolvesConflictStorageId === undefined ? {} : { resolvesConflictStorageId: record.resolvesConflictStorageId }) } satisfies LocalOperation;
	}).sort((left, right) => left.generation - right.generation);
	const operationsByStorage = new Map(restored.map(operation => [operation.recoveryStorageId, operation]));
	for (const operation of restored) {
		if (operation.resolvesConflictStorageId === undefined) continue;
		const conflicted = operationsByStorage.get(operation.resolvesConflictStorageId);
		if (!isConflictResolutionIntent(operation, conflicted) || (conflicted !== undefined && (conflicted.generation >= operation.generation || conflicted.state !== 'conflicted' || conflicted.reference !== operation.reference))) throw new TypeError('Protected Workspace recovery conflict relationship is inconsistent');
		if (conflicted !== undefined) operation.resolvesConflict = conflicted;
	}
	return Object.freeze(restored);
}
function validateRecoveryByteEnvelope(records: readonly RecoveryRecord[], limits: WorkspaceLimits): void { let retainedBytes = 0; for (const record of records) { retainedBytes += validateRecoveryRecordBytes(record, limits); if (retainedBytes > WORKSPACE_V1_MAX_RECOVERY_RESTORE_BYTES) throw new RangeError('Protected Workspace recovery exceeds the packaged restore safety limit'); } }
function validateRecoveryRecordBytes(record: RecoveryRecord, limits: WorkspaceLimits): number { let retainedBytes = 0; for (const content of [record.content, record.baseContent, record.conflictAuthoritativeContent, 'content' in record.mutation ? record.mutation.content : undefined, record.dispatchedCommand && 'content' in record.dispatchedCommand ? record.dispatchedCommand.content : undefined]) { if (content === undefined) continue; if (!(content instanceof Uint8Array) || content.byteLength > limits.effectiveFileBytes) throw new RangeError('Protected Workspace recovery content exceeds the effective file limit'); retainedBytes += content.byteLength; } return retainedBytes; }
function validateRecoveredMutation(mutation: unknown, reference: WorkspaceEntryReference, effectiveFileBytes: number): asserts mutation is RecoveryRecord['mutation'] {
	if (typeof mutation !== 'object' || mutation === null || !('kind' in mutation) || typeof mutation.kind !== 'string') throw new TypeError('Protected Workspace recovery mutation is invalid');
	const value = mutation as Record<string, unknown>; const exact = (keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => key in value);
	if (mutation.kind === 'createDirectory') { if (!exact(['kind', 'path']) || typeof value.path !== 'string') throw new TypeError('Protected Workspace recovery mutation is invalid'); workspacePath(value.path); return; }
	if (mutation.kind === 'createFile') { if (!exact(['kind', 'path', 'content', 'mediaType']) || typeof value.path !== 'string') throw new TypeError('Protected Workspace recovery mutation is invalid'); workspacePath(value.path); }
	else if (mutation.kind === 'replaceContent') { if (!exact(['kind', 'reference', 'content', 'mediaType']) || value.reference !== reference) throw new TypeError('Protected Workspace recovery reference is inconsistent'); }
	else if (mutation.kind === 'move') { if (!exact(['kind', 'reference', 'destination']) || value.reference !== reference || typeof value.destination !== 'string') throw new TypeError('Protected Workspace recovery mutation is invalid'); workspacePath(value.destination); return; }
	else if (mutation.kind === 'delete') { if (!(exact(['kind', 'reference']) || exact(['kind', 'reference', 'recursive']) && typeof value.recursive === 'boolean') || value.reference !== reference) throw new TypeError('Protected Workspace recovery reference is inconsistent'); return; }
	else throw new TypeError('Protected Workspace recovery mutation is invalid');
	if (!(value.content instanceof Uint8Array) || value.content.byteLength > effectiveFileBytes || typeof value.mediaType !== 'string' || value.mediaType.length === 0 || value.mediaType.length > 255) throw new TypeError('Protected Workspace recovery file content is invalid');
}
function boundedRecoveryIdentifier(value: string): boolean { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.includes('\0'); }
function equalBytes(left: Uint8Array, right: Uint8Array): boolean { return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]); }
function isConflictResolutionIntent(operation: LocalOperation, conflicted: LocalOperation | undefined): boolean {
	if (operation.intent.kind === 'replaceContent') return conflicted === undefined || conflicted.intent.kind === 'replaceContent' && conflicted.rejection === 'advancedContent';
	if (operation.intent.kind === 'createDirectory') return conflicted === undefined || conflicted.intent.kind === 'createDirectory' && conflicted.rejection === 'localCreationCollision';
	if (operation.intent.kind === 'createFile') return conflicted === undefined || conflicted.intent.kind === 'createFile' && conflicted.rejection === 'localCreationCollision';
	return operation.intent.kind === 'move' && (conflicted === undefined || conflicted.intent.kind === 'move' && (conflicted.rejection === 'destinationCollision' || conflicted.rejection === 'incompatibleSubtreeMove'));
}
function cloneEntry(value: WorkspaceEntry): WorkspaceEntry { return Object.freeze({ ...value }); }
function cloneSnapshot(snapshot: AuthoritativeWorkspaceSnapshot): AuthoritativeWorkspaceSnapshot { return Object.freeze({ cursor: snapshot.cursor, availability: snapshot.availability, access: Object.freeze({ ...snapshot.access }), entries: Object.freeze(snapshot.entries.map(entry => Object.freeze({ ...entry }))) }); }
function scopesOverlap(left: readonly (WorkspaceEntryReference | WorkspacePath)[], right: readonly (WorkspaceEntryReference | WorkspacePath)[]): boolean { return left.some(a => right.some(b => a === b || (typeof a === 'string' && typeof b === 'string' && pathsOverlap(a as WorkspacePath, b as WorkspacePath)))); }
const UNCHANGED_WORKSPACE_FACTS: WorkspaceStateFacts = Object.freeze({ contentRelation: 'unchanged', remoteMutation: 'idle', recoveryProtection: 'notRequired' });
const REMOTE_MUTATION_PRIORITY: Readonly<Record<WorkspaceStateFacts['remoteMutation'], number>> = Object.freeze({ idle: 0, queued: 1, inFlight: 2, outcomeUnknown: 3, rejected: 4, conflicted: 5 });
const RECOVERY_PRIORITY: Readonly<Record<WorkspaceStateFacts['recoveryProtection'], number>> = Object.freeze({ notRequired: 0, protected: 1, pending: 2, failed: 3 });
function operationChangesContent(operation: LocalOperation): boolean { return operation.intent.kind === 'createFile' || operation.intent.kind === 'replaceContent'; }
function remoteMutationFor(operation: LocalOperation): WorkspaceStateFacts['remoteMutation'] { return operation.state === 'conflicted' || operation.state === 'conflictPending' ? 'conflicted' : operation.state === 'rejected' ? 'rejected' : operation.state === 'outcomeUnknown' ? 'outcomeUnknown' : operation.state === 'inFlight' ? 'inFlight' : 'queued'; }
function combineWorkspaceFacts(previous: WorkspaceStateFacts, operation: LocalOperation): WorkspaceStateFacts {
	const remote = remoteMutationFor(operation); const recovery = operation.recovery;
	return Object.freeze({
		contentRelation: previous.contentRelation === 'modified' || operationChangesContent(operation) ? 'modified' : 'unchanged',
		remoteMutation: REMOTE_MUTATION_PRIORITY[previous.remoteMutation] >= REMOTE_MUTATION_PRIORITY[remote] ? previous.remoteMutation : remote,
		recoveryProtection: RECOVERY_PRIORITY[previous.recoveryProtection] >= RECOVERY_PRIORITY[recovery] ? previous.recoveryProtection : recovery
	});
}

interface WorkspaceOverlayNode { name: string; parent: WorkspaceOverlayNode | undefined; readonly children: Map<string, WorkspaceOverlayNode>; readonly entries: Map<WorkspaceEntryReference, WorkspaceEntry>; shadowed: WorkspaceOverlayNode[] }

/** A mutable path trie makes subtree overlays output-sensitive instead of rescanning every entry for every operation. */
class WorkspaceOverlayIndex {
	readonly #root: WorkspaceOverlayNode = { name: '', parent: undefined, children: new Map(), entries: new Map(), shadowed: [] };
	readonly #references = new Map<WorkspaceEntryReference, WorkspaceOverlayNode>();
	constructor(entries: readonly WorkspaceEntry[]) { for (const entry of entries) this.#add(entry, false); }
	has(reference: WorkspaceEntryReference): boolean { return this.#references.has(reference); }
	affectedReferences(operation: LocalOperation, resolve: (reference: WorkspaceEntryReference) => WorkspaceEntryReference): readonly WorkspaceEntryReference[] {
		const intent = operation.intent;
		if (intent.kind === 'createDirectory' || intent.kind === 'createFile') return Object.freeze([operation.reference as WorkspaceEntryReference]);
		const node = this.#references.get(resolve(intent.reference)) ?? this.#references.get(intent.reference); if (node === undefined) return Object.freeze([]);
		if (intent.kind === 'replaceContent') return Object.freeze([...(node.entries.has(resolve(intent.reference)) ? [resolve(intent.reference)] : [intent.reference])]);
		return Object.freeze(this.#subtreeReferences(node));
	}
	apply(operation: LocalOperation, resolve: (reference: WorkspaceEntryReference) => WorkspaceEntryReference): void {
		const intent = operation.intent; const reference = operation.reference as WorkspaceEntryReference;
		if (intent.kind === 'createDirectory') { this.#applyCreate({ reference, path: workspacePath(intent.path), kind: 'directory' }); return; }
		if (intent.kind === 'createFile') { this.#applyCreate({ reference, path: workspacePath(intent.path), kind: 'file', contentVersion: `local:${operation.generation}` as WorkspaceContentVersion, mediaType: intent.mediaType, byteSize: intent.content.byteLength }); return; }
		const resolved = resolve(intent.reference); const node = this.#references.get(resolved) ?? this.#references.get(intent.reference); if (node === undefined) return;
		if (intent.kind === 'replaceContent') {
			const currentReference = node.entries.has(resolved) ? resolved : intent.reference; const entry = node.entries.get(currentReference); if (entry === undefined) return;
			node.entries.set(currentReference, { ...entry, contentVersion: `local:${operation.generation}` as WorkspaceContentVersion, mediaType: intent.mediaType, byteSize: intent.content.byteLength }); return;
		}
		if (intent.kind === 'delete') { this.#detach(node); this.#removeReferences(node); return; }
		this.#relocate(node, workspacePath(intent.destination));
	}
	values(): WorkspaceEntry[] { const result: WorkspaceEntry[] = []; this.#materialize(this.#root, '', result); return result; }
	#add(entry: WorkspaceEntry, shadowsExisting: boolean): void { const segments = String(entry.path).split('/'); const name = segments.pop() as string; const parent = this.#ensurePath(segments); let node = shadowsExisting ? undefined : parent.children.get(name); if (node === undefined) { node = { name, parent: undefined, children: new Map(), entries: new Map(), shadowed: [] }; this.#attach(parent, name, node); } node.entries.set(entry.reference, { ...entry }); this.#references.set(entry.reference, node); }
	#applyCreate(entry: WorkspaceEntry): void { const existing = this.#references.get(entry.reference); if (existing === undefined) { this.#add(entry, true); return; } this.#relocate(existing, entry.path); existing.entries.set(entry.reference, { ...entry }); }
	#relocate(node: WorkspaceOverlayNode, destination: WorkspacePath): void { this.#detach(node); const segments = String(destination).split('/'); const name = segments.pop() as string; const parent = this.#ensurePath(segments); this.#attach(parent, name, node); }
	#ensurePath(segments: readonly string[]): WorkspaceOverlayNode { let node = this.#root; for (const name of segments) { let child = node.children.get(name); if (child === undefined) { child = { name, parent: node, children: new Map(), entries: new Map(), shadowed: [] }; node.children.set(name, child); } node = child; } return node; }
	#subtreeReferences(root: WorkspaceOverlayNode): WorkspaceEntryReference[] { const result: WorkspaceEntryReference[] = []; const pending = [root]; while (pending.length > 0) { const node = pending.pop() as WorkspaceOverlayNode; result.push(...node.entries.keys()); pending.push(...node.children.values()); } return result; }
	#removeReferences(root: WorkspaceOverlayNode): void { for (const reference of this.#subtreeReferences(root)) this.#references.delete(reference); }
	#attach(parent: WorkspaceOverlayNode, name: string, node: WorkspaceOverlayNode): void { const previous = parent.children.get(name); node.name = name; node.parent = parent; if (previous !== undefined) { node.shadowed = [previous, ...previous.shadowed]; previous.shadowed = []; } parent.children.set(name, node); }
	#detach(node: WorkspaceOverlayNode): void {
		const parent = node.parent; if (parent === undefined) return; const visible = parent.children.get(node.name);
		if (visible === node) { const [replacement, ...rest] = node.shadowed; node.shadowed = []; if (replacement === undefined) parent.children.delete(node.name); else { replacement.shadowed = rest; parent.children.set(node.name, replacement); } }
		else if (visible !== undefined) { const index = visible.shadowed.indexOf(node); if (index >= 0) visible.shadowed.splice(index, 1, ...node.shadowed); node.shadowed = []; }
		node.parent = undefined;
	}
	#materialize(node: WorkspaceOverlayNode, parentPath: string, result: WorkspaceEntry[]): void { const path = node === this.#root ? '' : parentPath === '' ? node.name : `${parentPath}/${node.name}`; for (const entry of node.entries.values()) result.push({ ...entry, path: path as WorkspacePath }); for (const child of node.children.values()) this.#materialize(child, path, result); }
}

function cloneCommand(command: WorkspaceMutationCommand): WorkspaceMutationCommand { return Object.freeze('content' in command ? { ...command, content: copyBytes(command.content) } : { ...command }); }

function validateRecoveredCommand(record: RecoveryRecord, limits: WorkspaceLimits): void {
	const value = record.dispatchedCommand;
	if (value === undefined) return; // Legacy uncertain recovery remains protected; the server adapter refuses to invent its command.
	if (value.kind !== record.mutation.kind || value.idempotencyKey !== record.idempotencyKey || !Number.isSafeInteger(value.replayUntil) || Number(value.replayUntil) <= 0) throw new TypeError('Protected Workspace dispatched command is invalid');
	const keys = ['kind', 'idempotencyKey', 'replayUntil'];
	if (value.kind === 'createDirectory' || value.kind === 'createFile') {
		keys.push('path', 'expectDestinationAbsent', 'localReference'); workspacePath(value.path);
		if (value.expectDestinationAbsent !== true || !boundedRecoveryIdentifier(value.localReference) || !('path' in record.mutation) || value.path !== record.mutation.path || value.localReference !== record.reference) throw new TypeError('Protected Workspace create command is inconsistent');
	} else {
		keys.push('reference'); if (!boundedRecoveryIdentifier(value.reference) || !('reference' in record.mutation) || value.reference !== record.mutation.reference) throw new TypeError('Protected Workspace command reference is invalid');
	}
	if (value.kind === 'createFile' || value.kind === 'replaceContent') {
		keys.push('content', 'mediaType');
		if (!(value.content instanceof Uint8Array) || value.content.byteLength > limits.effectiveFileBytes || !('content' in record.mutation) || !equalBytes(value.content, record.mutation.content) || value.mediaType !== record.mutation.mediaType) throw new TypeError('Protected Workspace dispatched bytes are inconsistent');
	}
	if (value.kind === 'replaceContent') { keys.push('expectedPath', 'expectedContentVersion'); workspacePath(value.expectedPath); if (!boundedRecoveryIdentifier(value.expectedContentVersion) || value.expectedContentVersion !== record.baseContentVersion || value.expectedPath !== record.basePath) throw new TypeError('Protected Workspace command base is invalid'); }
	if (value.kind === 'move') { keys.push('currentPath', 'destination', 'expectDestinationAbsent'); workspacePath(value.currentPath); workspacePath(value.destination); if (value.expectDestinationAbsent !== true || record.mutation.kind !== 'move' || value.destination !== record.mutation.destination || value.currentPath !== record.basePath) throw new TypeError('Protected Workspace move command is invalid'); }
	if (value.kind === 'delete') {
		keys.push('expectedPath'); workspacePath(value.expectedPath); if (value.expectedPath !== record.basePath || record.mutation.kind !== 'delete' || (value.recursive === true) !== (record.mutation.recursive === true)) throw new TypeError('Protected Workspace delete command is inconsistent');
		if (value.expectedContentVersion !== undefined) { keys.push('expectedContentVersion'); if (!boundedRecoveryIdentifier(value.expectedContentVersion)) throw new TypeError('Protected Workspace delete version is invalid'); }
		if (value.recursive !== undefined) { keys.push('recursive', 'expectedWorkspaceCursor'); if (value.recursive !== true || !Number.isSafeInteger(value.expectedWorkspaceCursor) || Number(value.expectedWorkspaceCursor) < 0 || value.expectedContentVersion !== undefined) throw new TypeError('Protected Workspace subtree command is invalid'); }
	}
	if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new TypeError('Protected Workspace command fields are invalid');
}
