import { CancellationToken } from '../../src/prctr/base/common/cancellation.ts';
import { Event as Events } from '../../src/prctr/base/common/event.ts';
import { createLocalization } from '../../src/prctr/base/common/localization.ts';
import type { AccountClient } from '../../src/prctr/platform/account/common/accountProtocol.ts';
import type {
	AdministrationClient,
	AdministrationIntent,
	AdministrationResponse,
	AdministrationValue
} from '../../src/prctr/platform/administration/common/administrationProtocol.ts';
import { pageMessages } from '../../src/prctr/workbench/browser/authenticated/pages/pageMessages.ts';
import { WorkbenchOverlayHost } from '../../src/prctr/workbench/browser/overlayHost.ts';
import { administrationMessages } from '../../src/prctr/workbench/contrib/administration/administrationMessages.ts';
import {
	AdministrationPane,
	type AdministrationModel
} from '../../src/prctr/workbench/contrib/administration/administrationPane.ts';
import type { AdministrationPage } from '../../src/prctr/workbench/services/authenticatedNavigation/common/authenticatedNavigationModel.ts';
import { createAccountTestServices } from './accountTestServices.ts';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const id = (seed: number): string =>
	`u${String(seed).padStart(25, '0')}`.replaceAll('0', 'a').slice(0, 26);

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`Administration: ${message}`);
}

type User = AdministrationValue<'user'>;

function user(seed: number, extra: Partial<User> = {}): User {
	return {
		id: id(seed),
		username: `person-${seed}`,
		displayName: `Person ${seed}`,
		firstName: 'Person',
		lastName: String(seed),
		email: `person-${seed}@northfield.example`,
		emailVerified: true,
		photoKind: 'default',
		createdAt: NOW - 30 * DAY,
		lastActivityAt: NOW - DAY,
		...extra
	};
}

const refuse: AccountClient = Object.freeze({
	async request() {
		return { kind: 'error' as const, reason: 'unavailable' as const };
	}
});

/** The server as the Administration pages see it: scripted reads and recorded changes. */
class FakeAdministration implements AdministrationClient {
	readonly intents: AdministrationIntent[] = [];
	people: readonly User[] = Array.from({ length: 14 }, (_, index) => user(index + 1));
	refuseUsers = false;

	async request(intent: AdministrationIntent): Promise<AdministrationResponse> {
		this.intents.push(intent);
		switch (intent.kind) {
			case 'users': {
				if (this.refuseUsers) return { kind: 'error', reason: 'noAccess' };
				const matching = this.people.filter(
					(person) => intent.q === undefined || person.displayName.includes(intent.q)
				);
				const start = intent.cursor === undefined ? 0 : Number(intent.cursor.slice(5));
				const items = matching.slice(start, start + intent.limit);
				const next =
					start + intent.limit < matching.length
						? `page-${start + intent.limit}`
						: undefined;
				return data('users', { items, ...(next === undefined ? {} : { cursor: next }) });
			}
			case 'user': {
				const found = this.people.find((person) => person.id === intent.id);
				return found === undefined
					? { kind: 'error', reason: 'notFound' }
					: data('user', found);
			}
			case 'affiliations':
				return data('affiliations', {
					items: [{ id: id(90), kind: 'student', startAt: NOW - 60 * DAY }]
				});
			case 'roleBindings':
				return data('roleBindings', { items: [] });
			case 'userSessions':
				return data('userSessions', { items: [] });
			case 'roles':
			case 'academicUnits':
			case 'unitChildren':
				return data(intent.kind, { items: [] });
			case 'institution':
				return data('institution', {
					id: id(99),
					name: 'northfield',
					displayName: 'Northfield University',
					description: ''
				});
			case 'disableUser':
				this.people = this.people.map((person) =>
					person.id === intent.id ? { ...person, disabledAt: NOW } : person
				);
				return { kind: 'success' };
			default:
				return { kind: 'error', reason: 'unavailable' };
		}
	}
}

function data<
	R extends
		| 'users'
		| 'user'
		| 'affiliations'
		| 'roleBindings'
		| 'userSessions'
		| 'roles'
		| 'academicUnits'
		| 'unitChildren'
		| 'institution'
>(resource: R, value: unknown): AdministrationResponse {
	return { kind: 'data', data: { resource, value } as never };
}

/** Administration pages against a scripted server: lists, paging, refusals and changes. */
export async function runAdministrationTests(document: Document): Promise<void> {
	const host = document.createElement('div');
	const background = document.createElement('div');
	host.style.cssText = 'position: relative; inline-size: 1100px; block-size: 760px;';
	document.body.append(host, background);
	const overlays = new WorkbenchOverlayHost(host, background);
	const administration = new FakeAdministration();
	const opened: string[] = [];
	const services = createAccountTestServices({
		document,
		account: refuse,
		administration,
		openAdministration: (page, subject) =>
			opened.push(subject === undefined ? page : `${page}/${subject}`),
		localization: createLocalization({
			requestedLocale: 'en',
			messages: [...Object.values(pageMessages), ...Object.values(administrationMessages)]
		}),
		binding: {
			kind: 'authenticated',
			windowId: 'test:administration',
			institutionOrigin: 'https://northfield.example',
			principalId: 'y'.repeat(26),
			sessionId: 'b'.repeat(26),
			initialDestination: 'administration',
			identity: {
				principalId: 'y'.repeat(26),
				sessionId: 'b'.repeat(26),
				institutionOrigin: 'https://northfield.example',
				institutionName: 'Northfield University',
				displayName: 'Amara Okafor',
				availableProductAreas: ['administration'],
				noCurrentAffiliation: false,
				noAssignedAccess: false
			}
		},
		overlays,
		now: () => NOW
	});
	const pane = services.instantiationService.createInstance(AdministrationPane, document);
	host.append(pane.element);
	const root = pane.element;
	const assign = (page: AdministrationPage, subject?: string): void => {
		const model: AdministrationModel = {
			page,
			subject,
			item: {
				typeId: 'prctr.authenticated.administration',
				logicalIdentity: subject === undefined ? page : `${page}/${subject}`,
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
		for (let i = 0; i < 80; i++) {
			if (predicate()) return;
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		}
		throw new Error(`Administration page did not settle: ${what}\n${root.textContent ?? ''}`);
	};
	const rows = (): HTMLTableRowElement[] => [
		...root.querySelectorAll<HTMLTableRowElement>('tbody tr')
	];
	const visibleText = (selector: string): string[] =>
		[...root.querySelectorAll<HTMLElement>(selector)]
			.filter((element) => element.closest('[hidden]') === null)
			.map((element) => element.textContent ?? '');
	const button = (text: string, scope: ParentNode = root): HTMLButtonElement | undefined =>
		[...scope.querySelectorAll<HTMLButtonElement>('button')].find(
			(candidate) =>
				candidate.textContent?.trim() === text && candidate.closest('[hidden]') === null
		);

	try {
		// Users: ten rows a page, Next by the server's cursor, no empty notice beside rows.
		assign('users');
		await wait(() => rows().length === 10, 'first page of users');
		check(
			visibleText('.prctr-page-section__state-text').length === 0,
			'A list with rows shows no empty notice'
		);
		check(rows()[0]?.textContent?.includes('Person 1'), 'Users are listed in order');
		button('Next')?.click();
		await wait(() => rows().length === 4, 'second page of users');
		const second = administration.intents.filter((intent) => intent.kind === 'users').at(-1);
		check(
			second?.kind === 'users' && second.cursor === 'page-10',
			'Next sends the server cursor'
		);
		check(
			rows()[0]?.textContent?.includes('Person 11'),
			'The second page starts after the first'
		);

		// Search reads from the first page with the query.
		const search = root.querySelector<HTMLInputElement>('input[type="search"]')!;
		search.value = 'Person 3';
		search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await wait(() => rows().length === 1, 'search results');
		const searched = administration.intents.filter((intent) => intent.kind === 'users').at(-1);
		check(
			searched?.kind === 'users' &&
				searched.q === 'Person 3' &&
				searched.cursor === undefined,
			'A search starts from page one'
		);

		// Opening a person goes to their page.
		root.querySelector<HTMLButtonElement>('.prctr-admin-list__open')!.click();
		check(opened.at(-1) === `user/${id(3)}`, 'A name opens that person’s page');

		// A refusal is calm: no rows, no retry.
		administration.refuseUsers = true;
		assign('users');
		await wait(
			() =>
				visibleText('.prctr-page-section__state-text').some((text) =>
					text.includes('don’t have access')
				),
			'refusal'
		);
		check(button('Try again') === undefined, 'A refusal offers no retry');
		administration.refuseUsers = false;

		// One user: heading, trail, profile, and an affiliation row without an empty notice.
		assign('user', id(2));
		await wait(() => root.querySelector('h1')?.textContent === 'Person 2', 'user heading');
		check(
			visibleText('.prctr-page-pane__trail-step').join() === 'Users',
			'The trail leads back to Users'
		);
		check(
			visibleText('.prctr-page-pane__status').join() === 'Active',
			'The status reads Active'
		);
		await wait(
			() => visibleText('.prctr-page-row__title').includes('Student'),
			'affiliation row'
		);
		check(
			!visibleText('.prctr-page-section__state-text').includes('No affiliations yet.'),
			'An affiliation list with a row shows no empty notice'
		);

		// Disabling asks first, then sends the change and shows the new status.
		const more = root.querySelector<HTMLButtonElement>('.prctr-admin-menu-button')!;
		more.click();
		const disable = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
			(item) => item.textContent?.includes('Disable account')
		);
		check(disable, 'The user menu offers Disable account');
		disable.click();
		const dialog = (): HTMLDialogElement | null => host.querySelector('dialog[open]');
		await wait(() => dialog() !== null, 'disable confirmation');
		check(
			!administration.intents.some((intent) => intent.kind === 'disableUser'),
			'Nothing changes before confirming'
		);
		button('Disable account', dialog()!)!.click();
		await wait(
			() => visibleText('.prctr-page-pane__status').join() === 'Disabled',
			'disabled status'
		);
		check(
			administration.intents.some(
				(intent) => intent.kind === 'disableUser' && intent.id === id(2)
			),
			'The change names the person'
		);
	} finally {
		pane.dispose();
		services.dispose();
		overlays.dispose();
		host.remove();
		background.remove();
	}
}
