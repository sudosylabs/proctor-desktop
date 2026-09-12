/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../../base/common/cancellation.js';
import type { Event } from '../../../../base/common/event.js';
import type { IDisposable } from '../../../../base/common/lifecycle.js';

export type WorkspaceEntryReference = string & { readonly __workspaceEntryReference: unique symbol };
export type WorkspaceContentVersion = string & { readonly __workspaceContentVersion: unique symbol };
export type WorkspacePath = string & { readonly __workspacePath: unique symbol };
export type WorkspaceViewGeneration = number & { readonly __workspaceViewGeneration: unique symbol };
export type WorkspaceCursor = number & { readonly __workspaceCursor: unique symbol };

export interface WorkspaceEntry {
	readonly reference: WorkspaceEntryReference; readonly path: WorkspacePath; readonly kind: 'directory' | 'file'; readonly contentVersion?: WorkspaceContentVersion; readonly mediaType?: string; readonly byteSize?: number; readonly sha256?: string;
}
export interface WorkspaceStateFacts {
	readonly contentRelation: 'modified' | 'unchanged';
	readonly remoteMutation: 'conflicted' | 'idle' | 'inFlight' | 'outcomeUnknown' | 'queued' | 'rejected';
	readonly recoveryProtection: 'failed' | 'notRequired' | 'pending' | 'protected';
}
export interface WorkspaceProjectedEntry extends WorkspaceEntry { readonly facts: WorkspaceStateFacts }
export interface WorkspaceProjection {
	readonly generation: WorkspaceViewGeneration; readonly cursor: WorkspaceCursor; readonly entries: readonly WorkspaceProjectedEntry[];
	readonly availability: 'offline' | 'online' | 'reconnecting' | 'unavailable'; readonly access: WorkspaceAccess;
}
export interface WorkspaceAccess { readonly read: boolean; readonly createDirectory: boolean; readonly createFile: boolean; readonly replaceContent: boolean; readonly move: boolean; readonly delete: boolean }
export interface WorkspaceObservation { readonly current: WorkspaceProjection; readonly onDidChange: Event<WorkspaceProjection> }
export interface WorkspaceRead { readonly reference: WorkspaceEntryReference; readonly version?: 'current' | 'conflictAuthoritative' | 'conflictBase' | 'conflictLocal' }
export interface WorkspaceReadResult { readonly reference: WorkspaceEntryReference; readonly content: Uint8Array; readonly contentVersion: WorkspaceContentVersion; readonly mediaType: string; readonly byteSize: number; readonly source: 'authoritative' | 'conflictAuthoritative' | 'conflictBase' | 'conflictLocal' | 'workingOverlay' }

export type WorkspaceChange =
	| { readonly kind: 'createDirectory'; readonly path: string }
	| { readonly kind: 'createFile'; readonly path: string; readonly content: Uint8Array; readonly mediaType: string }
	| { readonly kind: 'replaceContent'; readonly reference: WorkspaceEntryReference; readonly content: Uint8Array; readonly mediaType: string }
	| { readonly kind: 'move'; readonly reference: WorkspaceEntryReference; readonly destination: string }
	| { readonly kind: 'delete'; readonly reference: WorkspaceEntryReference; readonly recursive?: boolean }
	| { readonly kind: 'discard'; readonly reference: WorkspaceEntryReference }
	| { readonly kind: 'resolveConflict'; readonly reference: WorkspaceEntryReference; readonly resolution: 'authoritative' | 'local' | { readonly content: Uint8Array; readonly mediaType: string } };
export type WorkspaceChangeResult =
	| { readonly accepted: true; readonly generation: WorkspaceViewGeneration; readonly reference?: WorkspaceEntryReference }
	| { readonly accepted: false; readonly code: 'accessDenied' | 'durabilityUnavailable' | 'invalidPath' | 'invalidReference' | 'sizeLimit' | 'unsupported'; readonly message: string };

export type WorkspaceSettlementKind = 'controlledClose' | 'persist' | 'protect' | 'reconcile' | 'submissionReadiness';
export interface WorkspaceSettlement { readonly kind: WorkspaceSettlementKind; readonly throughGeneration: WorkspaceViewGeneration; readonly cancellation?: CancellationToken }
export interface WorkspaceSettlementBlocker { readonly generation: WorkspaceViewGeneration; readonly kind: 'conflicted' | 'inFlight' | 'outcomeUnknown' | 'protectionFailed' | 'queued' | 'rejected' | 'unacknowledged'; readonly reference?: WorkspaceEntryReference }
export interface WorkspaceSettlementResult { readonly kind: WorkspaceSettlementKind; readonly throughGeneration: WorkspaceViewGeneration; readonly protected: boolean; readonly acknowledged: boolean; readonly cursor?: WorkspaceCursor; readonly blockers: readonly WorkspaceSettlementBlocker[] }

export interface AttemptWorkspaceSession extends IDisposable {
	observe(): WorkspaceObservation;
	read(request: WorkspaceRead): Promise<WorkspaceReadResult>;
	change(intent: Exclude<WorkspaceChange, { readonly kind: 'discard' | 'resolveConflict' }>): WorkspaceChangeResult;
	discard(reference: WorkspaceEntryReference): Promise<WorkspaceChangeResult>;
	resolveConflict(reference: WorkspaceEntryReference, resolution: Extract<WorkspaceChange, { readonly kind: 'resolveConflict' }>['resolution']): Promise<WorkspaceChangeResult>;
	settle(request: WorkspaceSettlement): Promise<WorkspaceSettlementResult>;
}

export interface ExamResourceEntry { readonly reference: string; readonly path: string; readonly version: string; readonly mediaType: string; readonly byteSize: number; readonly title: string; readonly order?: number }
export interface ExamResourceProjection { readonly entries: readonly ExamResourceEntry[]; readonly available: boolean }
export interface ExamResourceObservation { readonly current: ExamResourceProjection; readonly onDidChange: Event<ExamResourceProjection> }
export interface ExamResourceReadResult extends ExamResourceEntry { readonly content: Uint8Array }
export interface ExamResourceCatalog extends IDisposable { observe(): ExamResourceObservation; read(reference: string): Promise<ExamResourceReadResult> }

export interface WorkspaceLimits { readonly effectiveEntries: number; readonly effectiveFileBytes: number; readonly effectiveTotalBytes: number; readonly editorModelBytes: number }
export const WORKSPACE_V1_DEFAULT_LIMITS: WorkspaceLimits = Object.freeze({ effectiveEntries: 500, effectiveFileBytes: 10 * 1024 * 1024, effectiveTotalBytes: 50 * 1024 * 1024, editorModelBytes: 10 * 1024 * 1024 });
export const WORKSPACE_V1_HARD_LIMITS: WorkspaceLimits = Object.freeze({ effectiveEntries: 5000, effectiveFileBytes: 100 * 1024 * 1024, effectiveTotalBytes: 1024 * 1024 * 1024, editorModelBytes: 10 * 1024 * 1024 });
/** Independent in-process safety ceiling; protected-storage retention policy remains server/product work. */
export const WORKSPACE_V1_MAX_RECOVERY_RESTORE_BYTES = 512 * 1024 * 1024;
export const WORKSPACE_V1_CAPABILITIES = Object.freeze({
	atomicBatch: false,
	historicalContentRead: false,
	journalMutationKeys: false,
	perEntryServerCapabilities: false,
	protectedRecovery: true,
	rangeBackedModels: false,
	serverConflictResolution: false,
	serverRevert: false,
	wholeCurrentFileRead: true
});

export function assertEditorModelEligible(read: WorkspaceReadResult, limits: WorkspaceLimits): void {
	if (read.byteSize > limits.editorModelBytes) throw new RangeError('Workspace file exceeds the packaged editor-model limit');
}
