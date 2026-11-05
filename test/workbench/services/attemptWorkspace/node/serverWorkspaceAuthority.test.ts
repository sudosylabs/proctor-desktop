import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CancellationToken } from '../../../../../src/prctr/base/common/cancellation.js';
import { ServerApiClient } from '../../../../../src/prctr/platform/serverApi/node/serverApiClient.js';
import type { HttpResponse } from '../../../../../src/prctr/platform/serverApi/node/serverHttpTransport.js';
import {
	ServerWorkspaceAuthority,
	digest,
	workspaceLimitsFromCapacity
} from '../../../../../src/prctr/workbench/services/attemptWorkspace/node/serverWorkspaceAuthority.js';
import {
	WORKSPACE_V1_DEFAULT_LIMITS,
	type WorkspaceEntryReference
} from '../../../../../src/prctr/workbench/services/attemptWorkspace/common/attemptWorkspace.js';
import { workspacePath } from '../../../../../src/prctr/workbench/services/attemptWorkspace/common/path.js';
const id = 'y'.repeat(26);
const entryId = 'z'.repeat(26);
const access = {
	read: true,
	createDirectory: true,
	createFile: true,
	replaceContent: true,
	move: true,
	delete: true
};
const binding = {
	attemptId: id,
	workspaceId: id,
	participationId: id,
	generation: 1,
	connectionId: id,
	credential: 'a'.repeat(43),
	epoch: 1,
	access
};
const json = (value: unknown, status = 200): HttpResponse => ({
	status,
	headers: { 'content-type': 'application/json' },
	bytes: new TextEncoder().encode(JSON.stringify(value))
});
const content = new TextEncoder().encode('answer');
const file = {
	id: entryId,
	path: 'answer.txt',
	kind: 'file',
	media_type: 'text/plain',
	size: content.length,
	sha256: digest(content),
	content_version: 'a'.repeat(26)
};
const manifest = { workspace_id: id, workspace_cursor: 1, items: [file], refresh_required: false };
void test('server workspace validates frozen limits and verified current file reads', async () => {
	const limits = workspaceLimitsFromCapacity({
		resource_maximum_count: 20,
		resource_maximum_bytes: 1000,
		workspace_maximum_entries: 42,
		workspace_maximum_file_bytes: 1024,
		workspace_maximum_total_bytes: 4096
	});
	assert.equal(limits.effectiveEntries, 42);
	assert.throws(() =>
		workspaceLimitsFromCapacity({
			resource_maximum_count: 1,
			resource_maximum_bytes: 1,
			workspace_maximum_entries: 0,
			workspace_maximum_file_bytes: 1,
			workspace_maximum_total_bytes: 1
		})
	);
	let corrupt = false;
	const api = new ServerApiClient('https://institution.test', async (request) =>
		request.url.endsWith('/content')
			? {
					status: 200,
					headers: {
						'content-type': 'application/octet-stream',
						etag: `"${'a'.repeat(26)}"`
					},
					bytes: corrupt ? new Uint8Array(content.length) : content
				}
			: json(manifest)
	);
	const authority = new ServerWorkspaceAuthority({ api, current: () => binding, limits });
	try {
		await authority.getSnapshot();
		assert.deepEqual(
			(await authority.readCurrent(entryId as WorkspaceEntryReference)).content,
			content
		);
		corrupt = true;
		await assert.rejects(authority.readCurrent(entryId as WorkspaceEntryReference));
	} finally {
		authority.dispose();
		api.dispose();
	}
});
void test('mutation uses exact metadata and retains acknowledgement independent of newer snapshot', async () => {
	let metadata: unknown;
	const api = new ServerApiClient('https://institution.test', async (request) => {
		if (request.method === 'POST') {
			assert.ok(request.body instanceof FormData);
			const part = request.body.get('metadata');
			assert.ok(part instanceof Blob);
			metadata = JSON.parse(await part.text());
			return json(
				{ workspace_id: id, workspace_cursor: 1, operation: 'create_file', entry: file },
				201
			);
		}
		return json({
			...manifest,
			workspace_cursor: 2,
			items: [{ ...file, content_version: 'b'.repeat(26) }]
		});
	});
	const authority = new ServerWorkspaceAuthority({
		api,
		current: () => binding,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	try {
		const result = await authority.dispatch(
			{
				kind: 'createFile',
				path: workspacePath('answer.txt'),
				content,
				mediaType: 'text/plain',
				localReference: 'local-one' as WorkspaceEntryReference,
				idempotencyKey: 'command-one',
				expectDestinationAbsent: true
			},
			CancellationToken.None
		);
		assert.equal(result.kind, 'acknowledged');
		if (result.kind !== 'acknowledged') return;
		assert.equal(result.acknowledgedEntry?.contentVersion, 'a'.repeat(26));
		assert.equal(result.snapshot.entries[0]?.contentVersion, 'b'.repeat(26));
		assert.deepEqual(metadata, {
			participation_id: id,
			generation: 1,
			path: 'answer.txt',
			media_type: 'text/plain',
			size: content.length,
			sha256: digest(content)
		});
	} finally {
		authority.dispose();
		api.dispose();
	}
});
void test('in-progress and unknown conflicts preserve uncertain outcome, including replay', async () => {
	const { ServerApiError } =
		await import('../../../../../src/prctr/platform/serverApi/common/serverApi.js');
	let requests = 0;
	const api = new ServerApiClient('https://institution.test', async () => {
		requests++;
		throw new ServerApiError('server', 409, {
			code: 'idempotency.in_progress',
			status: 409,
			title: 'In progress',
			type: 'about:blank'
		});
	});
	const authority = new ServerWorkspaceAuthority({
		api,
		current: () => binding,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const command = {
		kind: 'createDirectory' as const,
		path: workspacePath('src'),
		localReference: 'local-one' as WorkspaceEntryReference,
		idempotencyKey: 'command-one',
		expectDestinationAbsent: true as const,
		replayUntil: Date.now() + 60000
	};
	try {
		assert.equal(
			(await authority.dispatch(command, CancellationToken.None)).kind,
			'outcomeUnknown'
		);
		assert.equal(
			(await authority.lookupResult(command.idempotencyKey, command))?.kind,
			'outcomeUnknown'
		);
		const count = requests;
		assert.equal(
			(await authority.lookupResult(command.idempotencyKey, { ...command, replayUntil: 1 }))
				?.kind,
			'outcomeUnknown'
		);
		assert.equal(requests, count);
	} finally {
		authority.dispose();
		api.dispose();
	}
});
void test('workspace foundation composes real server reads and recovery behind a fixed admission lifetime', async () => {
	const { createWorkspaceFoundation } =
		await import('../../../../../src/prctr/workbench/services/attemptWorkspace/node/workspaceFoundation.js');
	const { Emitter } = await import('../../../../../src/prctr/base/common/event.js');
	const { encodeAttemptConfiguration } =
		await import('../../../../../src/prctr/platform/settings/node/attemptConfigurationWire.js');
	const { deriveAttemptConfiguration } =
		await import('../../../../../src/prctr/platform/settings/common/attemptConfiguration.js');
	const { EffectiveSettings } =
		await import('../../../../../src/prctr/platform/settings/common/settingsResolution.js');
	const { parseSettingsDocument } =
		await import('../../../../../src/prctr/platform/settings/common/settingsDocument.js');
	const { canonicalContractDigest } =
		await import('../../../../../src/prctr/platform/serverApi/node/canonicalContract.js');
	const configuration = encodeAttemptConfiguration(
		deriveAttemptConfiguration(
			new EffectiveSettings(parseSettingsDocument('{}'), { window: 'candidate' }),
			{
				registryFingerprint: `fnv1a64:${'1'.repeat(16)}`,
				desktopBuild: '1',
				desktopTarget: 'darwin-arm64',
				userSettingsRevision: id
			},
			[],
			[]
		)
	);
	let current = { ...binding };
	const gate = new Emitter<void>();
	const records = new Map<string, Uint8Array>();
	const recovery = {
		read: async (key: string) => records.get(key),
		write: async (key: string, bytes: Uint8Array) => {
			records.set(key, new Uint8Array(bytes));
		},
		delete: async (key: string) => {
			records.delete(key);
		},
		list: async () => [...records.keys()],
		dispose: () => {}
	};
	const api = new ServerApiClient('https://institution.test', async (request) =>
		request.url.endsWith('/content')
			? {
					status: 200,
					headers: {
						'content-type': 'application/octet-stream',
						etag: `"${'a'.repeat(26)}"`
					},
					bytes: content
				}
			: json(manifest)
	);
	const foundation = await createWorkspaceFoundation({
		api,
		recovery,
		current: () => current,
		onDidChangeAccess: gate.event,
		revisionIsCurrent: () => true,
		presentation: {
			attempt_id: id,
			exam_sitting_id: id,
			title: 'Exam',
			instructions_markdown: '',
			resources: [],
			live_corrections: [],
			browser_policy: null,
			capacity: {
				resource_maximum_count: 20,
				resource_maximum_bytes: 1000,
				workspace_maximum_entries: 42,
				workspace_maximum_file_bytes: 1024,
				workspace_maximum_total_bytes: 4096
			},
			candidate_runtime_capabilities: {
				schema_version: 1,
				server_time: '2026-09-12T00:00:00.000Z',
				interaction_state: 'interactive',
				attempt_configuration: {
					presentation: configuration.presentation,
					approved_commands: [],
					approved_keybindings: [],
					attempt_configuration_revision: id,
					digest: canonicalContractDigest(configuration)
				},
				focus_loss_collection_enabled: false,
				pending_correction_capabilities: [],
				workspace_mutation_allowed: true,
				submission_allowed: true,
				browser: { state: 'disabled' },
				exam_revision: {
					admission_revision_id: id,
					current_revision_id: id,
					acknowledgement_required: false
				},
				departure: { allowed: false, reason: 'attempt_in_progress' }
			}
		}
	});
	try {
		assert.deepEqual(
			(await foundation.session.read({ reference: entryId as WorkspaceEntryReference }))
				.content,
			content
		);
		current = { ...current, epoch: 2 };
		gate.fire();
		assert.equal(foundation.session.observe().current.access.read, false);
		await assert.rejects(
			foundation.session.read({ reference: entryId as WorkspaceEntryReference })
		);
	} finally {
		foundation.dispose();
		gate.dispose();
		api.dispose();
	}
});

void test('a committed mutation remains uncertain if refreshing its snapshot is denied', async () => {
	const { ServerApiError } =
		await import('../../../../../src/prctr/platform/serverApi/common/serverApi.js');
	const api = new ServerApiClient('https://institution.test', async (request) => {
		if (request.method === 'POST')
			return json(
				{ workspace_id: id, workspace_cursor: 1, operation: 'create_file', entry: file },
				201
			);
		throw new ServerApiError('server', 403);
	});
	const authority = new ServerWorkspaceAuthority({
		api,
		current: () => binding,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	try {
		const result = await authority.dispatch(
			{
				kind: 'createFile',
				path: workspacePath('answer.txt'),
				content,
				mediaType: 'text/plain',
				localReference: 'local-one' as WorkspaceEntryReference,
				idempotencyKey: 'command-one',
				expectDestinationAbsent: true
			},
			CancellationToken.None
		);
		assert.equal(result.kind, 'outcomeUnknown');
	} finally {
		authority.dispose();
		api.dispose();
	}
});
