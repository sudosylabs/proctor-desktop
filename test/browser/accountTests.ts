import { SETTINGS_MANIFEST } from '../../src/prctr/platform/settings/common/settingsManifest.ts';
import type { UserSettingsProjection } from '../../src/prctr/platform/settings/common/settingsRendererProtocol.ts';
import type { SettingsRendererClient } from '../../src/prctr/workbench/services/settings/common/settingsRendererClient.ts';
import { createAccountTestServices } from './accountTestServices.ts';
import { runAccountPhotoTests } from './accountPhotoTests.ts';
import {
	AccountPane,
	type AccountModel
} from '../../src/prctr/workbench/contrib/account/accountPane.ts';
import { accountText } from '../../src/prctr/workbench/contrib/account/accountMessages.ts';
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
			createdAt: NOW - 400 * DAY,
			photoKind: 'default'
		}
	});

const sessions = (): AccountResponse =>
	data({
		section: 'sessions',
		sessions: [
			{
				id: id('b'),
				current: true,
				name: 'Proctor Desktop',
				client: 'desktop',
				platform: 'darwin',
				method: 'oidc',
				authenticationStrength: 'multi_factor',
				desktopRegistrationId: id('d'),
				desktopRegistrationName: 'Amara’s MacBook Pro',
				createdAt: NOW - 60 * 60 * 1000,
				lastActivityAt: NOW,
				expiresAt: NOW + DAY
			},
			{
				id: id('c'),
				current: false,
				name: 'Proctor Desktop',
				client: 'desktop',
				platform: 'windows',
				method: 'password',
				authenticationStrength: 'single_factor',
				desktopRegistrationId: id('e'),
				desktopRegistrationName: 'Lab PC 14',
				createdAt: NOW - 4 * DAY,
				lastActivityAt: NOW - 4 * DAY,
				expiresAt: NOW + DAY
			},
			{
				id: id('i'),
				current: false,
				name: '',
				client: 'unknown',
				platform: '',
				method: 'password',
				authenticationStrength: 'single_factor',
				createdAt: NOW - 6 * DAY,
				lastActivityAt: NOW - 5 * DAY,
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
			},
			{
				id: id('j'),
				current: false,
				name: 'Library PC 2',
				platform: 'win32',
				release: '0.1.0',
				createdAt: NOW - 40 * DAY,
				lastUsedAt: NOW - 20 * DAY,
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
				scopes: [
					'exam.view',
					'class.view',
					'submission.view',
					'exam.publish',
					'audit.view'
				],
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
	let failNext = false;
	let settingsWritable = true;
	const settingsListeners = new Set<(projection: UserSettingsProjection) => void>();
	const settingsCommits: string[] = [];
	const settingsPreviews: string[] = [];
	const settingsProjection = (): UserSettingsProjection => ({
		source: settingsSource,
		revision: `r${settingsRevision}`,
		availability: 'available',
		writable: settingsWritable,
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
			if (failNext) {
				failNext = false;
				return { kind: 'unavailable' };
			}
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
		onDidChange: (listener) => {
			settingsListeners.add(listener);
			return () => settingsListeners.delete(listener);
		}
	};
	const services = createAccountTestServices({
		document,
		account,
		settings: settingsClient,
		localization: createLocalization({
			requestedLocale: 'en',
			messages: [
				...Object.values(accountText),
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
		signOut: () => signOuts.push(1),
		writeClipboard: async (text) => {
			copied.push(text);
		},
		now: () => NOW
	});
	const pane = services.instantiationService.createInstance(AccountPane, document);
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
		const found = [...root.querySelectorAll<HTMLElement>('.prctr-page-section')].find(
			(candidate) => candidate.querySelector('h2')?.textContent === title
		);
		check(found, `Missing section ${title}`);
		return found;
	};
	const row = (title: string): HTMLElement => {
		const found = [...root.querySelectorAll<HTMLElement>('.prctr-page-row')].find(
			(candidate) => candidate.querySelector('.prctr-page-row__title')?.textContent === title
		);
		check(found, `Missing row ${title}`);
		return found;
	};
	const openMenu = (title: string): HTMLElement => {
		const more = row(title).querySelector<HTMLButtonElement>('.prctr-page-row__more');
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
		check(
			(root.querySelector('h1')?.textContent ?? '') !== '',
			'Profile is headed by the person'
		);
		check(
			root.querySelector(
				'[data-state="loading"] .prctr-page-section__skeleton:not([hidden])'
			) && !root.querySelector('.prctr-account [data-spin]'),
			'Loading shows grey rows shaped like the content, not a spinner'
		);
		check(
			section('Account details').querySelectorAll(
				'.prctr-page-section__skeleton[data-kind="details"] .prctr-page-section__skeleton-row'
			).length === 7,
			'The details load as seven label and value rows'
		);
		resolveProfile?.(profile(false));
		await wait(
			() => root.textContent!.includes('amara.okafor@northfield.example'),
			'profile details'
		);
		check(
			root.querySelector('.prctr-page-pane__record-mono')?.textContent === 'a.okafor',
			'Username is on the record line'
		);
		check(
			root
				.querySelector('.prctr-page-pane__record')
				?.textContent?.includes('Northfield University'),
			'The record line names the institution'
		);
		check(
			root.textContent!.includes('English (United Kingdom)'),
			'Language is named, not coded'
		);
		check(root.textContent!.includes('Not verified'), 'Unverified email is marked');
		await wait(() => {
			const signIn = [...root.querySelectorAll<HTMLElement>('.prctr-page-details__row')].find(
				(candidate) => candidate.querySelector('dt')?.textContent === 'Last seen'
			);
			return !!signIn && !signIn.hidden && signIn.textContent!.includes('Proctor Desktop');
		}, 'last seen from this window’s session');
		check(
			section('Exam records due for deletion').hidden,
			'Retention notices are absent when there are none'
		);
		check(!root.querySelector('input:not([type="file"])'), 'Account details are read-only');
		check(
			buttonIn(root, 'Add photo') && buttonIn(root, 'Remove photo')?.hidden !== false,
			'Initials offer only Add photo'
		);
		check(
			getComputedStyle(root.querySelector('.prctr-page-pane__record-mono')!).fontFamily !==
				getComputedStyle(root.querySelector('.prctr-page-details__value')!).fontFamily,
			'Only the username is monospace'
		);
		check(
			section('Account details').textContent!.includes('ask an administrator') &&
				!buttonIn(section('Account details'), 'Edit in Administration')?.checkVisibility(),
			'Someone without Administration is told to ask an administrator'
		);
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
					},
					{
						retirementId: id('q'),
						examId: id('x'),
						examTitle: 'Databases midterm',
						examSittingId: id('s'),
						sittingStartAt: NOW - 9 * DAY,
						sittingEndAt: NOW - 9 * DAY + 3 * 3600_000,
						submissionId: id('t'),
						category: 'browser_activity',
						state: 'grace',
						createdAt: NOW - 3 * DAY,
						retireAfter: NOW + 10 * DAY,
						deliveryState: 'accepted'
					}
				]
			})
		);
		assign('profile');
		await wait(() => !section('Exam records due for deletion').hidden, 'notices section');
		check(row('Algorithms final'), 'A notice names its exam');
		check(
			[...section('Exam records due for deletion').querySelectorAll('.prctr-page-row__title')]
				.map((title) => title.textContent)
				.join() === 'Databases midterm,Algorithms final',
			'Records due for deletion are listed soonest first'
		);
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
			row('Recovery codes').querySelector('[data-tone="attention"]'),
			'Few recovery codes read as attention'
		);
		check(
			row('Recovery codes').textContent!.includes('2 of 10 left'),
			'Recovery codes count against the issued set'
		);
		check(
			row('Two-step verification').textContent!.includes('Authenticator app · On since'),
			'Two-step verification names its method and date'
		);
		check(
			row('Proctor password').textContent!.includes(
				'For signing in without Northfield University account · Changed'
			),
			'The password reads as its own way to sign in, dated'
		);
		check(
			row('Northfield University account').textContent!.includes(
				'Single sign-on with amara.okafor@northfield.example'
			),
			'Single sign-on names the address it uses'
		);
		check(section('Extra protection'), 'Two-step sits under Extra protection');
		check(!root.querySelector('input'), 'Security credentials stay on the hosted page');
		check(
			root.textContent!.includes('never asks for your password'),
			'The footnote explains the hosted page'
		);
		check(!root.querySelector('.prctr-page-row__more'), 'Security rows have no actions');
		buttonIn(root, 'Open security page')!.click();
		await wait(() => account.count('openSecurity') === 1, 'open security');
		account.reads.set('security', () =>
			data({
				section: 'security',
				security: {
					password: true,
					providers: [],
					mfa: {
						available: true,
						enabled: false,
						pending: false,
						recoveryRequired: false,
						recoveryCodesRemaining: 0,
						recoveryCodesTotal: 0
					}
				}
			})
		);
		assign('security');
		await wait(
			() => root.textContent!.includes('Only your Proctor password protects your account'),
			'two-step off'
		);
		check(
			row('Two-step verification').querySelector('[data-tone="failure"]')?.textContent ===
				'Off',
			'Two-step Off is red'
		);
		check(
			row('Recovery codes').textContent!.includes('You get them when you turn on') &&
				!row('Recovery codes').querySelector('[data-tone]'),
			'Recovery codes say when they come, with no badge'
		);
		buttonIn(row('Two-step verification'), 'Turn on')!.click();
		await wait(() => account.count('openSecurity') === 2, 'turn on opens the security page');
		// #endregion

		// #region Sessions and devices
		account.reads.set('desktops', () => failure('unavailable'));
		assign('sessions');
		await wait(() => root.textContent!.includes('Lab PC 14'), 'sessions');
		check(
			section('Registered, not signed in').dataset.state === 'failed' &&
				buttonIn(section('Registered, not signed in'), 'Try again'),
			'A failed section offers a retry'
		);
		check(section('Signed in').dataset.state === 'ready', 'Sections fail independently');
		check(
			[...root.querySelectorAll('.prctr-page-row button')].every(
				(button) =>
					button.classList.contains('prctr-page-row__more') ||
					button.textContent === 'Sign out'
			),
			'Row actions are a menu, except this session’s one obvious action'
		);
		account.reads.set('desktops', desktops);
		buttonIn(section('Registered, not signed in'), 'Try again')!.click();
		await wait(
			() => section('Registered, not signed in').dataset.state === 'ready',
			'desktops retry'
		);
		check(
			root.querySelectorAll('.prctr-page-row__title').length === 4 &&
				[...root.querySelectorAll('.prctr-page-row__title')].filter(
					(title) => title.textContent === 'Lab PC 14'
				).length === 1,
			'Each computer appears once'
		);
		check(
			row('Amara’s MacBook Pro').textContent!.includes(
				'Proctor Desktop · macOS · Registered for exams · Signed in'
			),
			'A signed-in computer says it is registered, by its registered name'
		);
		check(
			row('Amara’s MacBook Pro').querySelector('[data-tone="neutral"]')?.textContent ===
				'Current',
			'The session you are using says Current in grey'
		);
		check(
			row('Unknown device').querySelector('[data-tone="attention"]')?.textContent ===
				'Unidentified' &&
				row('Unknown device').textContent!.includes(
					'Not identified · Password, no two-step'
				),
			'An unidentified session is amber and says how it signed in'
		);
		check(
			section('Registered, not signed in').contains(row('Library PC 2')) &&
				row('Library PC 2').textContent!.includes('Proctor Desktop · Windows · Registered'),
			'Only computers without a session are listed as not signed in'
		);
		let menu = openMenu('Amara’s MacBook Pro');
		check(
			[...menu.querySelectorAll('button')].map((item) => item.textContent).join() ===
				'Session details,Rename…',
			'This computer can be described and renamed, not ended or removed'
		);
		menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		buttonIn(row('Amara’s MacBook Pro'), 'Sign out')!.click();
		await wait(() => signOuts.length === 1, 'current session signs out');
		check(account.count('revokeSession') === 0, 'Signing out is not a remote revocation here');

		menu = openMenu('Lab PC 14');
		check(
			[...menu.querySelectorAll('button')].map((item) => item.textContent).join() ===
				'Session details,Rename…,End session…,Remove registration…',
			'Another computer’s menu has every action, the destructive ones last'
		);
		const end = menuItem(menu, 'End session…');
		check(end.dataset.destructive === 'true', 'Ending a session is destructive');
		end.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		check(!root.querySelector('.prctr-menu'), 'Escape closes the menu');
		const more = row('Lab PC 14').querySelector<HTMLButtonElement>('.prctr-page-row__more')!;
		check(document.activeElement === more, 'Closing the menu returns focus to its button');

		menuItem(openMenu('Lab PC 14'), 'Session details').click();
		await wait(() => dialog() !== null, 'session details');
		check(
			dialog()!.textContent!.includes('How it signed in') &&
				dialog()!.textContent!.includes('Password, no two-step') &&
				dialog()!.textContent!.includes('Proctor version'),
			'Session details say how it signed in and what registered it'
		);
		check(!buttonIn(dialog()!, 'Close')!.querySelector('.prctr-icon'), 'Close carries no icon');
		buttonIn(dialog()!, 'Close')!.click();
		check(!dialog(), 'Close closes the details');

		// A desktop session is renamed through its registration.
		menuItem(openMenu('Lab PC 14'), 'Rename…').click();
		await wait(() => dialog() !== null, 'rename dialog');
		const renameField = dialog()!.querySelector<HTMLInputElement>('input[type="text"]')!;
		check(renameField.value === 'Lab PC 14', 'Rename starts from the current name');
		renameField.value = 'Lab PC 14 (window seat)';
		renameField.dispatchEvent(new Event('input', { bubbles: true }));
		buttonIn(dialog()!, 'Rename')!.click();
		await wait(() => !dialog(), 'renamed');
		const renamed = account.requests.findLast((intent) => intent.kind === 'renameDesktop');
		check(
			renamed?.kind === 'renameDesktop' &&
				renamed.id === id('e') &&
				renamed.name === 'Lab PC 14 (window seat)',
			'A computer is renamed through its registration'
		);
		// A browser session the server says belongs to a desktop is renamed there instead.
		account.changes.set('renameSession', () => ({
			kind: 'namedByDesktop',
			desktopRegistrationId: id('j')
		}));
		menuItem(openMenu('Unknown device'), 'Rename…').click();
		await wait(() => dialog() !== null, 'rename session dialog');
		const sessionField = dialog()!.querySelector<HTMLInputElement>('input[type="text"]')!;
		sessionField.value = 'Spare laptop';
		sessionField.dispatchEvent(new Event('input', { bubbles: true }));
		buttonIn(dialog()!, 'Rename')!.click();
		await wait(() => !dialog(), 'renamed through the desktop');
		const forwarded = account.requests.findLast((intent) => intent.kind === 'renameDesktop');
		check(
			account.count('renameSession') === 1 &&
				forwarded?.kind === 'renameDesktop' &&
				forwarded.id === id('j'),
			'A name the registration owns goes to the registration'
		);

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
		check(!buttonIn(dialog()!, 'Cancel')!.querySelector('.prctr-icon'), 'Cancel has no icon');
		// A second Escape the browser turns into a close still asks the owner, which closes it.
		dialog()!.close();
		await wait(() => !dialog() && !overlays.visible, 'a browser close closes the dialog');
		check(account.count('revokeSession') === 0, 'Closing changes nothing');
		menuItem(openMenu('Lab PC 14'), 'End session…').click();
		await wait(() => dialog() !== null, 'confirmation again');
		buttonIn(dialog()!, 'Cancel')!.click();
		check(!dialog() && account.count('revokeSession') === 0, 'Cancel changes nothing');
		check(document.activeElement === more, 'Cancel returns focus to the row');

		// A change that needs two-step verification the account doesn't have explains the way
		// on over the confirmation, which stays as it was when that explanation is cancelled.
		account.reads.set('signIn', () =>
			data({
				section: 'signIn',
				signIn: {
					method: 'password',
					multiFactor: false,
					twoStepOffered: true,
					twoStepOn: false,
					canRaise: false
				}
			})
		);
		account.changes.set('revokeSession', () => failure('strongAuthenticationRequired'));
		const top = (): HTMLDialogElement | undefined =>
			[...host.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
		menuItem(openMenu('Lab PC 14'), 'End session…').click();
		await wait(() => dialog() !== null, 'confirmation again');
		buttonIn(dialog()!, 'End session')!.click();
		await wait(
			() => !!top()?.textContent?.includes('Turn on two-step verification first'),
			'two-step needed explains'
		);
		check(account.count('revokeSession') === 1, 'The change ran exactly once');
		check(!!buttonIn(top()!, 'Open security page'), 'The way on opens the security page');
		buttonIn(top()!, 'Cancel')!.click();
		await wait(
			() =>
				host.querySelectorAll('dialog[open]').length === 1 &&
				buttonIn(dialog()!, 'Cancel')?.disabled === false,
			'back to the confirmation'
		);
		check(
			!dialog()!.querySelector('.prctr-page-feedback')?.textContent,
			'A stopped check leaves nothing to report'
		);
		buttonIn(dialog()!, 'Cancel')!.click();
		await wait(() => !dialog() && !overlays.visible, 'both dialogs closed');
		account.reads.delete('signIn');

		account.changes.set('revokeSession', () => failure('unconfirmed'));
		let resolveSessions: ((value: AccountResponse) => void) | undefined;
		account.reads.set('sessions', () => new Promise((resolve) => (resolveSessions = resolve)));
		menuItem(openMenu('Lab PC 14'), 'End session…').click();
		await wait(() => dialog() !== null, 'confirmation for unknown outcome');
		buttonIn(dialog()!, 'End session')!.click();
		await wait(() => !dialog(), 'unknown outcome closes the dialog');
		check(
			section('Signed in').textContent!.includes('couldn’t confirm'),
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

		menuItem(openMenu('Library PC 2'), 'Remove registration…').click();
		await wait(() => dialog() !== null, 'remove registration confirmation');
		check(
			dialog()!.textContent!.includes('Remove the registration for Library PC 2?'),
			'Removing a registration names the computer'
		);
		buttonIn(dialog()!, 'Remove registration')!.click();
		await wait(() => account.count('revokeDesktop') === 1, 'registration removed');

		const endOthers = buttonIn(section('Signed in'), 'End all other sessions')!;
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

		account.reads.set('sessions', () => failure('unavailable'));
		assign('sessions');
		await wait(() => section('Signed in').dataset.state === 'failed', 'sessions fail');
		check(
			section('Signed in').textContent!.includes('Couldn’t load your sessions') &&
				section('Signed in').textContent!.includes(
					'Northfield University didn’t answer in time. Nothing has changed.'
				),
			'A failed sessions read says the institution didn’t answer'
		);
		account.reads.set('sessions', sessions);
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
			section('Not in use').contains(row('Marking spreadsheet')),
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
		const moreScopes = row('Grade export script').querySelector<HTMLButtonElement>(
			'.prctr-page-row__chip-more'
		)!;
		check(
			moreScopes.textContent === '2 more' &&
				moreScopes.getAttribute('aria-expanded') === 'false' &&
				!moreScopes.hasAttribute('aria-label'),
			'More than three permissions fold behind "N more", named by its own words'
		);
		moreScopes.click();
		check(
			moreScopes.getAttribute('aria-expanded') === 'true' &&
				String(moreScopes.textContent) === 'Show fewer' &&
				[...row('Grade export script').querySelectorAll('.prctr-page-row__chip')].every(
					(chip) => !(chip as HTMLElement).hidden
				),
			'"N more" opens the rest in place'
		);
		check(
			row('Marking spreadsheet').querySelector('[data-tone="neutral"]')?.textContent ===
				'Disabled',
			'A disabled token is grey'
		);
		check(
			row('Old roster import').textContent!.includes('people:read'),
			'An unknown scope is shown as the server names it'
		);
		check(
			!row('Old roster import').querySelector('.prctr-page-row__more'),
			'Expired tokens have no actions'
		);
		check(
			[...openMenu('Marking spreadsheet').querySelectorAll('button')]
				.map((item) => item.textContent)
				.join() === 'Enable,Revoke',
			'A disabled token can be enabled or revoked'
		);
		root.querySelector('.prctr-menu')?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
		);

		menuItem(openMenu('Grade export script'), 'Disable').click();
		await wait(() => account.count('disableToken') === 1, 'disable runs without confirmation');

		menuItem(openMenu('Grade export script'), 'Revoke').click();
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
		const scopeBox = (title: string) =>
			form.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="${title}"]`);
		await wait(() => scopeBox('View exams') !== null, 'grantable scopes');
		check(
			scopeBox('View exams')!.title === 'See exams and their details.',
			'Scopes are described'
		);
		check(
			[...form.querySelectorAll('.prctr-account-token-form__column')]
				.map((column) => column.textContent)
				.join() === 'View,Create,Change,Review,Publish',
			'The grid has fixed action columns'
		);
		check(
			form.textContent!.includes('Exams and their settings'),
			'Each area has a visible one-line description'
		);
		const boxes = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
		const limit = [...form.querySelectorAll<HTMLSelectElement>('select')].find(
			(select) => select.labels?.[0]?.textContent === 'Limit to'
		)!;
		check(limit && !limit.closest('[hidden]'), 'Known units can limit a token');
		check(
			boxes[1]!.disabled && !boxes[0]!.disabled,
			'A unit-only scope waits for a unit to be chosen'
		);
		check(
			form.textContent!.includes('Only on a token limited to one of your academic units'),
			'A greyed row says why'
		);
		limit.value = id('u');
		limit.dispatchEvent(new Event('change'));
		check(!boxes[1]!.disabled, 'Choosing a unit makes its scopes available');
		limit.value = '';
		limit.dispatchEvent(new Event('change'));
		check(buttonIn(form, 'Create token')!.disabled, 'Create token waits for a name');
		check(account.count('createToken') === 0, 'An invalid draft is never sent');
		const name = form.querySelector<HTMLInputElement>('input[type="text"]')!;
		name.value = '  Grade export script 2  ';
		name.dispatchEvent(new Event('input', { bubbles: true }));
		buttonIn(form, 'Create token')!.click();
		check(form.textContent!.includes('Tick at least one'), 'A token needs a scope');
		boxes[0]!.click();
		check(
			form.querySelector('.prctr-page-dialog__footnote')?.textContent === '1 permission',
			'The footer counts the ticked permissions'
		);
		let refusedOnce = false;
		account.changes.set('createToken', (intent) => {
			check(intent.kind === 'createToken', 'createToken intent');
			// The institution wants a recent sign-in first; the same request then succeeds.
			if (!refusedOnce) {
				refusedOnce = true;
				return failure('reauthenticationRequired');
			}
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
			() => !!dialog()?.textContent?.includes('Confirm it’s you'),
			'confirm it is you'
		);
		check(
			dialog()!.textContent!.includes('Grade export script 2') &&
				dialog()!.textContent!.includes('View exams · Whole institution · Expires'),
			'Confirming says what will be created, in the one summary'
		);
		buttonIn(dialog()!, 'Continue in browser')!.click();
		await wait(
			() => !!dialog()?.textContent?.includes('Copy your new token'),
			'credential dialog'
		);
		check(
			dialog()!.textContent!.includes('View exams · Whole institution · Expires'),
			'The copy step repeats the same summary'
		);
		check(account.count('reauthenticate') === 1, 'Confirming runs the browser step once');
		check(account.count('createToken') === 2, 'The refused request is sent again');
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
			summary: 'You signed in on Amara’s MacBook Pro',
			...extra
		});
		account.changes.set('readHistory', (intent) =>
			intent.kind === 'readHistory' && intent.cursor === 'next'
				? data({
						section: 'history',
						runs: [],
						entries: [historyEntry('m', 'sign_out', { summary: 'You signed out' })]
					})
				: data({
						section: 'history',
						cursor: 'next',
						total: 7,
						runs: [{ start: 3, length: 3, summary: 'You changed 3 profile pictures' }],
						entries: [
							historyEntry('j', 'sign_in.succeeded', {
								client: 'desktop',
								ipAddress: '81.2.69.160'
							}),
							historyEntry('k', 'role.granted', {
								actor: 'administrator',
								summary: 'An administrator made you a teacher in Mathematics'
							}),
							historyEntry('l', 'future.event', {
								failed: true,
								actor: 'system',
								summary: 'Someone tried to sign in as you'
							}),
							...['n', 'o', 'p'].map((letter) =>
								historyEntry(letter, 'profile_picture.changed', {
									relation: 'actor',
									summary: 'You changed a profile photo'
								})
							)
						]
					})
		);
		assign('history');
		await wait(() => root.textContent!.includes('Amara’s MacBook Pro'), 'history');
		check(
			root.querySelector('h1')?.textContent === 'Account history',
			'The page is Account history'
		);
		const table = root.querySelector('table')!;
		check(
			table.closest('.prctr-page-section') !== null,
			'History sits on the shared page section'
		);
		check(
			table.textContent!.includes('An administrator made you a teacher in Mathematics'),
			'Each row is the server’s sentence, and administrators are never named'
		);
		check(table.textContent!.includes('81.2.69.160'), 'Own actions show where they came from');
		check(table.textContent!.includes('Did not succeed'), 'A failed event says so');
		check(
			table.querySelectorAll('tbody tr').length === 4,
			'A run of the same change folds into one row'
		);
		check(
			table.textContent!.includes('You changed 3 profile pictures'),
			'A folded run reads as the server’s sentence for it'
		);
		const showAll = buttonIn(table, 'Show all 3')!;
		check(showAll.getAttribute('aria-expanded') === 'false', 'A folded run says it is closed');
		showAll.click();
		check(
			table.querySelectorAll('tbody tr').length === 6 &&
				buttonIn(table, 'Show fewer')?.getAttribute('aria-expanded') === 'true',
			'A folded run opens in place'
		);
		const first = account.requests.findLast((intent) => intent.kind === 'readHistory')!;
		check(
			first.kind === 'readHistory' && first.createdAfter !== undefined,
			'History starts with the last 6 months'
		);
		const pager = root.querySelector<HTMLElement>(
			'.prctr-page-section__footer nav.prctr-pager'
		)!;
		check(!pager.hidden, 'A history with more pages offers a pager');
		check(
			pager.textContent!.includes('Showing 1–6 of 7') &&
				!pager.querySelector('[aria-current="page"]:not([hidden] *)')?.checkVisibility(),
			'The pager counts without page numbers'
		);
		check(buttonIn(pager, 'Go to a date'), 'The pager offers Go to a date');
		pager.querySelector<HTMLButtonElement>('[aria-label="Next"]')!.click();
		await wait(() => table.textContent!.includes('You signed out'), 'next history page');
		check(table.querySelectorAll('tbody tr').length === 1, 'A page replaces the rows');
		check(
			pager.querySelector<HTMLButtonElement>('[aria-label="Next"]')!.disabled,
			'The last page offers no Next'
		);
		check(pager.textContent!.includes('Showing 11–11'), 'The second page says where it is');
		pager.querySelector<HTMLButtonElement>('[aria-label="Previous"]')!.click();
		await wait(
			() => table.textContent!.includes('Amara’s MacBook Pro'),
			'previous history page'
		);
		const back = account.requests.findLast((intent) => intent.kind === 'readHistory')!;
		check(
			back.kind === 'readHistory' && back.cursor === undefined,
			'Previous reads the first page again'
		);
		const kind = root.querySelector<HTMLSelectElement>('select[aria-label="Kind"]')!;
		kind.focus();
		kind.value = 'failed';
		kind.dispatchEvent(new Event('change'));
		await wait(() => {
			const last = account.requests.findLast((intent) => intent.kind === 'readHistory');
			return (
				last?.kind === 'readHistory' && last.status === 'fail' && last.cursor === undefined
			);
		}, 'filtered history');
		check(document.activeElement === kind, 'A filter change keeps focus on the filter');
		root.querySelector<HTMLButtonElement>('.prctr-account-history__sort')!.click();
		await wait(() => {
			const last = account.requests.findLast((intent) => intent.kind === 'readHistory');
			return last?.kind === 'readHistory' && last.order === 'asc';
		}, 'oldest first');
		check(
			root.querySelector('th[aria-sort]')?.getAttribute('aria-sort') === 'ascending',
			'The When header says how it is sorted'
		);
		account.changes.set('readHistory', () => failure('unavailable'));
		kind.value = 'all';
		kind.dispatchEvent(new Event('change'));
		await wait(
			() =>
				root.querySelector('.prctr-account-history')?.getAttribute('data-state') ===
				'failed',
			'history failure'
		);
		check(table.hidden, 'A failure keeps no stale rows');
		// #endregion

		// #region Settings
		assign('settings');
		const settingsPanel = (): HTMLElement =>
			root.querySelector<HTMLElement>('.prctr-settings-page__panel')!;
		await wait(() => !settingsPanel().hidden, 'settings page');
		const settingRow = (key: string): HTMLElement =>
			root.querySelector<HTMLElement>(`[data-setting="${key}"]`)!;
		const shownRows = (): string[] =>
			[...root.querySelectorAll<HTMLElement>('[data-setting]')]
				.filter((row) => row.offsetParent !== null)
				.map((row) => row.dataset.setting!);
		const saveStatus = (): HTMLElement =>
			root.querySelector<HTMLElement>('.prctr-settings-page__status')!;
		const settingTabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
		check(
			settingTabs.map((tab) => tab.textContent).join(',') ===
				'Appearance,Exam editor,Accessibility',
			'Settings has three tabs'
		);
		check(
			settingTabs.every(
				(tab) => tab.id !== '' && tab.getAttribute('aria-controls') === settingsPanel().id
			),
			'Each tab has an id and controls the panel'
		);
		check(
			root.querySelector('[role="tab"][aria-selected="true"]')?.textContent ===
				'Appearance' &&
				settingsPanel().getAttribute('aria-labelledby') === settingTabs[0]!.id,
			'Settings opens on Appearance, which labels the panel'
		);
		check(
			saveStatus().getAttribute('role') === 'status' && saveStatus().textContent === '',
			'The save status is present but silent before any change'
		);
		check(
			!!settingRow('browser.presentation.zoom') &&
				settingRow('browser.presentation.zoom').closest('[hidden]') === null &&
				settingRow('browser.presentation.zoom').textContent!.includes('Exam browser zoom'),
			'Exam browser zoom is on Appearance'
		);
		check(
			buttonIn(settingRow('window.theme'), 'Reset to System')?.hidden === true,
			'Reset waits until a setting is changed'
		);
		const themeRadios = [
			...settingRow('window.theme').querySelectorAll<HTMLButtonElement>('[role="radio"]')
		];
		themeRadios[0]!.focus();
		themeRadios[0]!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
		);
		await wait(() => settingsPreviews.length === 1, 'theme applied');
		check(
			settingsCommits.length === 0 &&
				/"window\.theme":\s*"light"/u.test(settingsPreviews[0]!),
			'A change applies at once, before it is saved'
		);
		check(
			document.activeElement === themeRadios[1] && themeRadios[1]!.isConnected,
			'A change keeps focus on the same control, updated in place'
		);
		await wait(() => settingsCommits.length === 1, 'theme saved');
		check(
			/"window\.theme":\s*"light"/u.test(settingsCommits[0]!),
			'The choice is saved by itself'
		);
		await wait(() => saveStatus().textContent === 'Saved', 'saved after a change');
		const themeReset = buttonIn(settingRow('window.theme'), 'Reset to System')!;
		check(
			!themeReset.hidden &&
				themeReset.getAttribute('aria-label') === 'Reset Window theme to System',
			'Reset names the default, in its accessible name too'
		);
		themeReset.click();
		await wait(() => settingsCommits.length === 2, 'reset saved');
		check(!settingsCommits[1]!.includes('window.theme'), 'Reset removes the key');
		check(
			document.activeElement === themeRadios[0] && themeReset.hidden,
			'Reset moves focus to its control, now on the default'
		);
		check(
			buttonIn(settingRow('editor.fontSize'), 'Reset to 14 px') !== undefined &&
				buttonIn(settingRow('workbench.colorTheme'), 'Reset to GitHub Dark Default') !==
					undefined,
			'Reset labels name each default'
		);
		buttonIn(root, 'Exam editor')!.click();
		check(
			root.textContent!.includes(
				'When you join an exam, these settings are copied into it and stay fixed until it ends.'
			),
			'The editor tab says how an exam uses these settings'
		);
		check(
			root.querySelector<HTMLElement>('.prctr-settings-page__code')?.offsetParent !== null,
			'The editor tab previews code'
		);
		check(
			shownRows().includes('editor.cursorStyle') &&
				shownRows().includes('editor.cursorBlinking') &&
				shownRows().includes('workbench.tree.indent') &&
				settingRow('editor.cursorBlinking').textContent!.includes(
					'How the cursor blinks. Solid doesn’t blink.'
				),
			'The editor tab has Cursor style, Cursor blinking and Tree indentation'
		);
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
		const lineHeight =
			settingRow('editor.lineHeight').querySelector<HTMLElement>('[role="spinbutton"]')!;
		check(
			lineHeight.textContent === '22 px' &&
				lineHeight.getAttribute('aria-valuemin') === '16' &&
				lineHeight.getAttribute('aria-valuemax') === '40' &&
				lineHeight.getAttribute('aria-describedby') !== null,
			'Line height is a 16–40 px stepper at 22 px, described by its row'
		);
		lineHeight.focus();
		lineHeight.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		await wait(() => settingsCommits.length === 4, 'line height saved');
		check(
			document.activeElement === lineHeight && String(lineHeight.textContent) === '23 px',
			'A stepper keeps focus through its change and save'
		);
		conflictNext = true;
		settingRow('editor.fontSize')
			.querySelector<HTMLButtonElement>('[aria-label="Larger"]')!
			.click();
		await wait(() => settingsCommits.length === 6, 'conflict reapplied');
		check(
			/"editor\.fontSize":\s*15/u.test(settingsCommits[5]!),
			'A conflicting save applies this page’s change again on the newer settings'
		);
		await wait(() => saveStatus().textContent === 'Saved', 'saved after the conflict');
		// #endregion

		// #region Settings tabs and Find
		const tablist = root.querySelector<HTMLElement>('[role="tablist"]')!;
		settingTabs[1]!.focus();
		tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
		check(
			document.activeElement === settingTabs[2] &&
				settingTabs[2]!.getAttribute('aria-selected') === 'true',
			'End selects and focuses the last tab'
		);
		check(
			root.textContent!.includes('High contrast and Interface size are under Appearance.'),
			'Accessibility points to Appearance'
		);
		buttonIn(root, 'Open Appearance')!.click();
		check(
			document.activeElement === settingTabs[0] &&
				settingTabs[0]!.getAttribute('aria-selected') === 'true',
			'Open Appearance selects and focuses the Appearance tab'
		);
		settingTabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
		check(document.activeElement === settingTabs[0], 'Home stays on the first tab');
		const find = root.querySelector<HTMLInputElement>('input[aria-label="Find a setting"]')!;
		const findFor = (query: string): void => {
			find.value = query;
			find.dispatchEvent(new Event('input', { bubbles: true }));
		};
		findFor('minimap');
		check(
			shownRows().join(',') === 'editor.minimap.enabled' &&
				root.textContent!.includes('Matching settings · 1') &&
				settingRow('editor.minimap.enabled').textContent!.includes('Exam editor · Layout'),
			'Find a setting narrows to matches across tabs, each saying where it lives'
		);
		check(
			root.querySelector('[role="tab"][aria-selected="true"]') === null &&
				settingTabs[0]!.tabIndex === 0 &&
				settingsPanel().getAttribute('aria-label') === 'Matching settings',
			'While finding no tab is selected, one keeps the tab stop and the panel is labelled'
		);
		findFor('dark');
		check(
			shownRows().includes('window.theme') && shownRows().includes('workbench.colorTheme'),
			'Find a setting finds both themes by a choice'
		);
		findFor('zoom');
		check(
			shownRows().includes('window.zoomLevel') &&
				shownRows().includes('browser.presentation.zoom'),
			'Find a setting finds sizes by an everyday word'
		);
		findFor('qqq');
		check(
			shownRows().length === 0 &&
				root.textContent!.includes('No setting matches “qqq”') &&
				root.textContent!.includes('Every tab is searched.'),
			'A search that finds nothing says so, with a hint'
		);
		buttonIn(root, 'Clear search')!.click();
		check(
			find.value === '' &&
				document.activeElement === find &&
				settingTabs[0]!.getAttribute('aria-selected') === 'true' &&
				shownRows()[0] === 'window.theme',
			'Clear search returns to the tab with focus in Find'
		);
		// #endregion

		// #region Settings failures and read only
		failNext = true;
		const minimap = settingRow('editor.minimap.enabled');
		buttonIn(root, 'Exam editor')!.click();
		minimap.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
		await wait(() => saveStatus().textContent === 'Not saved', 'failed save');
		const minimapBadge = minimap.querySelector<HTMLElement>('.prctr-status-badge')!;
		check(
			!minimapBadge.hidden && minimapBadge.textContent === 'Not saved',
			'The row that was not saved carries a badge'
		);
		await wait(
			() => host.textContent!.includes('Minimap wasn’t saved'),
			'toast naming the setting'
		);
		buttonIn(host, 'Try again')!.click();
		await wait(() => saveStatus().textContent === 'Saved', 'saved on trying again');
		check(minimapBadge.hidden, 'The badge leaves once the setting is saved');
		settingsWritable = false;
		for (const listener of settingsListeners) listener(settingsProjection());
		await wait(() => saveStatus().textContent === 'Read only', 'read only');
		check(
			root.textContent!.includes('Settings can’t be changed right now.') &&
				minimap.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled &&
				buttonIn(minimap, 'Reset to On')!.hidden,
			'Read only says so, dims every control and offers no Reset'
		);
		settingsWritable = true;
		for (const listener of settingsListeners) listener(settingsProjection());
		// #endregion

		// #region Layout and lifecycle
		host.style.inlineSize = '360px';
		assign('sessions');
		await wait(() => root.textContent!.includes('Lab PC 14'), 'narrow sessions');
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		const viewport = root.querySelector<HTMLElement>('.prctr-page-pane__viewport')!;
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
