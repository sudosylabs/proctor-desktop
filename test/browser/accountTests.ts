import { AccountService } from '../../src/prctr/workbench/services/account/common/account.ts';
import { SETTINGS_MANIFEST } from '../../src/prctr/platform/settings/common/settingsManifest.ts';
import type { UserSettingsProjection } from '../../src/prctr/platform/settings/common/settingsRendererProtocol.ts';
import {
	UserSettingsService,
	type SettingsRendererClient
} from '../../src/prctr/workbench/services/settings/common/settingsRendererClient.ts';
import { runAccountPhotoTests } from './accountPhotoTests.ts';
import {
	AccountPane,
	type AccountModel
} from '../../src/prctr/workbench/contrib/account/browser/accountPane.ts';
import { accountMessages } from '../../src/prctr/workbench/contrib/account/browser/accountMessages.ts';
import type { AccountPage } from '../../src/prctr/workbench/services/authenticatedNavigation/common/authenticatedNavigationModel.ts';
import { WorkbenchOverlayHost } from '../../src/prctr/workbench/browser/overlayHost.ts';
import { createLocalization } from '../../src/prctr/base/common/localization.ts';
import { CancellationToken } from '../../src/prctr/base/common/cancellation.ts';
import { Event as Events } from '../../src/prctr/base/common/event.ts';
import type {
	AccountData,
	AccountFailure,
	AccountIntent,
	AccountReadSection,
	AccountResponse
} from '../../src/prctr/platform/account/common/accountProtocol.ts';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const id = (letter: string): string => letter.repeat(26);
const CREDENTIAL = 'prctr_pat_7f3Kq9vXw2LmB8tRz4Yc1NdJ6hQe0sUa';

type Reply = AccountResponse | Promise<AccountResponse>;

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

function data(value: AccountData): AccountResponse {
	return { kind: 'data', data: value };
}

function failure(reason: AccountFailure): AccountResponse {
	return { kind: 'error', reason };
}

/** A fake account capability: each read section and each change kind has a scripted reply. */
class FakeAccount {
	readonly requests: AccountIntent[] = [];
	readonly reads = new Map<AccountReadSection, () => Reply>();
	readonly changes = new Map<AccountIntent['kind'], (intent: AccountIntent) => Reply>();

	async request(intent: AccountIntent): Promise<AccountResponse> {
		this.requests.push(intent);
		if (intent.kind === 'read')
			return (this.reads.get(intent.section) ?? (() => failure('unavailable')))();
		if (intent.kind === 'readPhoto') return failure('unavailable');
		const change = this.changes.get(intent.kind);
		return change ? change(intent) : { kind: 'success' };
	}

	count(kind: AccountIntent['kind']): number {
		return this.requests.filter((intent) => intent.kind === kind).length;
	}
}

const profile = (emailVerified: boolean): AccountResponse =>
	data({
		section: 'profile',
		profile: {
			username: 'a.okafor',
			displayName: 'Amara Okafor',
			firstName: 'Amara',
			lastName: 'Okafor',
			email: 'amara.okafor@northfield.example',
			emailVerified,
			locale: 'en-GB',
			timezone: 'Europe/London',
			createdAt: NOW - 400 * DAY
		}
	});

const sessions = (): AccountResponse =>
	data({
		section: 'sessions',
		sessions: [
			{
				id: id('b'),
				current: true,
				name: 'Proctor Desktop on Amara’s MacBook Pro',
				client: 'desktop',
				platform: 'darwin',
				method: 'oidc',
				createdAt: NOW - 60 * 60 * 1000,
				lastActivityAt: NOW,
				expiresAt: NOW + DAY
			},
			{
				id: id('c'),
				current: false,
				name: 'Lab PC 14',
				client: 'desktop',
				platform: 'windows',
				method: 'password',
				createdAt: NOW - 4 * DAY,
				lastActivityAt: NOW - 4 * DAY,
				expiresAt: NOW + DAY
			}
		]
	});

const desktops = (): AccountResponse =>
	data({
		section: 'desktops',
		desktops: [
			{
				id: id('d'),
				current: true,
				name: 'Amara’s MacBook Pro',
				platform: 'darwin',
				release: '0.1.0',
				createdAt: NOW - 50 * DAY,
				lastUsedAt: NOW,
				revoked: false
			},
			{
				id: id('e'),
				current: false,
				name: 'Lab PC 14',
				platform: 'win32',
				release: '0.1.0',
				createdAt: NOW - 10 * DAY,
				lastUsedAt: NOW - 4 * DAY,
				revoked: false
			}
		]
	});

const tokens = (): AccountResponse =>
	data({
		section: 'tokens',
		tokens: [
			{
				id: id('f'),
				description: 'Grade export script',
				scopes: ['exam.view'],
				academicUnitId: id('u'),
				expiresAt: NOW + 100 * DAY,
				lastUsedAt: NOW - 2 * DAY,
				createdAt: NOW - 20 * DAY
			},
			{
				id: id('g'),
				description: 'Marking spreadsheet',
				scopes: ['exam.view'],
				expiresAt: NOW + 50 * DAY,
				disabledAt: NOW - 25 * DAY,
				createdAt: NOW - 30 * DAY
			},
			{
				id: id('h'),
				description: 'Old roster import',
				scopes: ['people:read'],
				expiresAt: NOW - 150 * DAY,
				createdAt: NOW - 300 * DAY
			}
		]
	});

export async function runAccountTests(document: Document): Promise<void> {
	await runAccountPhotoTests(document);
	const host = document.createElement('div');
	const background = document.createElement('div');
	host.style.cssText = 'position: relative; inline-size: 900px; block-size: 700px;';
	document.body.append(host, background);
	const overlays = new WorkbenchOverlayHost(host, background);
	const account = new FakeAccount();
	const signOuts: number[] = [];
	const copied: string[] = [];
	// A fake settings capability: commits succeed against the current revision; one may conflict.
	let settingsSource = '{}';
	let settingsRevision = 1;
	let conflictNext = false;
	const settingsCommits: string[] = [];
	const settingsPreviews: string[] = [];
	const settingsProjection = (): UserSettingsProjection => ({
		source: settingsSource,
		revision: `r${settingsRevision}`,
		availability: 'available',
		writable: true,
		presentation: {
			windowTheme: 'system',
			highContrast: false,
			zoomPercent: 100,
			reducedMotion: false
		}
	});
	const settingsClient: SettingsRendererClient = {
		projection: async () => settingsProjection(),
		preview: async (intent) => {
			settingsPreviews.push(intent.source);
		},
		cancelPreview: async () => {},
		commit: async (intent) => {
			settingsCommits.push(intent.source);
			if (conflictNext) {
				conflictNext = false;
				settingsSource = '{"editor.fontSize": 18}';
				settingsRevision++;
				return { kind: 'conflict', projection: settingsProjection() };
			}
			if (intent.expectedRevision !== `r${settingsRevision}`)
				return { kind: 'conflict', projection: settingsProjection() };
			settingsSource = intent.source;
			settingsRevision++;
			return { kind: 'success', projection: settingsProjection() };
		},
		onDidChange: () => () => {}
	};
	const pane = new AccountPane(document, {
		client: new AccountService(account),
		settings: new UserSettingsService(settingsClient),
		localization: createLocalization({
			requestedLocale: 'en',
			messages: [
				...Object.values(accountMessages),
				...SETTINGS_MANIFEST.flatMap((setting) => [setting.title, setting.description])
			]
		}),
		binding: {
			kind: 'authenticated',
			windowId: 'test:account',
			institutionOrigin: 'https://northfield.example',
			principalId: id('y'),
			sessionId: id('b'),
			initialDestination: 'account',
			identity: {
				principalId: id('y'),
				sessionId: id('b'),
				institutionOrigin: 'https://northfield.example',
				institutionName: 'Northfield University',
				displayName: 'Amara Okafor',
				availableProductAreas: ['account'],
				noCurrentAffiliation: false,
				noAssignedAccess: false
			}
		},
		overlays,
		hooks: {
			signOut: () => signOuts.push(1),
			writeClipboard: async (text) => {
				copied.push(text);
			}
		},
		now: () => NOW
	});
	host.append(pane.element);
	const root = pane.element;
	const assign = (page: AccountPage): void => {
		const model: AccountModel = {
			page,
			item: {
				typeId: 'prctr.authenticated.account',
				logicalIdentity: page,
				presentation: { title: page, accessibleLabel: page },
				closable: false,
				restorable: false,
				onDidChangePresentation: Events.None,
				matches() {
					return false;
				}
			},
			dispose() {}
		};
		pane.setItem(model, CancellationToken.None);
		pane.setVisible(true);
	};
	const wait = async (predicate: () => boolean, what: string): Promise<void> => {
		for (let i = 0; i < 60; i++) {
			if (predicate()) return;
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		}
		throw new Error(`Account page did not settle: ${what}\n${root.textContent ?? ''}`);
	};
	const buttonIn = (scope: ParentNode, text: string): HTMLButtonElement | undefined =>
		[...scope.querySelectorAll<HTMLButtonElement>('button')].find(
			(button) => button.textContent?.trim() === text
		);
	const dialog = (): HTMLDialogElement | null => host.querySelector('dialog[open]');
	const section = (title: string): HTMLElement => {
		const found = [...root.querySelectorAll<HTMLElement>('.prctr-account-section')].find(
			(candidate) => candidate.querySelector('h2')?.textContent === title
		);
		check(found, `Missing section ${title}`);
		return found;
	};
	const row = (title: string): HTMLElement => {
		const found = [...root.querySelectorAll<HTMLElement>('.prctr-account-row')].find(
			(candidate) =>
				candidate.querySelector('.prctr-account-row__title')?.textContent === title
		);
		check(found, `Missing row ${title}`);
		return found;
	};
	const openMenu = (title: string): HTMLElement => {
		const more = row(title).querySelector<HTMLButtonElement>('.prctr-account-row__more');
		check(more, `Row ${title} has no actions menu`);
		more.click();
		const menu = root.querySelector<HTMLElement>('.prctr-menu[role="menu"]');
		check(menu, 'The actions menu did not open');
		check(
			more.getAttribute('aria-expanded') === 'true',
			'The menu button does not report it is open'
		);
		return menu;
	};
	const menuItem = (menu: HTMLElement, label: string): HTMLButtonElement => {
		const item = buttonIn(menu, label);
		check(item, `Menu has no ${label}`);
		return item;
	};
	try {
		// #region Profile
		let resolveProfile: ((value: AccountResponse) => void) | undefined;
		account.reads.set('profile', () => new Promise((resolve) => (resolveProfile = resolve)));
		account.reads.set('sessions', sessions);
		account.reads.set('notices', () => data({ section: 'notices', notices: [], more: false }));
		assign('profile');
		check(root.querySelector('h1')?.textContent === 'Profile', 'Profile has its heading');
		check(
			root
				.querySelector('.prctr-account__description')
				?.textContent?.includes('Northfield University'),
			'Profile describes the institution'
		);
		check(
			root.querySelector(
				'[data-state="loading"] .prctr-account-section__skeleton:not([hidden])'
			) && !root.querySelector('.prctr-account [data-spin]'),
			'Loading shows grey rows shaped like the content, not a spinner'
		);
		resolveProfile?.(profile(false));
		await wait(
			() => root.textContent!.includes('amara.okafor@northfield.example'),
			'profile details'
		);
		check(
			root.querySelector('.prctr-account-profile__username')?.textContent === 'a.okafor',
			'Username is shown'
		);
		check(
			root.textContent!.includes('English (United Kingdom)'),
			'Language is named, not coded'
		);
		check(root.textContent!.includes('Not verified'), 'Unverified email is marked');
		await wait(() => {
			const signIn = [
				...root.querySelectorAll<HTMLElement>('.prctr-account-details__row')
			].find((candidate) => candidate.querySelector('dt')?.textContent === 'Last sign-in');
			return !!signIn && !signIn.hidden && signIn.textContent!.includes('Proctor Desktop');
		}, 'last sign-in from this window’s session');
		check(
			section('Exam records due for deletion').hidden,
			'Retention notices are absent when there are none'
		);
		check(!root.querySelector('input:not([type="file"])'), 'Account details are read-only');
		const send = buttonIn(root, 'Send verification email');
		check(send, 'Unverified email offers verification');
		send.click();
		await wait(() => account.count('requestEmailVerification') === 1, 'verification request');
		await wait(
			() => root.textContent!.includes('If this address can receive email'),
			'non-enumerating reply'
		);

		account.reads.set('profile', () => profile(true));
		account.reads.set('notices', () =>
			data({
				section: 'notices',
				more: true,
				notices: [
					{
						retirementId: id('r'),
						examId: id('x'),
						examTitle: 'Algorithms final',
						examSittingId: id('s'),
						sittingStartAt: NOW - 5 * DAY,
						sittingEndAt: NOW - 5 * DAY + 3 * 3600_000,
						submissionId: id('t'),
						category: 'work',
						state: 'grace',
						createdAt: NOW - 3 * DAY,
						retireAfter: NOW + 30 * DAY,
						deliveryState: 'accepted'
					}
				]
			})
		);
		assign('profile');
		await wait(() => !section('Exam records due for deletion').hidden, 'notices section');
		check(row('Algorithms final'), 'A notice names its exam');
		check(
			row('Algorithms final').textContent!.includes(
				'Your submitted work from the sitting on'
			),
			'A notice names its record kind and sitting'
		);
		check(
			root.textContent!.includes('Member since'),
			'The profile says when the account began'
		);
		check(!root.textContent!.includes(id('x')), 'Notices never show raw identifiers');
		check(
			root.textContent!.includes('There are more records'),
			'Further notices are acknowledged'
		);
		check(
			buttonIn(root, 'Send verification email')?.closest('[hidden]'),
			'Verified email needs no verification'
		);
		// #endregion

		// #region Sign-in and security
		account.reads.set('security', () =>
			data({
				section: 'security',
				security: {
					password: true,
					providers: [{ name: 'Northfield University account', type: 'oidc' }],
					mfa: {
						available: true,
						enabled: true,
						pending: false,
						recoveryRequired: false,
						recoveryCodesRemaining: 2,
						recoveryCodesTotal: 10,
						method: 'authenticatorApp',
						enabledAt: NOW - 60 * DAY,
						passwordChangedAt: NOW - 90 * DAY
					}
				}
			})
		);
		assign('security');
		await wait(
			() => root.textContent!.includes('Northfield University account'),
			'security rows'
		);
		check(
			row('Recovery codes').querySelector('[data-tone="warning"]'),
			'Few recovery codes read as attention'
		);
		check(
			row('Recovery codes').textContent!.includes('2 of 10 left'),
			'Recovery codes count against the issued set'
		);
		check(
			row('Two-step verification').textContent!.includes('Authenticator app · on since'),
			'Two-step verification names its method and date'
		);
		check(row('Password').textContent!.includes('Changed'), 'The password change is dated');
		check(!root.querySelector('input'), 'Security credentials stay on the hosted page');
		check(
			root.textContent!.includes('never asks for your password'),
			'The footnote explains the hosted page'
		);
		check(!root.querySelector('.prctr-account-row__more'), 'Security rows have no actions');
		buttonIn(root, 'Open security page')!.click();
		await wait(() => account.count('openSecurity') === 1, 'open security');
		// #endregion

		// #region Sessions and devices
		account.reads.set('desktops', () => failure('unavailable'));
		assign('sessions');
		await wait(() => root.textContent!.includes('Lab PC 14'), 'sessions');
		check(
			section('Registered desktops').dataset.state === 'failed' &&
				buttonIn(section('Registered desktops'), 'Try again'),
			'A failed section offers a retry'
		);
		check(section('Other sessions').dataset.state === 'ready', 'Sections fail independently');
		check(
			[...root.querySelectorAll('.prctr-account-row button')].every(
				(button) =>
					button.classList.contains('prctr-account-row__more') ||
					button.closest('.prctr-account-row')?.querySelector('.prctr-account-row__title')
						?.textContent === 'Proctor Desktop on Amara’s MacBook Pro'
			),
			'Row actions are a menu, except this session’s one obvious action'
		);
		account.reads.set('desktops', desktops);
		buttonIn(section('Registered desktops'), 'Try again')!.click();
		await wait(
			() => section('Registered desktops').dataset.state === 'ready',
			'desktops retry'
		);
		check(
			!row('Amara’s MacBook Pro').querySelector('.prctr-account-row__more'),
			'This computer’s desktop has no Remove'
		);

		let menu: HTMLElement;
		check(
			!row('Proctor Desktop on Amara’s MacBook Pro').querySelector(
				'.prctr-account-row__more'
			),
			'This session’s one action is a button, not a menu'
		);
		buttonIn(row('Proctor Desktop on Amara’s MacBook Pro'), 'Sign out')!.click();
		await wait(() => signOuts.length === 1, 'current session signs out');
		check(account.count('revokeSession') === 0, 'Signing out is not a remote revocation here');

		menu = openMenu('Lab PC 14');
		const end = menuItem(menu, 'End session…');
		check(end.dataset.destructive === 'true', 'Ending a session is destructive');
		end.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		check(!root.querySelector('.prctr-menu'), 'Escape closes the menu');
		const more = row('Lab PC 14').querySelector<HTMLButtonElement>('.prctr-account-row__more')!;
		check(document.activeElement === more, 'Closing the menu returns focus to its button');
		menuItem(openMenu('Lab PC 14'), 'End session…').click();
		await wait(() => dialog() !== null, 'confirmation');
		check(
			dialog()!.getAttribute('role') === 'alertdialog',
			'The confirmation is an alert dialog'
		);
		check(
			dialog()!.textContent!.includes('End the session on Lab PC 14?'),
			'The confirmation names the session'
		);
		check(document.activeElement === buttonIn(dialog()!, 'Cancel'), 'Cancel has initial focus');
		check(overlays.visible, 'The dialog gates the window');
		buttonIn(dialog()!, 'Cancel')!.click();
		check(!dialog() && account.count('revokeSession') === 0, 'Cancel changes nothing');
		check(document.activeElement === more, 'Cancel returns focus to the row');

		account.changes.set('revokeSession', () => failure('strongAuthenticationRequired'));
		menuItem(openMenu('Lab PC 14'), 'End session…').click();
		await wait(() => dialog() !== null, 'confirmation again');
		buttonIn(dialog()!, 'End session')!.click();
		await wait(
			() => !!dialog()?.textContent?.includes('stronger sign-in'),
			'known failure in dialog'
		);
		check(account.count('revokeSession') === 1, 'The change ran exactly once');
		buttonIn(dialog()!, 'Cancel')!.click();

		account.changes.set('revokeSession', () => failure('unconfirmed'));
		let resolveSessions: ((value: AccountResponse) => void) | undefined;
		account.reads.set('sessions', () => new Promise((resolve) => (resolveSessions = resolve)));
		menuItem(openMenu('Lab PC 14'), 'End session…').click();
		await wait(() => dialog() !== null, 'confirmation for unknown outcome');
		buttonIn(dialog()!, 'End session')!.click();
		await wait(() => !dialog(), 'unknown outcome closes the dialog');
		check(
			section('Other sessions').textContent!.includes('couldn’t confirm'),
			'The unknown outcome is reported'
		);
		menu = openMenu('Lab PC 14');
		check(
			menuItem(menu, 'End session…').getAttribute('aria-disabled') === 'true',
			'An unknown outcome locks the row until the list is read again'
		);
		menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		resolveSessions?.(sessions());
		await wait(() => {
			const item = buttonIn(openMenu('Lab PC 14'), 'End session…');
			root.querySelector('.prctr-menu')?.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
			);
			return item?.getAttribute('aria-disabled') === 'false';
		}, 'fresh read unlocks the row');
		const endOthers = buttonIn(section('Other sessions'), 'End all other sessions')!;
		check(endOthers && !endOthers.hidden, 'Other sessions can all be ended at once');
		account.changes.set('revokeOtherSessions', () => ({ kind: 'sessionsEnded', count: 1 }));
		endOthers.click();
		await wait(() => dialog() !== null, 'end others confirmation');
		check(
			dialog()!.textContent!.includes('This computer stays signed in'),
			'Ending other sessions keeps this one'
		);
		buttonIn(dialog()!, 'End all other sessions')!.click();
		await wait(
			() => root.textContent!.includes('Every other session was ended'),
			'others ended'
		);
		check(account.count('revokeOtherSessions') === 1, 'Other sessions end in one request');
		// #endregion

		// #region Access tokens
		account.reads.set('grantableScopes', () =>
			data({
				section: 'grantableScopes',
				grantable: {
					scopes: [
						{
							name: 'exam.view',
							title: 'View exams',
							description: 'See exams and their details.',
							institutionWide: true,
							academicUnitIds: []
						},
						{
							name: 'class.view',
							title: 'View classes',
							description: 'See classes.',
							institutionWide: false,
							academicUnitIds: [id('u')]
						}
					],
					academicUnits: [{ id: id('u'), name: 'Computer Science' }],
					moreAcademicUnits: false
				}
			})
		);
		account.reads.set('tokens', tokens);
		assign('tokens');
		await wait(() => root.textContent!.includes('Grade export script'), 'tokens');
		check(section('Active').contains(row('Grade export script')), 'Working tokens are active');
		check(
			section('Disabled or expired').contains(row('Marking spreadsheet')),
			'Disabled tokens are inactive'
		);
		check(
			row('Grade export script').textContent!.includes('Computer Science only'),
			'A unit limit names its unit'
		);
		check(
			row('Grade export script').textContent!.includes('View exams'),
			'Scopes are titled from the server catalogue'
		);
		check(
			row('Old roster import').textContent!.includes('people:read'),
			'An unknown scope is shown as the server names it'
		);
		check(
			!row('Old roster import').querySelector('.prctr-account-row__more'),
			'Expired tokens have no actions'
		);
		check(
			[...openMenu('Marking spreadsheet').querySelectorAll('button')]
				.map((item) => item.textContent)
				.join() === 'Enable,Revoke…',
			'A disabled token can be enabled or revoked'
		);
		root.querySelector('.prctr-menu')?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
		);

		menuItem(openMenu('Grade export script'), 'Disable').click();
		await wait(() => account.count('disableToken') === 1, 'disable runs without confirmation');

		menuItem(openMenu('Grade export script'), 'Revoke…').click();
		await wait(() => dialog() !== null, 'revoke confirmation');
		check(
			dialog()!.textContent!.includes('Revoke Grade export script?'),
			'Revoke is confirmed'
		);
		buttonIn(dialog()!, 'Revoke token')!.click();
		await wait(() => !dialog() && account.count('revokeToken') === 1, 'revoke');

		buttonIn(root, 'New token')!.click();
		await wait(() => dialog() !== null, 'new token dialog');
		const form = dialog()!;
		await wait(() => form.textContent!.includes('View exams'), 'grantable scopes');
		check(form.textContent!.includes('See exams and their details.'), 'Scopes are described');
		const boxes = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
		const limit = [...form.querySelectorAll<HTMLSelectElement>('select')].find(
			(select) => select.labels?.[0]?.textContent === 'Limit to'
		)!;
		check(limit && !limit.closest('[hidden]'), 'Known units can limit a token');
		check(
			boxes[1]!.disabled && !boxes[0]!.disabled,
			'A unit-only scope waits for a unit to be chosen'
		);
		limit.value = id('u');
		limit.dispatchEvent(new Event('change'));
		check(!boxes[1]!.disabled, 'Choosing a unit makes its scopes available');
		limit.value = '';
		limit.dispatchEvent(new Event('change'));
		buttonIn(form, 'Create token')!.click();
		check(form.textContent!.includes('Enter a name.'), 'A token needs a name');
		check(account.count('createToken') === 0, 'An invalid draft is never sent');
		const name = form.querySelector<HTMLInputElement>('input[type="text"]')!;
		name.value = '  Grade export script 2  ';
		name.dispatchEvent(new Event('input', { bubbles: true }));
		buttonIn(form, 'Create token')!.click();
		check(form.textContent!.includes('Tick at least one'), 'A token needs a scope');
		boxes[0]!.click();
		account.changes.set('createToken', (intent) => {
			check(intent.kind === 'createToken', 'createToken intent');
			return {
				kind: 'tokenCreated',
				credential: CREDENTIAL,
				token: {
					id: id('k'),
					description: intent.description,
					scopes: intent.scopes,
					expiresAt: intent.expiresAt,
					createdAt: NOW
				}
			};
		});
		buttonIn(form, 'Create token')!.click();
		await wait(
			() => !!dialog()?.textContent?.includes('Copy your token now'),
			'credential dialog'
		);
		const created = account.requests.find(
			(intent): intent is Extract<AccountIntent, { kind: 'createToken' }> =>
				intent.kind === 'createToken'
		)!;
		check(created.description === 'Grade export script 2', 'The name is sent trimmed');
		check(created.scopes.join() === 'exam.view', 'Only ticked scopes are sent');
		check(created.academicUnitId === undefined, 'A whole-institution token sends no unit');
		check(created.expiresAt === NOW + 90 * DAY, 'The default expiry is 90 days');
		check(dialog()!.textContent!.includes(CREDENTIAL), 'The credential is shown once');
		buttonIn(dialog()!, 'Copy')!.click();
		await wait(() => copied.at(-1) === CREDENTIAL, 'copy');
		buttonIn(dialog()!, 'Done')!.click();
		check(!dialog(), 'Done closes the credential dialog');
		check(
			!document.body.textContent!.includes(CREDENTIAL),
			'The credential leaves the page when the dialog closes'
		);
		// #endregion

		// #region Account history
		const historyEntry = (letter: string, event: string, extra: object = {}) => ({
			id: id(letter),
			createdAt: NOW - 3600_000,
			event,
			failed: false,
			relation: 'subject' as const,
			actor: 'self' as const,
			...extra
		});
		account.changes.set('readHistory', (intent) =>
			intent.kind === 'readHistory' && intent.cursor === 'next'
				? data({ section: 'history', entries: [historyEntry('m', 'sign_out')] })
				: data({
						section: 'history',
						cursor: 'next',
						entries: [
							historyEntry('j', 'sign_in.succeeded', {
								client: 'desktop',
								ipAddress: '81.2.69.160'
							}),
							historyEntry('k', 'role.granted', { actor: 'administrator' }),
							historyEntry('l', 'future.event', { failed: true, actor: 'system' })
						]
					})
		);
		assign('history');
		await wait(() => root.textContent!.includes('Signed in'), 'history');
		const table = root.querySelector('table')!;
		check(table.textContent!.includes('An administrator'), 'Administrators are never named');
		check(table.textContent!.includes('81.2.69.160'), 'Own actions show where they came from');
		check(
			table.textContent!.includes('Other account activity'),
			'An unknown event reads generically'
		);
		check(table.textContent!.includes('Did not succeed'), 'A failed event says so');
		const first = account.requests.findLast((intent) => intent.kind === 'readHistory')!;
		check(
			first.kind === 'readHistory' && first.createdAfter !== undefined,
			'History starts with the last 30 days'
		);
		const pager = root.querySelector<HTMLElement>('nav.prctr-pager')!;
		check(!pager.hidden, 'A history with more pages offers a pager');
		check(
			pager.querySelector('[aria-current="page"]')?.textContent === '1',
			'The first page is current'
		);
		pager.querySelector<HTMLButtonElement>('[aria-label="Next"]')!.click();
		await wait(() => table.textContent!.includes('Signed out'), 'next history page');
		check(table.querySelectorAll('tbody tr').length === 1, 'A page replaces the rows');
		check(
			pager.querySelector<HTMLButtonElement>('[aria-label="Next"]')!.disabled,
			'The last page offers no Next'
		);
		check(
			pager.querySelector('[aria-current="page"]')?.textContent === '2',
			'The second page is current'
		);
		pager.querySelector<HTMLButtonElement>('[aria-label="Previous"]')!.click();
		await wait(() => table.textContent!.includes('Signed in'), 'previous history page');
		const back = account.requests.findLast((intent) => intent.kind === 'readHistory')!;
		check(
			back.kind === 'readHistory' && back.cursor === undefined,
			'Previous reads the first page again'
		);
		const outcome = root.querySelector<HTMLSelectElement>('select[aria-label="Outcome"]')!;
		outcome.value = 'fail';
		outcome.dispatchEvent(new Event('change'));
		await wait(() => {
			const last = account.requests.findLast((intent) => intent.kind === 'readHistory');
			return (
				last?.kind === 'readHistory' && last.status === 'fail' && last.cursor === undefined
			);
		}, 'filtered history');
		// #endregion

		// #region Settings
		assign('settings');
		await wait(() => root.textContent!.includes('Window theme'), 'settings page');
		check(
			root.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Appearance',
			'Settings opens on Appearance'
		);
		check(root.textContent!.includes('Saved'), 'Settings say they are saved');
		const settingRow = (key: string): HTMLElement =>
			root.querySelector<HTMLElement>(`[data-setting="${key}"]`)!;
		[...settingRow('window.theme').querySelectorAll<HTMLButtonElement>('[role="radio"]')]
			.find((radio) => radio.textContent === 'Dark')!
			.click();
		await wait(() => settingsPreviews.length === 1, 'theme applied');
		check(
			settingsCommits.length === 0 && /"window\.theme":\s*"dark"/u.test(settingsPreviews[0]!),
			'A change applies at once, before it is saved'
		);
		await wait(() => settingsCommits.length === 1, 'theme saved');
		check(
			/"window\.theme":\s*"dark"/u.test(settingsCommits[0]!),
			'The choice is saved by itself'
		);
		await wait(() => !!buttonIn(settingRow('window.theme'), 'Reset'), 'reset offered');
		buttonIn(settingRow('window.theme'), 'Reset')!.click();
		await wait(() => settingsCommits.length === 2, 'reset saved');
		check(!settingsCommits[1]!.includes('window.theme'), 'Reset removes the key');
		buttonIn(root, 'Exam editor')!.click();
		check(
			root.textContent!.includes('An exam can set its own editor settings'),
			'The editor tab says exams can override it'
		);
		check(root.querySelector('.prctr-settings-page__code'), 'The editor tab previews code');
		[...settingRow('editor.lineNumbers').querySelectorAll<HTMLButtonElement>('[role="radio"]')]
			.find((radio) => radio.textContent === 'Relative')!
			.click();
		await wait(
			() =>
				[...root.querySelectorAll('.prctr-settings-page__number')]
					.map((number) => number.textContent)
					.join(',') === '2,1,3,1,2',
			'relative line numbers'
		);
		await wait(() => settingsCommits.length === 3, 'line numbers saved');
		conflictNext = true;
		settingRow('editor.fontSize')
			.querySelector<HTMLButtonElement>('[aria-label="Larger"]')!
			.click();
		await wait(() => settingsCommits.length === 5, 'conflict reapplied');
		check(
			/"editor\.fontSize":\s*15/u.test(settingsCommits[4]!),
			'A conflicting save applies this page’s change again on the newer settings'
		);
		await wait(() => root.textContent!.includes('Saved'), 'saved after the conflict');
		const find = root.querySelector<HTMLInputElement>('input[aria-label="Find a setting"]')!;
		find.value = 'minimap';
		find.dispatchEvent(new Event('input', { bubbles: true }));
		check(
			root.querySelectorAll('[data-setting]').length === 1 &&
				!!settingRow('editor.minimap.enabled'),
			'Find a setting narrows to matches across tabs'
		);
		// #endregion

		// #region Layout and lifecycle
		host.style.inlineSize = '360px';
		assign('sessions');
		await wait(() => root.textContent!.includes('Lab PC 14'), 'narrow sessions');
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		const viewport = root.querySelector<HTMLElement>('.prctr-account__viewport')!;
		check(
			viewport.scrollWidth <= viewport.clientWidth + 1,
			'Narrow account content does not overflow sideways'
		);
		let late: ((value: AccountResponse) => void) | undefined;
		account.reads.set('profile', () => new Promise((resolve) => (late = resolve)));
		assign('profile');
		pane.dispose();
		late?.(profile(true));
		await Promise.resolve();
		check(!pane.element.isConnected, 'A disposed pane leaves the window');
		check(!overlays.visible, 'A disposed pane leaves no modal behind');
		// #endregion
	} finally {
		pane.dispose();
		overlays.dispose();
		host.remove();
		background.remove();
	}
}
