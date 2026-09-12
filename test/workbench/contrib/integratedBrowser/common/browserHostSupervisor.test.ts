import assert from 'node:assert';
import { test } from '../../../../base/common/upstream/testAdapter.ts';
import {
	BrowserHostSupervisor,
	type SupervisedBrowserHost
} from '../../../../../src/prctr/platform/integratedBrowser/common/browserHostSupervisor.ts';
import type { BrowserEnforcementDelegate } from '../../../../../src/prctr/platform/integratedBrowser/common/browserEnforcement.ts';
import {
	decideBrowserNavigation,
	validateBrowserPolicy
} from '../../../../../src/prctr/platform/integratedBrowser/common/browserPolicy.ts';

const policy = validateBrowserPolicy({
	schemaVersion: 1,
	attemptId: 'attempt',
	participationGeneration: 1,
	revision: 'revision',
	ordinal: 1,
	digest: 'sha256:abcdefgh',
	rules: [
		{
			id: 'docs',
			origin: 'https://example.com',
			allowRedirects: true,
			blockedConsequence: 'activity'
		}
	]
});
function fixture() {
	const hosts: Array<{
		delegate: BrowserEnforcementDelegate;
		closed: boolean;
		opens: string[];
		blocked: boolean;
	}> = [];
	const committed: string[] = [];
	let failures = 0;
	const supervisor = new BrowserHostSupervisor(
		{
			async create(delegate) {
				const state = { delegate, closed: false, opens: [] as string[], blocked: true };
				hosts.push(state);
				const host: SupervisedBrowserHost = {
					async open(url) {
						state.opens.push(url);
						delegate.commitTopLevel(url, 'navigation');
					},
					async navigate(url) {
						delegate.commitTopLevel(url, 'navigation');
					},
					async back() {},
					async forward() {},
					async reload() {},
					async close() {
						state.closed = true;
					},
					setInputBlocked(blocked) {
						state.blocked = blocked;
					},
					setSurface() {},
					surfaceFocused() {
						return false;
					},
					onDidChangeSurfaceFocus() {
						return { dispose() {} };
					},
					historyState() {
						return { canGoBack: false, canGoForward: false };
					}
				};
				return host;
			}
		},
		{
			checkTopLevel: (url) => decideBrowserNavigation(policy, url),
			checkSubresource: (url) => decideBrowserNavigation(policy, url).allowed,
			commitTopLevel: (url) => committed.push(url),
			blockPopup() {}
		},
		() => failures++
	);
	return { supervisor, hosts, committed, failures: () => failures };
}

test('pause destroys remote runtime; resume reconstructs same approved page and fences old callbacks', async () => {
	const { supervisor, hosts, committed } = fixture();
	supervisor.setInputBlocked(false);
	await supervisor.open('https://example.com/docs');
	assert.equal(hosts.length, 1);
	supervisor.setInputBlocked(true);
	assert.equal(hosts[0]?.blocked, true);
	assert.equal(hosts[0]?.delegate.checkSubresource('https://example.com'), false);
	supervisor.setInputBlocked(false);
	await supervisor.reload();
	assert.equal(hosts[0]?.closed, true);
	assert.equal(hosts.length, 2);
	assert.deepEqual(hosts[1]?.opens, ['https://example.com/docs']);
	const prior = committed.length;
	hosts[0]?.delegate.commitTopLevel('https://example.com/stale', 'navigation');
	assert.equal(committed.length, prior);
	await supervisor.close();
	assert.equal(hosts[1]?.closed, true);
});

test('closing during a pending factory result destroys that result without exposing it', async () => {
	let release: (() => void) | undefined;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	let closed = 0,
		opened = 0;
	const supervisor = new BrowserHostSupervisor(
		{
			async create() {
				await pending;
				return {
					async open() {
						opened++;
					},
					async navigate() {},
					async back() {},
					async forward() {},
					async reload() {},
					async close() {
						closed++;
					},
					setInputBlocked() {},
					setSurface() {},
					surfaceFocused() {
						return false;
					},
					onDidChangeSurfaceFocus() {
						return { dispose() {} };
					},
					historyState() {
						return { canGoBack: false, canGoForward: false };
					}
				};
			}
		},
		{
			checkTopLevel: (url) => decideBrowserNavigation(policy, url),
			checkSubresource: () => true,
			commitTopLevel() {},
			blockPopup() {}
		},
		() => {}
	);
	supervisor.setInputBlocked(false);
	const opening = supervisor.open('https://example.com');
	await Promise.resolve();
	const closing = supervisor.close();
	release!();
	await opening;
	await closing;
	assert.equal(closed, 1);
	assert.equal(opened, 0);
});

test('pause tears down immediately while a navigation promise is stalled', async () => {
	let release: (() => void) | undefined;
	let entered: (() => void) | undefined;
	const navigating = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const stalled = new Promise<void>((resolve) => {
		release = resolve;
	});
	let destroys = 0;
	const supervisor = new BrowserHostSupervisor(
		{
			async create(delegate) {
				return {
					async open(url) {
						delegate.commitTopLevel(url, 'navigation');
					},
					async navigate() {
						entered!();
						await stalled;
					},
					async back() {},
					async forward() {},
					async reload() {},
					async close() {
						destroys++;
						release!();
					},
					setInputBlocked() {},
					setSurface() {},
					surfaceFocused() {
						return false;
					},
					onDidChangeSurfaceFocus() {
						return { dispose() {} };
					},
					historyState() {
						return { canGoBack: false, canGoForward: false };
					}
				};
			}
		},
		{
			checkTopLevel: (url) => decideBrowserNavigation(policy, url),
			checkSubresource: () => true,
			commitTopLevel() {},
			blockPopup() {}
		},
		() => {}
	);
	supervisor.setInputBlocked(false);
	await supervisor.open('https://example.com');
	const navigation = supervisor.navigate('https://example.com/stalled');
	await navigating;
	supervisor.setInputBlocked(true);
	assert.equal(destroys, 1, 'native destruction starts in the same gate turn');
	await navigation;
	await supervisor.close();
	assert.equal(destroys, 1);
});
