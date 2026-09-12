import assert from 'node:assert';
import { CancellationToken } from '../../../../../src/prctr/base/common/cancellation.ts';
import { test } from '../../../../base/common/upstream/testAdapter.ts';
import {
	WORKSPACE_V1_CAPABILITIES,
	WORKSPACE_V1_DEFAULT_LIMITS,
	assertEditorModelEligible,
	type AttemptWorkspaceSession,
	type WorkspaceAccess,
	type WorkspaceEntryReference
} from '../../../../../src/prctr/workbench/services/attemptWorkspace/common/attemptWorkspace.ts';
import { createAttemptWorkspaceSession } from '../../../../../src/prctr/workbench/services/attemptWorkspace/common/attemptWorkspaceSession.ts';
import type { RecoveryRecord } from '../../../../../src/prctr/workbench/services/attemptWorkspace/common/internalPorts.ts';
import {
	DeterministicWorkspaceIds,
	InMemoryProtectedContent,
	InMemoryWorkspaceAuthority,
	type InitialFile
} from './inMemoryAdapters.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
async function harness(
	files: readonly InitialFile[] = [
		{ reference: 'entry:a', path: 'src/main.ts', content: 'const value = 1;' }
	]
) {
	const authority = new InMemoryWorkspaceAuthority(files);
	const protectedContent = new InMemoryProtectedContent();
	const session = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids: new DeterministicWorkspaceIds(),
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	for (const file of files)
		await session.read({ reference: file.reference as WorkspaceEntryReference });
	return { authority, protectedContent, session };
}
function entry(session: AttemptWorkspaceSession, path: string) {
	const value = session.observe().current.entries.find((candidate) => candidate.path === path);
	if (value === undefined) throw new Error(`missing ${path}`);
	return value;
}
function assertUniquePaths(session: AttemptWorkspaceSession): void {
	const paths = session.observe().current.entries.map((candidate) => candidate.path);
	assert.strictEqual(new Set(paths).size, paths.length);
}

test('local acceptance, protection, persistence and reads keep durability states distinct', async () => {
	const { authority, protectedContent, session } = await harness();
	const reference = entry(session, 'src/main.ts').reference;
	const changed = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('const value = 2;'),
		mediaType: 'text/typescript'
	});
	assert.strictEqual(changed.accepted, true);
	if (!changed.accepted) return;
	assert.deepStrictEqual(entry(session, 'src/main.ts').facts, {
		contentRelation: 'modified',
		remoteMutation: 'queued',
		recoveryProtection: 'pending'
	});
	assert.strictEqual(
		decoder.decode((await session.read({ reference })).content),
		'const value = 2;'
	);
	const protectedResult = await session.settle({
		kind: 'protect',
		throughGeneration: changed.generation
	});
	assert.strictEqual(protectedResult.protected, true);
	assert.strictEqual(protectedResult.acknowledged, false);
	assert.strictEqual(protectedContent.records.size, 1);
	assert.strictEqual(entry(session, 'src/main.ts').facts.recoveryProtection, 'protected');
	const persisted = await session.settle({
		kind: 'persist',
		throughGeneration: changed.generation
	});
	assert.strictEqual(persisted.acknowledged, true);
	assert.strictEqual(protectedContent.records.size, 0);
	assert.deepStrictEqual(entry(session, 'src/main.ts').facts, {
		contentRelation: 'unchanged',
		remoteMutation: 'idle',
		recoveryProtection: 'notRequired'
	});
	assert.strictEqual(
		decoder.decode((await authority.readCurrent(reference)).content),
		'const value = 2;'
	);
	session.dispose();
});

test('late authoritative reads cannot replace a newer working view or outlive the session', async () => {
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'authoritative' }
	]);
	const session = await createAttemptWorkspaceSession({
		authority,
		protectedContent: new InMemoryProtectedContent(),
		ids: new DeterministicWorkspaceIds(),
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const reference = entry(session, 'answer.txt').reference;
	await session.read({ reference });
	let releaseRead = () => {};
	authority.readBarrier = new Promise<void>((resolve) => {
		releaseRead = resolve;
	});
	const pending = session.read({ reference });
	await waitFor(() => authority.readCalls === 2);
	const changed = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('working'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('replace rejected');
	releaseRead();
	assert.strictEqual(decoder.decode((await pending).content), 'working');
	session.dispose();
	const deleteAuthority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'authoritative' }
	]);
	const deleteSession = await createAttemptWorkspaceSession({
		authority: deleteAuthority,
		protectedContent: new InMemoryProtectedContent(),
		ids: new DeterministicWorkspaceIds(),
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const deleteReference = entry(deleteSession, 'answer.txt').reference;
	let releaseDeleteRead = () => {};
	deleteAuthority.readBarrier = new Promise<void>((resolve) => {
		releaseDeleteRead = resolve;
	});
	const deletedRead = deleteSession.read({ reference: deleteReference });
	await waitFor(() => deleteAuthority.readCalls === 1);
	const deleted = deleteSession.change({ kind: 'delete', reference: deleteReference });
	if (!deleted.accepted) throw new Error('delete rejected');
	releaseDeleteRead();
	await assert.rejects(deletedRead, /unavailable/u);
	deleteSession.dispose();
	const disposedAuthority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'authoritative' }
	]);
	const disposedSession = await createAttemptWorkspaceSession({
		authority: disposedAuthority,
		protectedContent: new InMemoryProtectedContent(),
		ids: new DeterministicWorkspaceIds(),
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const disposedReference = entry(disposedSession, 'answer.txt').reference;
	let releaseDisposedRead = () => {};
	disposedAuthority.readBarrier = new Promise<void>((resolve) => {
		releaseDisposedRead = resolve;
	});
	const disposedRead = disposedSession.read({ reference: disposedReference });
	await waitFor(() => disposedAuthority.readCalls === 1);
	disposedSession.dispose();
	releaseDisposedRead();
	await assert.rejects(disposedRead, /disposed/u);
});

test('a read cannot complete after concurrent authoritative access revocation', async () => {
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'authoritative' }
	]);
	const session = await createAttemptWorkspaceSession({
		authority,
		protectedContent: new InMemoryProtectedContent(),
		ids: new DeterministicWorkspaceIds(),
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const reference = entry(session, 'answer.txt').reference;
	let releaseRead = () => {};
	authority.readBarrier = new Promise<void>((resolve) => {
		releaseRead = resolve;
	});
	const pending = session.read({ reference });
	await waitFor(() => authority.readCalls === 1);
	authority.access = Object.freeze({
		read: false,
		createDirectory: true,
		createFile: true,
		replaceContent: true,
		move: true,
		delete: true
	});
	authority.changeFeedMode = 'gap';
	await session.settle({ kind: 'reconcile', throughGeneration: 0 as never });
	releaseRead();
	await assert.rejects(pending, /access/u);
	session.dispose();
});

test('reconciled access revocation denies reads and retains accepted work without dispatch', async () => {
	const { authority, protectedContent, session } = await harness();
	const reference = entry(session, 'src/main.ts').reference;
	const changed = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('retained'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('replace rejected');
	authority.access = Object.freeze({
		read: false,
		createDirectory: false,
		createFile: false,
		replaceContent: false,
		move: false,
		delete: false
	});
	authority.changeFeedMode = 'gap';
	await session.settle({ kind: 'reconcile', throughGeneration: changed.generation });
	await assert.rejects(session.read({ reference }), /access/u);
	const settled = await session.settle({
		kind: 'persist',
		throughGeneration: changed.generation
	});
	assert.strictEqual(authority.dispatchLog.length, 0);
	assert.strictEqual(protectedContent.records.size, 1);
	assert.strictEqual(
		settled.blockers.some(
			(blocker) => blocker.generation === changed.generation && blocker.kind === 'queued'
		),
		true
	);
	session.dispose();
});

test('disposal fences protected-store and authoritative continuations without retiring recovery', async () => {
	const protecting = await harness();
	const protectingReference = entry(protecting.session, 'src/main.ts').reference;
	const protectingChange = protecting.session.change({
		kind: 'replaceContent',
		reference: protectingReference,
		content: encoder.encode('protected'),
		mediaType: 'text/plain'
	});
	if (!protectingChange.accepted) throw new Error('replace rejected');
	let releaseProtection = () => {};
	protecting.protectedContent.putBarrier = new Promise<void>((resolve) => {
		releaseProtection = resolve;
	});
	const protection = protecting.session.settle({
		kind: 'protect',
		throughGeneration: protectingChange.generation
	});
	await waitFor(() => protecting.protectedContent.putCalls === 1);
	protecting.session.dispose();
	releaseProtection();
	await assert.rejects(protection, /disposed/u);
	assert.strictEqual(protecting.authority.dispatchLog.length, 0);
	assert.strictEqual(protecting.protectedContent.records.size, 1);
	const dispatched = await harness();
	const dispatchedReference = entry(dispatched.session, 'src/main.ts').reference;
	const first = dispatched.session.change({
		kind: 'replaceContent',
		reference: dispatchedReference,
		content: encoder.encode('first'),
		mediaType: 'text/plain'
	});
	const second = dispatched.session.change({
		kind: 'replaceContent',
		reference: dispatchedReference,
		content: encoder.encode('second'),
		mediaType: 'text/plain'
	});
	if (!first.accepted || !second.accepted) throw new Error('replace rejected');
	let releaseDispatch = () => {};
	dispatched.authority.responseBarriers.push(
		new Promise<void>((resolve) => {
			releaseDispatch = resolve;
		})
	);
	const persistence = dispatched.session.settle({
		kind: 'persist',
		throughGeneration: second.generation
	});
	await waitFor(() => dispatched.authority.dispatchLog.length === 1);
	dispatched.session.dispose();
	releaseDispatch();
	await assert.rejects(persistence, /disposed/u);
	assert.strictEqual(dispatched.authority.dispatchLog.length, 1);
	assert.strictEqual(dispatched.protectedContent.records.size, 2);
});

test('protected recovery reconstructs the working overlay and resumes the exact mutation after relaunch', async () => {
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'one' }
	]);
	const protectedContent = new InMemoryProtectedContent();
	const ids = new DeterministicWorkspaceIds();
	const first = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const reference = entry(first, 'answer.txt').reference;
	await first.read({ reference });
	const changed = first.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('recovered'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('not accepted');
	await first.settle({ kind: 'protect', throughGeneration: changed.generation });
	first.dispose();
	const restored = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	assert.strictEqual(restored.observe().current.generation, changed.generation);
	assert.strictEqual(decoder.decode((await restored.read({ reference })).content), 'recovered');
	assert.strictEqual(entry(restored, 'answer.txt').facts.recoveryProtection, 'protected');
	const persisted = await restored.settle({
		kind: 'persist',
		throughGeneration: changed.generation
	});
	assert.strictEqual(persisted.acknowledged, true);
	assert.strictEqual(
		decoder.decode((await authority.readCurrent(reference)).content),
		'recovered'
	);
	assert.strictEqual(protectedContent.records.size, 0);
	restored.dispose();
});

test('new work is rejected only after both authoritative dispatch and protected recovery are unavailable', async () => {
	const { authority, protectedContent, session } = await harness();
	const reference = entry(session, 'src/main.ts').reference;
	protectedContent.failWrites = true;
	authority.dispatchBehaviors.push('transportUnavailable');
	const first = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('retained only in memory'),
		mediaType: 'text/plain'
	});
	if (!first.accepted)
		throw new Error(
			'first change should be accepted while durability is not yet known unavailable'
		);
	await session.settle({ kind: 'persist', throughGeneration: first.generation });
	const second = session.change({
		kind: 'createFile',
		path: 'second.txt',
		content: encoder.encode('unsafe'),
		mediaType: 'text/plain'
	});
	assert.deepStrictEqual(second, {
		accepted: false,
		code: 'durabilityUnavailable',
		message: 'Neither server persistence nor protected recovery can currently accept new work.'
	});
	session.dispose();
});

test('a rejected dispatch promise also closes the authority durability path', async () => {
	const { authority, protectedContent, session } = await harness();
	const reference = entry(session, 'src/main.ts').reference;
	protectedContent.failWrites = true;
	authority.dispatchBehaviors.push('throw');
	const first = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('memory only'),
		mediaType: 'text/plain'
	});
	if (!first.accepted) throw new Error('first change rejected');
	await session.settle({ kind: 'persist', throughGeneration: first.generation });
	assert.strictEqual(
		session.observe().current.entries.find((value) => value.reference === reference)?.facts
			.remoteMutation,
		'outcomeUnknown'
	);
	assert.strictEqual(
		session.change({
			kind: 'createFile',
			path: 'unsafe.txt',
			content: encoder.encode('unsafe'),
			mediaType: 'text/plain'
		}).accepted,
		false
	);
	session.dispose();
});

test('acknowledged local references are persisted into protected dependent recovery', async () => {
	const authority = new InMemoryWorkspaceAuthority();
	const protectedContent = new InMemoryProtectedContent();
	const ids = new DeterministicWorkspaceIds();
	const first = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const created = first.change({
		kind: 'createFile',
		path: 'answer.txt',
		content: encoder.encode('one'),
		mediaType: 'text/plain'
	});
	if (!created.accepted || created.reference === undefined) throw new Error('create rejected');
	const replaced = first.change({
		kind: 'replaceContent',
		reference: created.reference,
		content: encoder.encode('two'),
		mediaType: 'text/plain'
	});
	if (!replaced.accepted) throw new Error('replace rejected');
	await first.settle({ kind: 'protect', throughGeneration: replaced.generation });
	await first.settle({ kind: 'persist', throughGeneration: created.generation });
	const stable = entry(first, 'answer.txt').reference;
	assert.notStrictEqual(stable, created.reference);
	first.dispose();
	const restored = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	assert.strictEqual(entry(restored, 'answer.txt').reference, stable);
	const result = await restored.settle({
		kind: 'persist',
		throughGeneration: replaced.generation
	});
	assert.strictEqual(result.acknowledged, true);
	assert.strictEqual(decoder.decode((await authority.readCurrent(stable)).content), 'two');
	restored.dispose();
});

test('an acknowledged local reference remains valid for later mutations', async () => {
	const authority = new InMemoryWorkspaceAuthority();
	const session = await createAttemptWorkspaceSession({
		authority,
		protectedContent: new InMemoryProtectedContent(),
		ids: new DeterministicWorkspaceIds(),
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const created = session.change({
		kind: 'createFile',
		path: 'answer.txt',
		content: encoder.encode('one'),
		mediaType: 'text/plain'
	});
	if (!created.accepted || created.reference === undefined) throw new Error('create rejected');
	await session.settle({ kind: 'persist', throughGeneration: created.generation });
	const stable = entry(session, 'answer.txt').reference;
	assert.notStrictEqual(stable, created.reference);
	const replaced = session.change({
		kind: 'replaceContent',
		reference: created.reference,
		content: encoder.encode('two'),
		mediaType: 'text/plain'
	});
	if (!replaced.accepted) throw new Error('retained local reference was rejected');
	await session.settle({ kind: 'persist', throughGeneration: replaced.generation });
	assert.strictEqual(decoder.decode((await authority.readCurrent(stable)).content), 'two');
	const moved = session.change({
		kind: 'move',
		reference: created.reference,
		destination: 'renamed.txt'
	});
	if (!moved.accepted)
		throw new Error('retained local reference could not move the acknowledged entry');
	await session.settle({ kind: 'persist', throughGeneration: moved.generation });
	assert.strictEqual(entry(session, 'renamed.txt').reference, stable);
	session.dispose();
});

test('acknowledgement retains its protected mapping chain until dependent recovery is rewritten', async () => {
	const authority = new InMemoryWorkspaceAuthority();
	const protectedContent = new InMemoryProtectedContent();
	const ids = new DeterministicWorkspaceIds();
	const first = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const created = first.change({
		kind: 'createFile',
		path: 'answer.txt',
		content: encoder.encode('one'),
		mediaType: 'text/plain'
	});
	if (!created.accepted || created.reference === undefined) throw new Error('create rejected');
	const replaced = first.change({
		kind: 'replaceContent',
		reference: created.reference,
		content: encoder.encode('two'),
		mediaType: 'text/plain'
	});
	if (!replaced.accepted) throw new Error('replace rejected');
	await first.settle({ kind: 'protect', throughGeneration: replaced.generation });
	// Skip the durable exact-command checkpoint; fail the dependent mapping rewrite.
	protectedContent.failWriteOnCall = protectedContent.putCalls + 2;
	const acknowledged = await first.settle({
		kind: 'persist',
		throughGeneration: created.generation
	});
	assert.strictEqual(acknowledged.acknowledged, true);
	assert.strictEqual(protectedContent.records.size, 2);
	first.dispose();
	protectedContent.failWriteOnCall = undefined;
	const restored = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const persisted = await restored.settle({
		kind: 'persist',
		throughGeneration: replaced.generation
	});
	assert.strictEqual(persisted.acknowledged, true);
	const stable = entry(restored, 'answer.txt').reference;
	assert.strictEqual(decoder.decode((await authority.readCurrent(stable)).content), 'two');
	assert.strictEqual(protectedContent.records.size, 0);
	restored.dispose();
});

test('an unprotected predecessor cannot acknowledge ahead of its protected local-reference dependent', async () => {
	const authority = new InMemoryWorkspaceAuthority();
	const protectedContent = new InMemoryProtectedContent();
	const session = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids: new DeterministicWorkspaceIds(),
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const created = session.change({
		kind: 'createFile',
		path: 'answer.txt',
		content: encoder.encode('one'),
		mediaType: 'text/plain'
	});
	if (!created.accepted || created.reference === undefined) throw new Error('create rejected');
	protectedContent.failStorageIds.add(`recovery:${created.reference}:1`);
	const replaced = session.change({
		kind: 'replaceContent',
		reference: created.reference,
		content: encoder.encode('two'),
		mediaType: 'text/plain'
	});
	if (!replaced.accepted) throw new Error('replace rejected');
	await session.settle({ kind: 'protect', throughGeneration: replaced.generation });
	const blocked = await session.settle({
		kind: 'persist',
		throughGeneration: created.generation
	});
	assert.strictEqual(blocked.acknowledged, false);
	assert.strictEqual(authority.dispatchLog.length, 0);
	assert.strictEqual(protectedContent.records.size, 1);
	protectedContent.failStorageIds.clear();
	const persisted = await session.settle({
		kind: 'persist',
		throughGeneration: replaced.generation
	});
	assert.strictEqual(persisted.acknowledged, true);
	const stable = entry(session, 'answer.txt').reference;
	assert.strictEqual(decoder.decode((await authority.readCurrent(stable)).content), 'two');
	assert.strictEqual(protectedContent.records.size, 0);
	session.dispose();
});

test('protected conflicts restore all three exact versions and remain resolvable', async () => {
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'one\ntwo\n' }
	]);
	const protectedContent = new InMemoryProtectedContent();
	const ids = new DeterministicWorkspaceIds();
	const first = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const reference = entry(first, 'answer.txt').reference;
	await first.read({ reference });
	const changed = first.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('LOCAL\ntwo\n'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('change rejected');
	authority.replaceExternally(reference, 'REMOTE\ntwo\n');
	await first.settle({ kind: 'persist', throughGeneration: changed.generation });
	first.dispose();
	const restored = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	assert.strictEqual(
		decoder.decode((await restored.read({ reference, version: 'conflictBase' })).content),
		'one\ntwo\n'
	);
	assert.strictEqual(
		decoder.decode((await restored.read({ reference, version: 'conflictLocal' })).content),
		'LOCAL\ntwo\n'
	);
	assert.strictEqual(
		decoder.decode(
			(await restored.read({ reference, version: 'conflictAuthoritative' })).content
		),
		'REMOTE\ntwo\n'
	);
	const resolved = await restored.resolveConflict(reference, 'local');
	if (!resolved.accepted) throw new Error('restored conflict was not resolvable');
	const persisted = await restored.settle({
		kind: 'persist',
		throughGeneration: resolved.generation
	});
	assert.strictEqual(persisted.acknowledged, true);
	assert.strictEqual(
		decoder.decode((await authority.readCurrent(reference)).content),
		'LOCAL\ntwo\n'
	);
	restored.dispose();
});

test('a protected conflict resolution restores its relationship and retires the original conflict', async () => {
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'one\ntwo\n' }
	]);
	const protectedContent = new InMemoryProtectedContent();
	const ids = new DeterministicWorkspaceIds();
	const first = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const reference = entry(first, 'answer.txt').reference;
	await first.read({ reference });
	const changed = first.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('LOCAL\ntwo\n'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('change rejected');
	authority.replaceExternally(reference, 'REMOTE\ntwo\n');
	await first.settle({ kind: 'persist', throughGeneration: changed.generation });
	const resolution = await first.resolveConflict(reference, 'local');
	if (!resolution.accepted) throw new Error('resolution rejected');
	await first.settle({ kind: 'protect', throughGeneration: resolution.generation });
	first.dispose();
	const restored = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const persisted = await restored.settle({
		kind: 'persist',
		throughGeneration: resolution.generation
	});
	assert.strictEqual(persisted.acknowledged, true);
	assert.strictEqual(protectedContent.records.size, 0);
	await assert.rejects(restored.read({ reference, version: 'conflictLocal' }), /unavailable/u);
	restored.dispose();
});

test('a failed conflict-record deletion retains the acknowledged resolution cleanup chain', async () => {
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'one\ntwo\n' }
	]);
	const protectedContent = new InMemoryProtectedContent();
	const ids = new DeterministicWorkspaceIds();
	const first = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const reference = entry(first, 'answer.txt').reference;
	await first.read({ reference });
	const changed = first.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('LOCAL\ntwo\n'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('change rejected');
	authority.replaceExternally(reference, 'REMOTE\ntwo\n');
	await first.settle({ kind: 'persist', throughGeneration: changed.generation });
	const resolution = await first.resolveConflict(reference, 'local');
	if (!resolution.accepted) throw new Error('resolution rejected');
	protectedContent.failDeleteOnCall = protectedContent.deleteCalls + 1;
	await first.settle({ kind: 'persist', throughGeneration: resolution.generation });
	assert.strictEqual(protectedContent.records.size, 1);
	first.dispose();
	const restored = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const persisted = await restored.settle({
		kind: 'persist',
		throughGeneration: resolution.generation
	});
	assert.strictEqual(persisted.acknowledged, true);
	assert.strictEqual(protectedContent.records.size, 0);
	await assert.rejects(restored.read({ reference, version: 'conflictLocal' }), /unavailable/u);
	restored.dispose();
});

test('protected recovery bounds every retained content body before restoration', async () => {
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'one' }
	]);
	const protectedContent = new InMemoryProtectedContent();
	const content = encoder.encode('x');
	protectedContent.records.set('recovery:oversized', {
		storageId: 'recovery:oversized',
		generation: 1,
		reference: 'entry:a' as WorkspaceEntryReference,
		operationState: 'queued',
		basePath: 'answer.txt' as never,
		baseKind: 'file',
		baseContentVersion: 'version:1' as never,
		baseContent: new Uint8Array(9),
		baseMediaType: 'text/plain',
		content,
		idempotencyKey: 'mutation:oversized',
		mutation: {
			kind: 'replaceContent',
			reference: 'entry:a' as WorkspaceEntryReference,
			content,
			mediaType: 'text/plain'
		}
	} satisfies RecoveryRecord);
	const limits = {
		...WORKSPACE_V1_DEFAULT_LIMITS,
		effectiveFileBytes: 8,
		effectiveTotalBytes: 32
	};
	await assert.rejects(
		createAttemptWorkspaceSession({
			authority,
			protectedContent,
			ids: new DeterministicWorkspaceIds(),
			limits
		}),
		/file limit/u
	);
	await assert.rejects(
		createAttemptWorkspaceSession({
			authority,
			protectedContent: new InMemoryProtectedContent(),
			ids: new DeterministicWorkspaceIds(),
			limits: { ...WORKSPACE_V1_DEFAULT_LIMITS, effectiveFileBytes: Number.NaN }
		}),
		/hard maxima/u
	);
});

test('protected recovery validates the raw closed mutation before cloning content', async () => {
	const authority = new InMemoryWorkspaceAuthority();
	const protectedPort = (record: RecoveryRecord) => ({
		loadRecovery: async () => [record],
		putRecovery: async () => {},
		deleteRecovery: async () => {}
	});
	const arrayLike = {
		storageId: 'recovery:array-like',
		generation: 1,
		reference: 'local:1',
		operationState: 'queued',
		content: new Uint8Array(),
		idempotencyKey: 'mutation:array-like',
		mutation: {
			kind: 'createFile',
			path: 'answer.txt',
			content: { length: 0x7fffffff },
			mediaType: 'text/plain'
		}
	} as unknown as RecoveryRecord;
	await assert.rejects(
		createAttemptWorkspaceSession({
			authority,
			protectedContent: protectedPort(arrayLike),
			ids: new DeterministicWorkspaceIds(),
			limits: WORKSPACE_V1_DEFAULT_LIMITS
		}),
		/mutation|content/u
	);
	const invalidMedia = {
		storageId: 'recovery:media',
		generation: 1,
		reference: 'local:1',
		operationState: 'queued',
		content: new Uint8Array(),
		idempotencyKey: 'mutation:media',
		mutation: {
			kind: 'createFile',
			path: 'answer.txt',
			content: new Uint8Array(),
			mediaType: 42
		}
	} as unknown as RecoveryRecord;
	await assert.rejects(
		createAttemptWorkspaceSession({
			authority,
			protectedContent: protectedPort(invalidMedia),
			ids: new DeterministicWorkspaceIds(),
			limits: WORKSPACE_V1_DEFAULT_LIMITS
		}),
		/file content/u
	);
});

test('protected recovery history is not rejected by the authoritative current-total limit', async () => {
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'base' }
	]);
	const protectedContent = new InMemoryProtectedContent();
	const content = encoder.encode('locl');
	protectedContent.records.set('recovery:conflict', {
		storageId: 'recovery:conflict',
		generation: 1,
		reference: 'entry:a' as WorkspaceEntryReference,
		operationState: 'conflicted',
		rejection: 'advancedContent',
		basePath: 'answer.txt' as never,
		baseKind: 'file',
		baseContentVersion: 'version:1' as never,
		baseContent: encoder.encode('base'),
		baseMediaType: 'text/plain',
		conflictAuthoritativeContentVersion: 'version:2' as never,
		conflictAuthoritativeContent: encoder.encode('auth'),
		conflictAuthoritativeMediaType: 'text/plain',
		content,
		idempotencyKey: 'mutation:conflict',
		mutation: {
			kind: 'replaceContent',
			reference: 'entry:a' as WorkspaceEntryReference,
			content,
			mediaType: 'text/plain'
		}
	} satisfies RecoveryRecord);
	const limits = {
		...WORKSPACE_V1_DEFAULT_LIMITS,
		effectiveFileBytes: 8,
		effectiveTotalBytes: 8
	};
	const restored = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids: new DeterministicWorkspaceIds(),
		limits
	});
	assert.strictEqual(
		decoder.decode(
			(
				await restored.read({
					reference: 'entry:a' as WorkspaceEntryReference,
					version: 'conflictBase'
				})
			).content
		),
		'base'
	);
	assert.strictEqual(
		decoder.decode(
			(
				await restored.read({
					reference: 'entry:a' as WorkspaceEntryReference,
					version: 'conflictLocal'
				})
			).content
		),
		'locl'
	);
	assert.strictEqual(
		decoder.decode(
			(
				await restored.read({
					reference: 'entry:a' as WorkspaceEntryReference,
					version: 'conflictAuthoritative'
				})
			).content
		),
		'auth'
	);
	restored.dispose();
});

test('advanced-content recovery for delete does not require replace-only conflict bodies', async () => {
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'one' }
	]);
	const protectedContent = new InMemoryProtectedContent();
	const ids = new DeterministicWorkspaceIds();
	const first = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const reference = entry(first, 'answer.txt').reference;
	const changed = first.change({ kind: 'delete', reference });
	if (!changed.accepted) throw new Error('delete rejected');
	authority.replaceExternally(reference, 'remote');
	const conflict = await first.settle({ kind: 'persist', throughGeneration: changed.generation });
	assert.strictEqual(
		conflict.blockers.some((value) => value.kind === 'conflicted'),
		true
	);
	first.dispose();
	const restored = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	assert.strictEqual(
		restored.observe().current.entries.some((value) => value.reference === reference),
		false
	);
	const discarded = await restored.discard(reference);
	assert.strictEqual(discarded.accepted, true);
	assert.strictEqual(
		restored.observe().current.entries.some((value) => value.reference === reference),
		true
	);
	restored.dispose();
});

test('failed authoritative conflict hydration remains protected and retries after relaunch', async () => {
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'one\ntwo\n' }
	]);
	const protectedContent = new InMemoryProtectedContent();
	const ids = new DeterministicWorkspaceIds();
	const first = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const reference = entry(first, 'answer.txt').reference;
	await first.read({ reference });
	const changed = first.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('LOCAL\ntwo\n'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('change rejected');
	authority.replaceExternally(reference, 'REMOTE\ntwo\n');
	authority.readFailures = 1;
	const pending = await first.settle({ kind: 'persist', throughGeneration: changed.generation });
	assert.strictEqual(
		pending.blockers.some((value) => value.kind === 'conflicted'),
		true
	);
	assert.strictEqual(
		[...protectedContent.records.values()][0]?.operationState,
		'conflictPending'
	);
	first.dispose();
	const restored = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const reconciled = await restored.settle({
		kind: 'persist',
		throughGeneration: changed.generation
	});
	assert.strictEqual(
		reconciled.blockers.some((value) => value.kind === 'conflicted'),
		true
	);
	assert.strictEqual(
		decoder.decode(
			(await restored.read({ reference, version: 'conflictAuthoritative' })).content
		),
		'REMOTE\ntwo\n'
	);
	restored.dispose();
});

test('discard reports success only after protected recovery has been removed', async () => {
	const { protectedContent, session } = await harness();
	const reference = entry(session, 'src/main.ts').reference;
	const changed = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('local'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('not accepted');
	await session.settle({ kind: 'protect', throughGeneration: changed.generation });
	assert.strictEqual(protectedContent.records.size, 1);
	protectedContent.failDeletes = true;
	const failed = await session.discard(reference);
	assert.strictEqual(failed.accepted, false);
	assert.strictEqual(entry(session, 'src/main.ts').facts.contentRelation, 'modified');
	assert.strictEqual(protectedContent.records.size, 1);
	protectedContent.failDeletes = false;
	const discarded = await session.discard(reference);
	assert.strictEqual(discarded.accepted, true);
	assert.strictEqual(entry(session, 'src/main.ts').facts.contentRelation, 'unchanged');
	assert.strictEqual(protectedContent.records.size, 0);
	session.dispose();
});

test('discard serializes behind an in-flight recovery write and cannot recreate discarded recovery', async () => {
	const { protectedContent, session } = await harness();
	const reference = entry(session, 'src/main.ts').reference;
	const changed = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('local'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('not accepted');
	let releaseWrite = () => {};
	protectedContent.putBarrier = new Promise<void>((resolve) => {
		releaseWrite = resolve;
	});
	const protecting = session.settle({ kind: 'protect', throughGeneration: changed.generation });
	await waitFor(() => protectedContent.putCalls === 1);
	const discarding = session.discard(reference);
	releaseWrite();
	await protecting;
	const discarded = await discarding;
	assert.strictEqual(discarded.accepted, true);
	assert.strictEqual(protectedContent.records.size, 0);
	session.dispose();
});

test('failed acknowledgement cleanup remains replayable until its recovery record is deleted', async () => {
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'one' }
	]);
	const protectedContent = new InMemoryProtectedContent();
	protectedContent.failDeleteOnCall = 1;
	const ids = new DeterministicWorkspaceIds();
	const first = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const reference = entry(first, 'answer.txt').reference;
	await first.read({ reference });
	const changed = first.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('two'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('change rejected');
	const acknowledged = await first.settle({
		kind: 'persist',
		throughGeneration: changed.generation
	});
	assert.strictEqual(acknowledged.acknowledged, true);
	assert.strictEqual(protectedContent.records.size, 1);
	first.dispose();
	const restored = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids,
		limits: WORKSPACE_V1_DEFAULT_LIMITS
	});
	const replayed = await restored.settle({
		kind: 'persist',
		throughGeneration: changed.generation
	});
	assert.strictEqual(replayed.acknowledged, true);
	assert.strictEqual(protectedContent.records.size, 0);
	assert.strictEqual(decoder.decode((await authority.readCurrent(reference)).content), 'two');
	restored.dispose();
});

test('multi-operation discard restores already removed recovery when a later removal fails', async () => {
	const { protectedContent, session } = await harness();
	const reference = entry(session, 'src/main.ts').reference;
	const first = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('first'),
		mediaType: 'text/plain'
	});
	const second = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('second'),
		mediaType: 'text/plain'
	});
	if (!first.accepted || !second.accepted) throw new Error('not accepted');
	await session.settle({ kind: 'protect', throughGeneration: second.generation });
	assert.strictEqual(protectedContent.records.size, 2);
	protectedContent.failDeleteOnCall = 2;
	const result = await session.discard(reference);
	assert.strictEqual(result.accepted, false);
	assert.strictEqual(protectedContent.records.size, 2);
	assert.strictEqual(entry(session, 'src/main.ts').facts.recoveryProtection, 'protected');
	session.dispose();
});

test('workspace v1 performs all five mutations and preserves stable identity across move', async () => {
	const { session } = await harness();
	const original = entry(session, 'src/main.ts').reference;
	for (const intent of [
		{ kind: 'createDirectory', path: 'tests' } as const,
		{
			kind: 'createFile',
			path: 'tests/main.test.ts',
			content: encoder.encode('test()'),
			mediaType: 'text/typescript'
		} as const,
		{
			kind: 'replaceContent',
			reference: original,
			content: encoder.encode('updated'),
			mediaType: 'text/typescript'
		} as const,
		{ kind: 'move', reference: original, destination: 'src/index.ts' } as const
	]) {
		const result = session.change(intent);
		assert.strictEqual(result.accepted, true);
		if (result.accepted)
			assert.strictEqual(
				(await session.settle({ kind: 'persist', throughGeneration: result.generation }))
					.acknowledged,
				true
			);
	}
	assert.strictEqual(entry(session, 'src/index.ts').reference, original);
	const created = entry(session, 'tests/main.test.ts');
	const deleted = session.change({ kind: 'delete', reference: created.reference });
	assert.strictEqual(deleted.accepted, true);
	if (deleted.accepted)
		await session.settle({ kind: 'persist', throughGeneration: deleted.generation });
	assert.strictEqual(
		session.observe().current.entries.some((value) => value.path === 'tests/main.test.ts'),
		false
	);
	session.dispose();
});

test('unknown result lookup reuses one key and does not duplicate a mutation', async () => {
	const { authority, protectedContent, session } = await harness();
	authority.dispatchBehaviors.push('unknownAfterApply');
	const reference = entry(session, 'src/main.ts').reference;
	const changed = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('once'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('not accepted');
	const first = await session.settle({ kind: 'persist', throughGeneration: changed.generation });
	assert.strictEqual(
		first.blockers.some((value) => value.kind === 'outcomeUnknown'),
		true
	);
	assert.strictEqual(protectedContent.records.size, 1);
	const second = await session.settle({ kind: 'persist', throughGeneration: changed.generation });
	assert.strictEqual(second.acknowledged, true);
	assert.strictEqual(authority.dispatchLog.length, 1);
	assert.strictEqual(protectedContent.records.size, 0);
	session.dispose();
});

test('cancellation before dispatch is queued and protected, never acknowledged', async () => {
	const { authority, session } = await harness();
	const reference = entry(session, 'src/main.ts').reference;
	const changed = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('pending'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('not accepted');
	const result = await session.settle({
		kind: 'persist',
		throughGeneration: changed.generation,
		cancellation: CancellationToken.Cancelled
	});
	assert.strictEqual(authority.dispatchLog.length, 0);
	assert.strictEqual(result.protected, true);
	assert.strictEqual(
		result.blockers.some((value) => value.kind === 'queued'),
		true
	);
	session.dispose();
});

test('cursor gap refresh reapplies local overlay instead of overwriting work', async () => {
	const { authority, session } = await harness();
	const reference = entry(session, 'src/main.ts').reference;
	const changed = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('local'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('not accepted');
	authority.replaceExternally(reference, 'remote');
	authority.changeFeedMode = 'gap';
	await session.settle({ kind: 'reconcile', throughGeneration: changed.generation });
	assert.strictEqual(decoder.decode((await session.read({ reference })).content), 'local');
	assert.strictEqual(entry(session, 'src/main.ts').facts.contentRelation, 'modified');
	session.dispose();
});

test('reconciliation never changes the exact optimistic base captured for a local edit', async () => {
	const { authority, session } = await harness();
	const reference = entry(session, 'src/main.ts').reference;
	const initial = await authority.readCurrent(reference);
	const changed = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('local'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('not accepted');
	authority.replaceExternally(reference, 'remote');
	await session.settle({ kind: 'reconcile', throughGeneration: changed.generation });
	const result = await session.settle({ kind: 'persist', throughGeneration: changed.generation });
	const dispatched = authority.dispatchLog[0];
	assert.strictEqual(dispatched?.kind, 'replaceContent');
	if (dispatched?.kind !== 'replaceContent') throw new Error('replace command missing');
	assert.strictEqual(dispatched.expectedContentVersion, initial.contentVersion);
	assert.strictEqual(
		result.blockers.some((value) => value.kind === 'conflicted'),
		true
	);
	session.dispose();
});

test('move and delete dispatch retain the exact accepted path and content version across reconciliation', async () => {
	const moved = await harness([{ reference: 'entry:a', path: 'src', content: 'not-used' }]);
	const moveReference = entry(moved.session, 'src').reference;
	const move = moved.session.change({
		kind: 'move',
		reference: moveReference,
		destination: 'lib'
	});
	if (!move.accepted) throw new Error('move not accepted');
	moved.authority.moveExternally(moveReference, 'remote');
	await moved.session.settle({ kind: 'reconcile', throughGeneration: move.generation });
	const moveResult = await moved.session.settle({
		kind: 'persist',
		throughGeneration: move.generation
	});
	const moveCommand = moved.authority.dispatchLog[0];
	assert.strictEqual(moveCommand?.kind, 'move');
	if (moveCommand?.kind !== 'move') throw new Error('move command missing');
	assert.strictEqual(moveCommand.currentPath, 'src');
	assert.strictEqual(
		moveResult.blockers.some((value) => value.kind === 'conflicted'),
		true
	);
	moved.session.dispose();
	const deleted = await harness();
	const deleteReference = entry(deleted.session, 'src/main.ts').reference;
	const initial = await deleted.authority.readCurrent(deleteReference);
	const remove = deleted.session.change({ kind: 'delete', reference: deleteReference });
	if (!remove.accepted) throw new Error('delete not accepted');
	deleted.authority.replaceExternally(deleteReference, 'remote');
	await deleted.session.settle({ kind: 'reconcile', throughGeneration: remove.generation });
	const deleteResult = await deleted.session.settle({
		kind: 'persist',
		throughGeneration: remove.generation
	});
	const deleteCommand = deleted.authority.dispatchLog[0];
	assert.strictEqual(deleteCommand?.kind, 'delete');
	if (deleteCommand?.kind !== 'delete') throw new Error('delete command missing');
	assert.strictEqual(deleteCommand.expectedContentVersion, initial.contentVersion);
	assert.strictEqual(
		deleteResult.blockers.some((value) => value.kind === 'conflicted'),
		true
	);
	deleted.session.dispose();
});

test('malformed changes feed falls back to a full authoritative snapshot', async () => {
	const { authority, session } = await harness();
	const before = authority.getSnapshotCalls;
	const current = await authority.getSnapshot();
	authority.changeFeedOverride = {
		kind: 'changes',
		from: (Number(current.cursor) + 1) as typeof current.cursor,
		to: current.cursor,
		snapshot: current
	};
	await session.settle({ kind: 'reconcile', throughGeneration: 0 as never });
	assert.strictEqual(authority.getSnapshotCalls, before + 2);
	session.dispose();
});

test('independent entries dispatch concurrently while same-entry versions serialize', async () => {
	const { authority, session } = await harness([
		{ reference: 'entry:a', path: 'a.ts', content: 'a' },
		{ reference: 'entry:b', path: 'b.ts', content: 'b' }
	]);
	let release = () => {};
	authority.dispatchBarrier = new Promise<void>((resolve) => {
		release = resolve;
	});
	const a = entry(session, 'a.ts').reference;
	const b = entry(session, 'b.ts').reference;
	const first = session.change({
		kind: 'replaceContent',
		reference: a,
		content: encoder.encode('a1'),
		mediaType: 'text/plain'
	});
	const second = session.change({
		kind: 'replaceContent',
		reference: b,
		content: encoder.encode('b1'),
		mediaType: 'text/plain'
	});
	if (!first.accepted || !second.accepted) throw new Error('not accepted');
	const pending = session.settle({ kind: 'persist', throughGeneration: second.generation });
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.strictEqual(authority.maximumConcurrentDispatches, 2);
	release();
	await pending;
	authority.dispatchBarrier = undefined;
	const third = session.change({
		kind: 'replaceContent',
		reference: a,
		content: encoder.encode('a2'),
		mediaType: 'text/plain'
	});
	const fourth = session.change({
		kind: 'replaceContent',
		reference: a,
		content: encoder.encode('a3'),
		mediaType: 'text/plain'
	});
	if (!third.accepted || !fourth.accepted) throw new Error('not accepted');
	await session.settle({ kind: 'persist', throughGeneration: fourth.generation });
	assert.strictEqual(decoder.decode((await authority.readCurrent(a)).content), 'a3');
	session.dispose();
});

test('late independent acknowledgement cannot roll the authoritative cursor backward', async () => {
	const { authority, session } = await harness([
		{ reference: 'entry:a', path: 'a.ts', content: 'a' },
		{ reference: 'entry:b', path: 'b.ts', content: 'b' }
	]);
	let releaseFirst = () => {};
	authority.responseBarriers.push(
		new Promise<void>((resolve) => {
			releaseFirst = resolve;
		}),
		undefined
	);
	const a = entry(session, 'a.ts').reference;
	const b = entry(session, 'b.ts').reference;
	const first = session.change({
		kind: 'replaceContent',
		reference: a,
		content: encoder.encode('a1'),
		mediaType: 'text/plain'
	});
	const second = session.change({
		kind: 'replaceContent',
		reference: b,
		content: encoder.encode('b1'),
		mediaType: 'text/plain'
	});
	if (!first.accepted || !second.accepted) throw new Error('not accepted');
	const pending = session.settle({ kind: 'persist', throughGeneration: second.generation });
	await waitFor(() => session.observe().current.cursor === 2);
	releaseFirst();
	const settled = await pending;
	assert.strictEqual(settled.cursor, 2);
	assert.strictEqual(session.observe().current.cursor, 2);
	session.dispose();
});

test('a late acknowledgement advances dependent content from its own snapshot', async () => {
	const { authority, session } = await harness([
		{ reference: 'entry:a', path: 'a.ts', content: 'a' },
		{ reference: 'entry:b', path: 'b.ts', content: 'b' }
	]);
	let releaseFirst = () => {};
	const a = entry(session, 'a.ts').reference;
	const b = entry(session, 'b.ts').reference;
	authority.responseBarriers.push(
		new Promise<void>((resolve) => {
			releaseFirst = resolve;
		}),
		undefined
	);
	authority.afterApplyHooks.push(() => authority.replaceExternally(a, 'external'), undefined);
	const first = session.change({
		kind: 'replaceContent',
		reference: a,
		content: encoder.encode('a1'),
		mediaType: 'text/plain'
	});
	const dependent = session.change({
		kind: 'replaceContent',
		reference: a,
		content: encoder.encode('a2'),
		mediaType: 'text/plain'
	});
	const independent = session.change({
		kind: 'replaceContent',
		reference: b,
		content: encoder.encode('b1'),
		mediaType: 'text/plain'
	});
	if (!first.accepted || !dependent.accepted || !independent.accepted)
		throw new Error('not accepted');
	const pending = session.settle({ kind: 'persist', throughGeneration: independent.generation });
	await waitFor(() => session.observe().current.cursor === 3);
	releaseFirst();
	const settled = await pending;
	assert.strictEqual(
		settled.blockers.some(
			(blocker) =>
				blocker.generation === dependent.generation && blocker.kind === 'conflicted'
		),
		true
	);
	assert.strictEqual(decoder.decode((await authority.readCurrent(a)).content), 'external');
	session.dispose();
});

test('directory subtree mutations serialize against descendant content changes', async () => {
	const { authority, session } = await harness([]);
	const directory = session.change({ kind: 'createDirectory', path: 'src' });
	if (!directory.accepted) throw new Error('directory rejected');
	await session.settle({ kind: 'persist', throughGeneration: directory.generation });
	const created = session.change({
		kind: 'createFile',
		path: 'src/main.ts',
		content: encoder.encode('one'),
		mediaType: 'text/typescript'
	});
	if (!created.accepted) throw new Error('file rejected');
	await session.settle({ kind: 'persist', throughGeneration: created.generation });
	const directoryReference = entry(session, 'src').reference;
	const fileReference = entry(session, 'src/main.ts').reference;
	let release = () => {};
	authority.dispatchBarrier = new Promise<void>((resolve) => {
		release = resolve;
	});
	authority.maximumConcurrentDispatches = 0;
	const moved = session.change({
		kind: 'move',
		reference: directoryReference,
		destination: 'lib'
	});
	const edited = session.change({
		kind: 'replaceContent',
		reference: fileReference,
		content: encoder.encode('two'),
		mediaType: 'text/typescript'
	});
	if (!moved.accepted || !edited.accepted) throw new Error('subtree change rejected');
	const pending = session.settle({ kind: 'persist', throughGeneration: edited.generation });
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.strictEqual(authority.maximumConcurrentDispatches, 1);
	release();
	await pending;
	assert.strictEqual(entry(session, 'lib/main.ts').reference, fileReference);
	session.dispose();
});

test('directory moves project mutation facts across the subtree without claiming content edits', async () => {
	const { session } = await harness([]);
	const directory = session.change({ kind: 'createDirectory', path: 'src' });
	if (!directory.accepted) throw new Error('directory rejected');
	await session.settle({ kind: 'persist', throughGeneration: directory.generation });
	const created = session.change({
		kind: 'createFile',
		path: 'src/main.ts',
		content: encoder.encode('one'),
		mediaType: 'text/typescript'
	});
	if (!created.accepted) throw new Error('file rejected');
	await session.settle({ kind: 'persist', throughGeneration: created.generation });
	const directoryReference = entry(session, 'src').reference;
	const fileReference = entry(session, 'src/main.ts').reference;
	const edited = session.change({
		kind: 'replaceContent',
		reference: fileReference,
		content: encoder.encode('two'),
		mediaType: 'text/typescript'
	});
	const moved = session.change({
		kind: 'move',
		reference: directoryReference,
		destination: 'lib'
	});
	if (!edited.accepted || !moved.accepted) throw new Error('subtree change rejected');
	assert.deepStrictEqual(entry(session, 'lib').facts, {
		contentRelation: 'unchanged',
		remoteMutation: 'queued',
		recoveryProtection: 'pending'
	});
	assert.deepStrictEqual(entry(session, 'lib/main.ts').facts, {
		contentRelation: 'modified',
		remoteMutation: 'queued',
		recoveryProtection: 'pending'
	});
	session.dispose();
});

test('later subtree moves cannot hide a descendant conflict or failed recovery', async () => {
	const { authority, protectedContent, session } = await harness([]);
	const directory = session.change({ kind: 'createDirectory', path: 'src' });
	if (!directory.accepted) throw new Error('directory rejected');
	await session.settle({ kind: 'persist', throughGeneration: directory.generation });
	const created = session.change({
		kind: 'createFile',
		path: 'src/main.ts',
		content: encoder.encode('one'),
		mediaType: 'text/typescript'
	});
	if (!created.accepted) throw new Error('file rejected');
	await session.settle({ kind: 'persist', throughGeneration: created.generation });
	const directoryReference = entry(session, 'src').reference;
	const fileReference = entry(session, 'src/main.ts').reference;
	await session.read({ reference: fileReference });
	const edited = session.change({
		kind: 'replaceContent',
		reference: fileReference,
		content: encoder.encode('local'),
		mediaType: 'text/typescript'
	});
	if (!edited.accepted) throw new Error('edit rejected');
	protectedContent.failWrites = true;
	authority.replaceExternally(fileReference, 'remote');
	await session.settle({ kind: 'persist', throughGeneration: edited.generation });
	const moved = session.change({
		kind: 'move',
		reference: directoryReference,
		destination: 'lib'
	});
	if (!moved.accepted) throw new Error('move rejected');
	assert.deepStrictEqual(entry(session, 'lib/main.ts').facts, {
		contentRelation: 'modified',
		remoteMutation: 'conflicted',
		recoveryProtection: 'failed'
	});
	session.dispose();
});

test('a creation collision persists retained content at an authorized new path', async () => {
	const { authority, protectedContent, session } = await harness([]);
	const created = session.change({
		kind: 'createFile',
		path: 'answer.txt',
		content: encoder.encode('local'),
		mediaType: 'text/plain'
	});
	if (!created.accepted || created.reference === undefined) throw new Error('create rejected');
	authority.createExternally('entry:remote', 'answer.txt', 'remote');
	const conflicted = await session.settle({
		kind: 'persist',
		throughGeneration: created.generation
	});
	assert.strictEqual(
		conflicted.blockers.some(
			(blocker) => blocker.generation === created.generation && blocker.kind === 'conflicted'
		),
		true
	);
	assertUniquePaths(session);
	assert.strictEqual(entry(session, 'answer.txt').reference, created.reference);
	assert.strictEqual(
		decoder.decode((await session.read({ reference: created.reference })).content),
		'local'
	);
	const repathed = session.change({
		kind: 'move',
		reference: created.reference,
		destination: 'recovered.txt'
	});
	if (!repathed.accepted) throw new Error('repath rejected');
	assertUniquePaths(session);
	assert.strictEqual(entry(session, 'answer.txt').reference, 'entry:remote');
	assert.strictEqual(entry(session, 'recovered.txt').reference, created.reference);
	const persisted = await session.settle({
		kind: 'persist',
		throughGeneration: repathed.generation
	});
	assert.strictEqual(persisted.acknowledged, true);
	assert.strictEqual(protectedContent.records.size, 0);
	assertUniquePaths(session);
	assert.strictEqual(entry(session, 'answer.txt').reference, 'entry:remote');
	const recovered = entry(session, 'recovered.txt');
	assert.notStrictEqual(recovered.reference, created.reference);
	assert.strictEqual(
		decoder.decode((await authority.readCurrent(recovered.reference)).content),
		'local'
	);
	session.dispose();
});

test('a pending creation-collision repath fences a second destination until settlement', async () => {
	const { authority, session } = await harness([]);
	const created = session.change({
		kind: 'createFile',
		path: 'answer.txt',
		content: encoder.encode('local'),
		mediaType: 'text/plain'
	});
	if (!created.accepted || created.reference === undefined) throw new Error('create rejected');
	authority.createExternally('entry:remote', 'answer.txt', 'remote');
	await session.settle({ kind: 'persist', throughGeneration: created.generation });
	const first = session.change({
		kind: 'move',
		reference: created.reference,
		destination: 'recovered-a.txt'
	});
	if (!first.accepted) throw new Error('first repath rejected');
	const generation = session.observe().current.generation;
	assert.deepStrictEqual(
		session.change({
			kind: 'move',
			reference: created.reference,
			destination: 'recovered-b.txt'
		}),
		{
			accepted: false,
			code: 'unsupported',
			message:
				'A path-conflict resolution is already pending; settle it before choosing another destination.'
		}
	);
	assert.strictEqual(session.observe().current.generation, generation);
	const settled = await session.settle({ kind: 'persist', throughGeneration: first.generation });
	assert.strictEqual(settled.acknowledged, true);
	assertUniquePaths(session);
	assert.strictEqual(
		session.observe().current.entries.some((candidate) => candidate.path === 'recovered-b.txt'),
		false
	);
	assert.strictEqual(
		decoder.decode(
			(await authority.readCurrent(entry(session, 'recovered-a.txt').reference)).content
		),
		'local'
	);
	session.dispose();
});

test('a translated creation-collision repath counts the newly revealed authority against the total limit', async () => {
	const authority = new InMemoryWorkspaceAuthority();
	const protectedContent = new InMemoryProtectedContent();
	const limits = {
		...WORKSPACE_V1_DEFAULT_LIMITS,
		effectiveFileBytes: 8,
		effectiveTotalBytes: 8
	};
	const session = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids: new DeterministicWorkspaceIds(),
		limits
	});
	const created = session.change({
		kind: 'createFile',
		path: 'answer.txt',
		content: encoder.encode('four'),
		mediaType: 'text/plain'
	});
	if (!created.accepted || created.reference === undefined) throw new Error('create rejected');
	authority.createExternally('entry:remote', 'answer.txt', 'remote');
	await session.settle({ kind: 'persist', throughGeneration: created.generation });
	const generation = session.observe().current.generation;
	assert.deepStrictEqual(
		session.change({
			kind: 'move',
			reference: created.reference,
			destination: 'recovered.txt'
		}),
		{
			accepted: false,
			code: 'sizeLimit',
			message: 'Change exceeds the effective Workspace total limit.'
		}
	);
	assert.strictEqual(session.observe().current.generation, generation);
	assert.strictEqual(entry(session, 'answer.txt').reference, created.reference);
	session.dispose();
});

test('a move collision persists from the authoritative current path without merging stable-reference subtrees', async () => {
	const { authority, session } = await harness([
		{ reference: 'entry:source', path: 'source.txt', content: 'source' }
	]);
	const source = entry(session, 'source.txt').reference;
	const moved = session.change({ kind: 'move', reference: source, destination: 'taken.txt' });
	if (!moved.accepted) throw new Error('move rejected');
	authority.createExternally('entry:remote', 'taken.txt', 'remote');
	const conflicted = await session.settle({
		kind: 'persist',
		throughGeneration: moved.generation
	});
	assert.strictEqual(
		conflicted.blockers.some(
			(blocker) => blocker.generation === moved.generation && blocker.kind === 'conflicted'
		),
		true
	);
	assertUniquePaths(session);
	assert.strictEqual(entry(session, 'taken.txt').reference, source);
	assert.strictEqual(
		session.observe().current.entries.some((candidate) => candidate.path === 'source.txt'),
		false
	);
	const repathed = session.change({
		kind: 'move',
		reference: source,
		destination: 'recovered.txt'
	});
	if (!repathed.accepted) throw new Error('repath rejected');
	assertUniquePaths(session);
	assert.strictEqual(entry(session, 'taken.txt').reference, 'entry:remote');
	assert.strictEqual(entry(session, 'recovered.txt').reference, source);
	const persisted = await session.settle({
		kind: 'persist',
		throughGeneration: repathed.generation
	});
	assert.strictEqual(persisted.acknowledged, true);
	assertUniquePaths(session);
	assert.strictEqual(entry(session, 'taken.txt').reference, 'entry:remote');
	assert.strictEqual(entry(session, 'recovered.txt').reference, source);
	assert.strictEqual(
		session.observe().current.entries.some((candidate) => candidate.path === 'source.txt'),
		false
	);
	assert.strictEqual(decoder.decode((await authority.readCurrent(source)).content), 'source');
	session.dispose();
});

test('a pending stable-reference move repath fences a second destination until settlement', async () => {
	const { authority, session } = await harness([
		{ reference: 'entry:source', path: 'source.txt', content: 'source' }
	]);
	const source = entry(session, 'source.txt').reference;
	const moved = session.change({ kind: 'move', reference: source, destination: 'taken.txt' });
	if (!moved.accepted) throw new Error('move rejected');
	authority.createExternally('entry:remote', 'taken.txt', 'remote');
	await session.settle({ kind: 'persist', throughGeneration: moved.generation });
	const first = session.change({
		kind: 'move',
		reference: source,
		destination: 'recovered-a.txt'
	});
	if (!first.accepted) throw new Error('first repath rejected');
	assert.strictEqual(
		session.change({ kind: 'move', reference: source, destination: 'recovered-b.txt' })
			.accepted,
		false
	);
	const settled = await session.settle({ kind: 'persist', throughGeneration: first.generation });
	assert.strictEqual(settled.acknowledged, true);
	assertUniquePaths(session);
	assert.strictEqual(entry(session, 'recovered-a.txt').reference, source);
	assert.strictEqual(
		session.observe().current.entries.some((candidate) => candidate.path === 'recovered-b.txt'),
		false
	);
	session.dispose();
});

test('discarding a path collision restores the complete authoritative hierarchy', async () => {
	const { authority, session } = await harness([]);
	const created = session.change({
		kind: 'createFile',
		path: 'answer.txt',
		content: encoder.encode('local'),
		mediaType: 'text/plain'
	});
	if (!created.accepted || created.reference === undefined) throw new Error('create rejected');
	authority.createExternally('entry:remote', 'answer.txt', 'remote');
	await session.settle({ kind: 'persist', throughGeneration: created.generation });
	const discarded = await session.discard(created.reference);
	assert.strictEqual(discarded.accepted, true);
	assertUniquePaths(session);
	assert.strictEqual(entry(session, 'answer.txt').reference, 'entry:remote');
	assert.strictEqual(
		decoder.decode(
			(await authority.readCurrent('entry:remote' as WorkspaceEntryReference)).content
		),
		'remote'
	);
	session.dispose();
});

test('conflict, rejection, protection failure, revocation, paths and size limits remain explicit', async () => {
	const { authority, protectedContent, session } = await harness();
	const reference = entry(session, 'src/main.ts').reference;
	authority.dispatchBehaviors.push('conflict');
	const conflictChange = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('conflict'),
		mediaType: 'text/plain'
	});
	if (!conflictChange.accepted) throw new Error('not accepted');
	const conflict = await session.settle({
		kind: 'persist',
		throughGeneration: conflictChange.generation
	});
	assert.strictEqual(
		conflict.blockers.some((value) => value.kind === 'conflicted'),
		true
	);
	assert.strictEqual(protectedContent.records.size, 1);
	const resolution = await session.resolveConflict(reference, 'local');
	assert.strictEqual(resolution.accepted, true);
	protectedContent.failWrites = true;
	const close = await session.settle({
		kind: 'controlledClose',
		throughGeneration: session.observe().current.generation
	});
	assert.strictEqual(close.protected, false);
	assert.strictEqual(
		close.blockers.some((value) => value.kind === 'protectionFailed'),
		true
	);
	assert.strictEqual(
		session.change({
			kind: 'createFile',
			path: '../escape',
			content: new Uint8Array(),
			mediaType: 'text/plain'
		}).accepted,
		false
	);
	assert.strictEqual(
		session.change({
			kind: 'createFile',
			path: 'large.bin',
			content: new Uint8Array(WORKSPACE_V1_DEFAULT_LIMITS.effectiveFileBytes + 1),
			mediaType: 'application/octet-stream'
		}).accepted,
		false
	);
	authority.access = Object.freeze({
		read: true,
		createDirectory: false,
		createFile: false,
		replaceContent: false,
		move: false,
		delete: false
	}) as WorkspaceAccess;
	authority.changeFeedMode = 'gap';
	await session.settle({
		kind: 'reconcile',
		throughGeneration: session.observe().current.generation
	});
	assert.strictEqual(session.change({ kind: 'delete', reference }).accepted, false);
	assert.throws(
		() =>
			assertEditorModelEligible(
				{
					reference,
					content: new Uint8Array(),
					contentVersion: 'v' as never,
					mediaType: 'text/plain',
					byteSize: WORKSPACE_V1_DEFAULT_LIMITS.editorModelBytes + 1,
					source: 'authoritative'
				},
				WORKSPACE_V1_DEFAULT_LIMITS
			),
		/editor-model limit/u
	);
	session.dispose();
});

test('non-overlapping text conflicts preserve all sides and create a reported local rebase', async () => {
	const { authority, session } = await harness([
		{
			reference: 'entry:a',
			path: 'answer.txt',
			content: 'alpha\nbeta\ngamma\n',
			mediaType: 'text/plain'
		}
	]);
	const reference = entry(session, 'answer.txt').reference;
	authority.replaceExternally(reference, 'alpha\nbeta\nGAMMA\n');
	const changed = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('ALPHA\nbeta\ngamma\n'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('not accepted');
	const conflicted = await session.settle({
		kind: 'persist',
		throughGeneration: changed.generation
	});
	assert.strictEqual(
		conflicted.blockers.some((value) => value.kind === 'conflicted'),
		true
	);
	assert.strictEqual(session.observe().current.generation > changed.generation, true);
	assert.strictEqual(
		decoder.decode((await session.read({ reference, version: 'conflictBase' })).content),
		'alpha\nbeta\ngamma\n'
	);
	assert.strictEqual(
		decoder.decode((await session.read({ reference, version: 'conflictLocal' })).content),
		'ALPHA\nbeta\ngamma\n'
	);
	assert.strictEqual(
		decoder.decode(
			(await session.read({ reference, version: 'conflictAuthoritative' })).content
		),
		'alpha\nbeta\nGAMMA\n'
	);
	assert.strictEqual(
		decoder.decode((await session.read({ reference })).content),
		'ALPHA\nbeta\nGAMMA\n'
	);
	const rebasedGeneration = session.observe().current.generation;
	const persisted = await session.settle({
		kind: 'persist',
		throughGeneration: rebasedGeneration
	});
	assert.strictEqual(persisted.acknowledged, true);
	assert.strictEqual(
		decoder.decode((await authority.readCurrent(reference)).content),
		'ALPHA\nbeta\nGAMMA\n'
	);
	await assert.rejects(session.read({ reference, version: 'conflictBase' }), /unavailable/u);
	session.dispose();
});

test('overlapping and binary conflicts retain explicit versions until acknowledged resolution', async () => {
	const { authority, protectedContent, session } = await harness([
		{ reference: 'entry:a', path: 'answer.txt', content: 'one\ntwo\n', mediaType: 'text/plain' }
	]);
	const reference = entry(session, 'answer.txt').reference;
	authority.replaceExternally(reference, 'REMOTE\ntwo\n');
	const changed = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('LOCAL\ntwo\n'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('not accepted');
	await session.settle({ kind: 'persist', throughGeneration: changed.generation });
	assert.strictEqual(session.observe().current.generation, changed.generation);
	assert.strictEqual(
		decoder.decode((await session.read({ reference, version: 'conflictBase' })).content),
		'one\ntwo\n'
	);
	assert.strictEqual(protectedContent.records.size, 1);
	const resolved = await session.resolveConflict(reference, {
		content: encoder.encode('ACCEPTED\ntwo\n'),
		mediaType: 'text/plain'
	});
	if (!resolved.accepted) throw new Error('resolution rejected');
	assert.strictEqual(protectedContent.records.size, 1);
	const result = await session.settle({
		kind: 'persist',
		throughGeneration: resolved.generation
	});
	assert.strictEqual(result.acknowledged, true);
	assert.strictEqual(protectedContent.records.size, 0);
	assert.strictEqual(
		decoder.decode((await authority.readCurrent(reference)).content),
		'ACCEPTED\ntwo\n'
	);
	session.dispose();
});

test('explicit conflict resolution obeys effective file and total size limits', async () => {
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'one' }
	]);
	const protectedContent = new InMemoryProtectedContent();
	const limits = {
		...WORKSPACE_V1_DEFAULT_LIMITS,
		effectiveFileBytes: 8,
		effectiveTotalBytes: 8
	};
	const session = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids: new DeterministicWorkspaceIds(),
		limits
	});
	const reference = entry(session, 'answer.txt').reference;
	await session.read({ reference });
	const changed = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('local'),
		mediaType: 'text/plain'
	});
	if (!changed.accepted) throw new Error('not accepted');
	authority.replaceExternally(reference, 'remote');
	await session.settle({ kind: 'persist', throughGeneration: changed.generation });
	const generation = session.observe().current.generation;
	const resolution = await session.resolveConflict(reference, {
		content: encoder.encode('too-large'),
		mediaType: 'text/plain'
	});
	assert.deepStrictEqual(resolution, {
		accepted: false,
		code: 'sizeLimit',
		message: 'File exceeds the effective Workspace file limit.'
	});
	assert.strictEqual(session.observe().current.generation, generation);
	session.dispose();
});

test('workspace v1 advertises unsupported contract extensions instead of simulating them', () => {
	assert.deepStrictEqual(WORKSPACE_V1_CAPABILITIES, {
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
});

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let index = 0; index < 50; index++) {
		if (predicate()) return;
		await Promise.resolve();
	}
	throw new Error('Asynchronous Workspace operation did not reach the expected state');
}

test('participation gating denies cached content, edits and pending dispatch synchronously', async () => {
	const { Emitter } = await import('../../../../../src/prctr/base/common/event.ts');
	const changed = new Emitter<void>();
	const authority = new InMemoryWorkspaceAuthority([
		{ reference: 'entry:a', path: 'answer.txt', content: 'original' }
	]);
	const protectedContent = new InMemoryProtectedContent();
	let allowed = true;
	const session = await createAttemptWorkspaceSession({
		authority,
		protectedContent,
		ids: new DeterministicWorkspaceIds(),
		limits: WORKSPACE_V1_DEFAULT_LIMITS,
		authorization: {
			current: () => ({
				read: allowed,
				createDirectory: allowed,
				createFile: allowed,
				replaceContent: allowed,
				move: allowed,
				delete: allowed
			}),
			onDidChange: changed.event
		}
	});
	const reference = entry(session, 'answer.txt').reference;
	await session.read({ reference });
	const edit = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('working'),
		mediaType: 'text/plain'
	});
	assert.ok(edit.accepted);
	allowed = false;
	changed.fire();
	assert.strictEqual(session.observe().current.access.read, false);
	await assert.rejects(session.read({ reference }), /access/);
	assert.deepStrictEqual(session.change({ kind: 'delete', reference }).accepted, false);
	const result = await session.settle({ kind: 'persist', throughGeneration: edit.generation });
	assert.strictEqual(result.acknowledged, false);
	assert.strictEqual(result.protected, true);
	assert.strictEqual(
		decoder.decode((await authority.readCurrent(reference)).content),
		'original'
	);
	allowed = true;
	changed.fire();
	assert.strictEqual(
		(await session.settle({ kind: 'persist', throughGeneration: edit.generation }))
			.acknowledged,
		true
	);
	session.dispose();
	changed.dispose();
});

test('failed durable dispatch checkpoint retains queued work without sending an unrepeatable command', async () => {
	const { authority, protectedContent, session } = await harness();
	const reference = entry(session, 'src/main.ts').reference;
	const edit = session.change({
		kind: 'replaceContent',
		reference,
		content: encoder.encode('working'),
		mediaType: 'text/typescript'
	});
	assert.ok(edit.accepted);
	await session.settle({ kind: 'protect', throughGeneration: edit.generation });
	protectedContent.failWriteOnCall = protectedContent.putCalls + 1;
	const result = await session.settle({ kind: 'persist', throughGeneration: edit.generation });
	assert.strictEqual(result.acknowledged, false);
	assert.strictEqual(
		decoder.decode((await authority.readCurrent(reference)).content),
		'const value = 1;'
	);
	assert.strictEqual(entry(session, 'src/main.ts').facts.remoteMutation, 'queued');
	protectedContent.failWrites = true;
	assert.strictEqual(
		(await session.settle({ kind: 'persist', throughGeneration: edit.generation }))
			.acknowledged,
		false
	);
	assert.strictEqual(
		decoder.decode((await authority.readCurrent(reference)).content),
		'const value = 1;'
	);
	protectedContent.failWrites = false;
	protectedContent.failWriteOnCall = undefined;
	assert.strictEqual(
		(await session.settle({ kind: 'persist', throughGeneration: edit.generation }))
			.acknowledged,
		true
	);
	session.dispose();
});

test('workspace paths follow server UTF-8 byte, depth, control and reserved-root bounds', async () => {
	const { workspacePath } =
		await import('../../../../../src/prctr/workbench/services/attemptWorkspace/common/path.ts');
	assert.strictEqual(workspacePath('src/é😀.txt'), 'src/é😀.txt');
	for (const path of [
		'é'.repeat(128),
		Array(17).fill('a').join('/'),
		'.proctor/a',
		'a\nb',
		'a\u0085b',
		'\ud800'
	])
		assert.throws(() => workspacePath(path));
});
