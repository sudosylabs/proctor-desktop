/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../../base/common/cancellation.js';
import type { ExamResourceEntry, WorkspaceAccess, WorkspaceChange, WorkspaceContentVersion, WorkspaceCursor, WorkspaceEntry, WorkspaceEntryReference, WorkspacePath } from './attemptWorkspace.js';

export interface AuthoritativeWorkspaceSnapshot { readonly cursor: WorkspaceCursor; readonly entries: readonly WorkspaceEntry[]; readonly access: WorkspaceAccess; readonly availability: 'offline' | 'online' | 'reconnecting' | 'unavailable' }
export interface AuthoritativeWorkspaceRead { readonly reference: WorkspaceEntryReference; readonly content: Uint8Array; readonly contentVersion: WorkspaceContentVersion; readonly mediaType: string }
export type WorkspaceMutationCommand =
	| { readonly kind: 'createDirectory'; readonly idempotencyKey: string; readonly path: WorkspacePath; readonly expectDestinationAbsent: true; readonly localReference: WorkspaceEntryReference }
	| { readonly kind: 'createFile'; readonly idempotencyKey: string; readonly path: WorkspacePath; readonly content: Uint8Array; readonly mediaType: string; readonly expectDestinationAbsent: true; readonly localReference: WorkspaceEntryReference }
	| { readonly kind: 'replaceContent'; readonly idempotencyKey: string; readonly reference: WorkspaceEntryReference; readonly content: Uint8Array; readonly mediaType: string; readonly expectedContentVersion: WorkspaceContentVersion }
	| { readonly kind: 'move'; readonly idempotencyKey: string; readonly reference: WorkspaceEntryReference; readonly currentPath: WorkspacePath; readonly destination: WorkspacePath; readonly expectDestinationAbsent: true }
	| { readonly kind: 'delete'; readonly idempotencyKey: string; readonly reference: WorkspaceEntryReference; readonly expectedContentVersion?: WorkspaceContentVersion };
export type MutationRejectionCode = 'authorization' | 'lifecycle' | 'policy' | 'quota' | 'size' | 'unsupported';
export type WorkspaceMutationResult =
	| { readonly kind: 'acknowledged'; readonly cursor: WorkspaceCursor; readonly snapshot: AuthoritativeWorkspaceSnapshot; readonly referenceMappings?: Readonly<Record<string, WorkspaceEntryReference>> }
	| { readonly kind: 'conflicted'; readonly conflict: 'advancedContent' | 'authoritativeDeletion' | 'destinationCollision' | 'incompatibleSubtreeMove' | 'localCreationCollision'; readonly snapshot?: AuthoritativeWorkspaceSnapshot }
	| { readonly kind: 'rejected'; readonly code: MutationRejectionCode }
	| { readonly kind: 'notDispatched' }
	| { readonly kind: 'outcomeUnknown' }
	| { readonly kind: 'transportUnavailable' }
	| { readonly kind: 'invalidCommand' };
export type WorkspaceChangeFeed = { readonly kind: 'changes'; readonly from: WorkspaceCursor; readonly to: WorkspaceCursor; readonly snapshot: AuthoritativeWorkspaceSnapshot } | { readonly kind: 'gap' | 'expired' | 'inconsistent' };

export interface AuthoritativeWorkspacePort {
	getSnapshot(): Promise<AuthoritativeWorkspaceSnapshot>;
	readCurrent(reference: WorkspaceEntryReference): Promise<AuthoritativeWorkspaceRead>;
	dispatch(command: WorkspaceMutationCommand, cancellation: CancellationToken): Promise<WorkspaceMutationResult>;
	lookupResult(idempotencyKey: string): Promise<WorkspaceMutationResult | undefined>;
	changesAfter(cursor: WorkspaceCursor): Promise<WorkspaceChangeFeed>;
}

export interface RecoveryRecord {
	readonly storageId: string;
	readonly generation: number;
	readonly reference: WorkspaceEntryReference;
	readonly operationState: 'conflicted' | 'conflictPending' | 'outcomeUnknown' | 'queued' | 'rejected';
	readonly rejection?: string;
	readonly basePath?: WorkspacePath;
	readonly baseKind?: WorkspaceEntry['kind'];
	readonly baseContentVersion?: WorkspaceContentVersion;
	readonly baseContent?: Uint8Array;
	readonly baseMediaType?: string;
	readonly conflictAuthoritativeContentVersion?: WorkspaceContentVersion;
	readonly conflictAuthoritativeContent?: Uint8Array;
	readonly conflictAuthoritativeMediaType?: string;
	readonly resolvesConflictStorageId?: string;
	readonly content?: Uint8Array;
	readonly idempotencyKey: string;
	readonly mutation: Exclude<WorkspaceChange, { readonly kind: 'discard' | 'resolveConflict' }>;
}
/** This port is already bound by its composition root to one principal/Attempt/Workspace scope. */
export interface ProtectedContentPort { loadRecovery(): Promise<readonly RecoveryRecord[]>; putRecovery(record: RecoveryRecord): Promise<void>; deleteRecovery(storageId: string): Promise<void> }
export interface WorkspaceIdFactory { nextIdempotencyKey(): string; nextLocalReference(): WorkspaceEntryReference; recoveryStorageId(reference: WorkspaceEntryReference, generation: number): string }

export interface ExamResourcePort { list(): Promise<readonly ExamResourceEntry[]>; read(reference: string): Promise<ExamResourceEntry & { readonly content: Uint8Array }> }
