import { SettingsModalStatus } from '../../../src/prctr/workbench/contrib/settings/browser/settingsModalStatus.js';
import type { SettingsEditorConfiguration } from '../../../src/prctr/workbench/services/settings/common/settingsEditorConfiguration.js';
import { Emitter } from '../../../src/prctr/base/common/event.js';
import { DeferredPromise } from '../../../src/prctr/base/common/async.js';
import { ConfirmResult } from '../../../src/prctr/platform/dialogs/common/dialogs.js';
import type {
	UserSettingsCommitIntent,
	UserSettingsCommitResponse,
	UserSettingsProjection
} from '../../../src/prctr/platform/settings/common/settingsRendererProtocol.js';
import { SettingsEditorSession } from '../../../src/prctr/workbench/services/settings/browser/settingsEditorSession.js';
import type { SettingsWorkingCopy } from '../../../src/prctr/workbench/services/settings/browser/settingsWorkingCopy.js';

function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}
async function eventually(predicate: () => boolean): Promise<void> {
	const deadline = performance.now() + 3000;
	while (!predicate()) {
		if (performance.now() > deadline)
			throw new Error('Settings session operation did not settle.');
		await new Promise<void>((resolve) => setTimeout(resolve, 5));
	}
}

/** Controlled privileged boundary; all edits still use the real Monaco working copy and configuration engine. */
export async function exerciseSettingsEditorSession(
	copy: SettingsWorkingCopy,
	configuration: SettingsEditorConfiguration
): Promise<void> {
	const events = new Emitter<UserSettingsProjection>();
	let acknowledged: UserSettingsProjection = {
		source: '{"editor.fontSize":18}',
		revision: 'r1',
		availability: 'available',
		writable: true,
		presentation: { theme: 'dark', zoomPercent: 100, reducedMotion: false }
	};
	copy.accept(acknowledged.source, acknowledged.revision);
	copy.setReadonly(false);
	const commits: UserSettingsCommitIntent[] = [];
	let response = new DeferredPromise<UserSettingsCommitResponse>();
	let confirms = 0;
	let lastPresentationSource = acknowledged.source;
	const session = new SettingsEditorSession(
		copy,
		acknowledged,
		{
			async projection() {
				return acknowledged;
			},
			async preview() {
				events.fire(acknowledged);
			},
			async cancelPreview() {
				events.fire(acknowledged);
			},
			onDidChange(listener) {
				const subscription = events.event(listener);
				return () => subscription.dispose();
			},
			async commit(intent) {
				commits.push(intent);
				const result = await response.p;
				if (result.kind === 'success' || result.kind === 'conflict') {
					acknowledged = result.projection;
					events.fire(acknowledged);
				}
				return result;
			}
		},
		{
			async flushEdits() {},
			async confirmClose() {
				confirms++;
				return ConfirmResult.CANCEL;
			},
			applyPresentation(source) {
				lastPresentationSource = source;
			}
		}
	);
	const statusHost = document.body.appendChild(document.createElement('div'));
	const status = new SettingsModalStatus(statusHost, session);
	try {
		await copy.draft.set('editor.fontSize', 20);
		const firstSave = session.save();
		check(session.save() === firstSave, 'Concurrent saves created two operations.');
		await eventually(() => commits.length === 1);
		await copy.draft.set('editor.fontSize', 22);
		const submitted = commits[0]!;
		await response.complete({
			kind: 'success',
			projection: { ...acknowledged, source: submitted.source, revision: 'r2' }
		});
		check(await firstSave, 'Captured save did not succeed.');
		check(
			session.isDirty() &&
				copy.draft.baseSource === submitted.source &&
				copy.draft.source.includes('22'),
			'Save erased or acknowledged a later edit.'
		);
		check(copy.draft.baseRevision === 'r2', 'Save did not advance the acknowledged revision.');
		check(
			statusHost.textContent?.includes('Newer changes are still unsaved'),
			'A captured save announced that later dirty changes were saved.'
		);

		response = new DeferredPromise<UserSettingsCommitResponse>();
		const ambiguous = session.save();
		await eventually(() => commits.length === 2);
		await response.complete({ kind: 'ambiguous' });
		check(
			!(await ambiguous) && session.status === 'ambiguous',
			'Unknown completion was reported as saved.'
		);
		await copy.draft.set('editor.fontSize', 24);
		check(session.status === 'ambiguous', 'Editing hid the unresolved save outcome.');
		response = new DeferredPromise<UserSettingsCommitResponse>();
		const retry = session.save();
		await eventually(() => commits.length === 3);
		check(
			JSON.stringify(commits[1]) === JSON.stringify(commits[2]),
			'Retry changed the uncertain request identity or source.'
		);
		await response.complete({
			kind: 'success',
			projection: { ...acknowledged, source: commits[2]!.source, revision: 'r3' }
		});
		check(
			(await retry) && session.isDirty() && copy.draft.source.includes('24'),
			'Resolving ambiguity discarded later edits.'
		);

		const closeOne = session.confirmClose();
		check(
			closeOne === session.confirmClose(),
			'Concurrent close requests stacked confirmations.'
		);
		check(
			(await closeOne) === ConfirmResult.CANCEL && confirms === 1 && session.isDirty(),
			'Cancel did not preserve the editing owner.'
		);
		await session.revert();
		check(
			!session.isDirty() && copy.draft.source === acknowledged.source,
			'Discard did not restore the acknowledged document.'
		);
		check(lastPresentationSource === acknowledged.source, 'Discard retained a draft preview.');

		const queuedEdit = copy.draft.set('editor.fontSize', 21);
		events.fire({ ...acknowledged, writable: false, availability: 'unavailable' });
		const editResult = await Promise.allSettled([queuedEdit]);
		check(
			editResult[0]!.status === 'rejected' && copy.draft.source === acknowledged.source,
			'A queued graphical edit mutated read-only Settings.'
		);
		events.fire(acknowledged);
		await copy.draft.set('editor.fontSize', 23);
		response = new DeferredPromise<UserSettingsCommitResponse>();
		const late = session.save();
		await eventually(() => commits.length === 4);
		const oldBase = copy.draft.baseSource;
		await session.shutdown();
		await response.complete({
			kind: 'success',
			projection: { ...acknowledged, source: commits[3]!.source, revision: 'r4' }
		});
		check(
			!(await late) && copy.draft.baseSource === oldBase && copy.isReadonly,
			'Revoked session accepted a late save response.'
		);
	} finally {
		status.dispose();
		statusHost.remove();
		session.dispose();
		events.dispose();
	}
	await exerciseProjectionOrdering(copy);
	await exercisePendingConfiguration(copy, configuration);
}

async function exerciseProjectionOrdering(copy: SettingsWorkingCopy): Promise<void> {
	for (const scenario of [
		'earlier-notification',
		'later-notification',
		'refetch-failed'
	] as const) {
		const initial: UserSettingsProjection = {
			source: '{"editor.fontSize":18}',
			revision: 'opaque-base',
			availability: 'available',
			writable: true,
			presentation: { theme: 'dark', zoomPercent: 100, reducedMotion: false }
		};
		copy.accept(initial.source, initial.revision);
		copy.setReadonly(false);
		const events = new Emitter<UserSettingsProjection>();
		const response = new DeferredPromise<UserSettingsCommitResponse>();
		let intent: UserSettingsCommitIntent | undefined;
		let latest = initial;
		let reads = 0;
		const session = new SettingsEditorSession(
			copy,
			initial,
			{
				async projection() {
					reads++;
					if (scenario === 'refetch-failed') throw new Error('Offline');
					return latest;
				},
				async preview() {},
				async cancelPreview() {},
				onDidChange(listener) {
					const subscription = events.event(listener);
					return () => subscription.dispose();
				},
				async commit(submitted) {
					intent = submitted;
					return response.p;
				}
			},
			{
				async flushEdits() {},
				async confirmClose() {
					return ConfirmResult.CANCEL;
				},
				applyPresentation() {}
			}
		);
		try {
			await copy.draft.set('editor.fontSize', 20);
			const save = session.save();
			await eventually(() => !!intent);
			const committed = { ...initial, source: intent!.source, revision: 'opaque-commit' };
			const notification = {
				...initial,
				source: '{"editor.fontSize":20,"editor.lineNumbers":"off"}',
				revision: 'opaque-notification'
			};
			events.fire(notification);
			latest = scenario === 'later-notification' ? notification : committed;
			await response.complete({ kind: 'success', projection: committed });
			check(await save, 'An acknowledged save was lost while reconciling notifications.');
			check(
				reads === 1,
				'Different opaque revisions were ordered without refetching authority.'
			);
			check(
				copy.draft.baseSource === latest.source && copy.draft.source === latest.source,
				'A buffered notification overwrote the authoritative post-save document.'
			);
			check(
				session.isReadonly() === (scenario === 'refetch-failed'),
				'Failed post-save reconciliation did not retain the draft as read-only.'
			);
		} finally {
			await session.shutdown();
			events.dispose();
		}
	}
}

/** Menu, toolbar and command edits all enter through the same source configuration service. */
async function exercisePendingConfiguration(
	copy: SettingsWorkingCopy,
	configuration: SettingsEditorConfiguration
): Promise<void> {
	let acknowledged: UserSettingsProjection = {
		source: '{"editor.lineNumbers":"on"}',
		revision: 'menu-base',
		availability: 'available',
		writable: true,
		presentation: { theme: 'dark', zoomPercent: 100, reducedMotion: false }
	};
	copy.accept(acknowledged.source, acknowledged.revision);
	copy.setReadonly(false);
	const events = new Emitter<UserSettingsProjection>();
	const commits: UserSettingsCommitIntent[] = [];
	let conflict = false;
	let confirmations = 0;
	const session = new SettingsEditorSession(
		copy,
		acknowledged,
		{
			async projection() {
				return acknowledged;
			},
			async preview() {},
			async cancelPreview() {},
			onDidChange(listener) {
				const d = events.event(listener);
				return () => d.dispose();
			},
			async commit(intent) {
				commits.push(intent);
				if (conflict)
					return {
						kind: 'conflict',
						projection: {
							...acknowledged,
							source: '{"editor.lineNumbers":"relative"}',
							revision: 'menu-latest'
						}
					};
				acknowledged = { ...acknowledged, source: intent.source, revision: 'menu-saved' };
				return { kind: 'success', projection: acknowledged };
			}
		},
		{
			async flushEdits() {},
			async confirmClose() {
				confirmations++;
				return ConfirmResult.CANCEL;
			},
			applyPresentation() {}
		}
	);
	const host = document.body.appendChild(document.createElement('div'));
	const footer = new SettingsModalStatus(host, session);
	try {
		const edit = configuration.updateValue('editor.lineNumbers', 'off');
		check(session.isDirty(), 'A queued JSON menu edit was not counted as dirty.');
		check(await session.save(), 'Save did not flush the queued configuration edit.');
		await edit;
		check(
			commits.length === 1 && commits[0]!.source.includes('off') && !session.isDirty(),
			'Save captured the document before the pending JSON menu edit.'
		);
		const queued = configuration.updateValue('editor.lineNumbers', 'on');
		const close = session.confirmClose();
		check(
			(await close) === ConfirmResult.CANCEL && confirmations === 1,
			'Close skipped the confirmation for a pending menu edit.'
		);
		await queued;
		await session.revert();
		const discarded = configuration.updateValue('editor.lineNumbers', 'on');
		const discard = session.revert();
		const results = await Promise.allSettled([discarded, discard]);
		check(
			results[1]!.status === 'fulfilled' &&
				!session.isDirty() &&
				copy.draft.source === acknowledged.source,
			'A queued menu edit reappeared after Discard.'
		);
		await configuration.updateValue('editor.lineNumbers', 'on');
		conflict = true;
		check(
			!(await session.save()) && session.status === 'conflict',
			'A same-setting conflict did not become explicit.'
		);
		await configuration.updateValue('editor.fontSize', 22);
		const before = commits.length;
		check(
			session.status === 'conflict' &&
				host.textContent?.includes('conflicts with newer settings'),
			'A local edit concealed an unresolved conflict.'
		);
		check(
			!(await session.save()) && commits.length === before && session.status === 'conflict',
			'An unresolved conflict was silently overwritten.'
		);
	} finally {
		footer.dispose();
		host.remove();
		session.dispose();
		events.dispose();
	}
}
