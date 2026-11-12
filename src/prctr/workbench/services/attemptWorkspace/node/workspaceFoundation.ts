import { randomUUID } from 'node:crypto';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import type { Event } from '../../../../base/common/event.js';
import type { ProtectedRecordStore } from '../../../../platform/protectedStorage/node/protectedRecordStore.js';
import type { SessionApi } from '../../../../platform/serverApi/node/sessionApi.js';
import type { components } from '../../../../platform/serverApi/common/serverApi.generated.js';
import { validateNamedSchema } from '../../../../platform/serverApi/node/serverContract.js';
import type { WorkspaceAccess, WorkspaceEntryReference } from '../common/attemptWorkspace.js';
import { createAttemptWorkspaceSession } from '../common/attemptWorkspaceSession.js';
import { createExamResourceCatalog } from '../common/examResourceCatalog.js';
import { ProtectedWorkspaceContent } from './protectedWorkspaceContent.js';
import {
	ServerWorkspaceAuthority,
	workspaceLimitsFromCapacity,
	type WorkspaceServerBinding
} from './serverWorkspaceAuthority.js';
import { ServerExamResources } from './serverExamResources.js';

export interface WorkspaceFoundationOptions {
	readonly api: Pick<SessionApi, 'request'>;
	/** Store is already bound to this account, server, Attempt and Workspace. Borrowed. */
	readonly recovery: ProtectedRecordStore;
	readonly current: () => WorkspaceServerBinding;
	readonly onDidChangeAccess: Event<void>;
	readonly presentation: components['schemas']['CandidateExamPresentationResponse'];
	readonly revisionIsCurrent: () => boolean;
}
const denied: WorkspaceAccess = Object.freeze({
	read: false,
	createDirectory: false,
	createFile: false,
	replaceContent: false,
	move: false,
	delete: false
});
/** A privileged reusable foundation. Its caller owns admission, API credentials and storage lifetime. */
export async function createWorkspaceFoundation(options: WorkspaceFoundationOptions) {
	validateNamedSchema('CandidateExamPresentationResponse', options.presentation);
	const lifetime = new DisposableStore();
	const initial = { ...options.current() };
	const sameBinding = () => {
		const value = options.current();
		return (
			!lifetime.isDisposed &&
			value.attemptId === initial.attemptId &&
			value.workspaceId === initial.workspaceId &&
			value.epoch === initial.epoch &&
			value.participationId === initial.participationId &&
			value.generation === initial.generation &&
			value.connectionId === initial.connectionId
		);
	};
	const current = (): WorkspaceServerBinding => {
		const value = options.current();
		return {
			...value,
			access: sameBinding() && options.revisionIsCurrent() ? { ...value.access } : denied
		};
	};
	try {
		const limits = workspaceLimitsFromCapacity(options.presentation.capacity);
		const authority = lifetime.add(
			new ServerWorkspaceAuthority({ api: options.api, current, limits })
		);
		const session = lifetime.add(
			await createAttemptWorkspaceSession({
				authority,
				protectedContent: new ProtectedWorkspaceContent(options.recovery),
				limits,
				authorization: {
					current: () => current().access,
					onDidChange: options.onDidChangeAccess
				},
				ids: {
					nextIdempotencyKey: () => randomUUID(),
					nextLocalReference: () => `local:${randomUUID()}` as WorkspaceEntryReference,
					recoveryStorageId: (reference, generation) =>
						`${reference}:${generation}:${randomUUID()}`
				}
			})
		);
		const resourcePort = lifetime.add(
			new ServerExamResources(
				options.api,
				current,
				options.presentation,
				options.revisionIsCurrent
			)
		);
		const resources = lifetime.add(
			await createExamResourceCatalog(resourcePort, {
				current: () => current().access.read,
				onDidChange: options.onDidChangeAccess
			})
		);
		return Object.freeze({ session, resources, limits, dispose: () => lifetime.dispose() });
	} catch (error) {
		lifetime.dispose();
		throw error;
	}
}
