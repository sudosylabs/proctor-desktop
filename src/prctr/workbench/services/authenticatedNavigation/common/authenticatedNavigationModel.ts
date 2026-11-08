/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { ProductArea } from '../../../../platform/examActivity/common/examActivityProtocol.js';

export const productDestinations = ['activity', 'management', 'administration'] as const;
export type ProductDestination = (typeof productDestinations)[number];
export type AuthenticatedDestination = ProductDestination | 'account';

export const activityViews = [
	'overview',
	'upcoming',
	'available',
	'in_progress',
	'submitted',
	'results_available',
	'past'
] as const;
export type ActivityView = (typeof activityViews)[number];

export const accountPages = [
	'profile',
	'security',
	'sessions',
	'tokens',
	'history',
	'settings'
] as const;
export type AccountPage = (typeof accountPages)[number];

export const administrationPages = [
	'overview',
	'users',
	'user',
	'invitations',
	'imports',
	'structure',
	'class',
	'periods',
	'roles',
	'policy',
	'audits',
	'retention',
	'jobs',
	'mail'
] as const;
export type AdministrationPage = (typeof administrationPages)[number];

/** Pages about one record, opened from a list; each needs the record's id. */
const administrationSubjectPages: readonly AdministrationPage[] = ['user', 'class'];

/** The list a record's page is opened from, which the sidebar marks while the record is shown. */
export const administrationParents: Readonly<
	Partial<Record<AdministrationPage, AdministrationPage>>
> = Object.freeze({ user: 'users', class: 'structure' });

export function administrationPageNeedsSubject(page: AdministrationPage): boolean {
	return administrationSubjectPages.includes(page);
}

const areaDestinations: Readonly<Partial<Record<ProductArea, ProductDestination>>> = Object.freeze({
	student_activity: 'activity',
	exam_management: 'management',
	administration: 'administration'
});

/** One place in the window: an area or Account, and the page last chosen inside each. */
export interface AuthenticatedLocation {
	readonly destination: AuthenticatedDestination;
	readonly activityView: ActivityView;
	readonly accountPage: AccountPage;
	readonly administrationPage: AdministrationPage;
	/** The record an Administration record page shows, such as a user's id. */
	readonly administrationSubject: string | undefined;
}

export interface AuthenticatedLocationChange {
	readonly previous: AuthenticatedLocation;
	readonly current: AuthenticatedLocation;
}

const MAX_HISTORY = 50;

/**
 * Where AuthenticatedWindow is and how it got there. The server's available
 * product areas decide which destinations exist; they route, never authorize.
 * Back and forward skip places that are no longer available.
 */
export class AuthenticatedNavigationModel extends Disposable {
	private readonly changeEmitter = this._register(new Emitter<AuthenticatedLocationChange>());
	readonly onDidChange: Event<AuthenticatedLocationChange> = this.changeEmitter.event;

	private readonly historyEmitter = this._register(new Emitter<void>());
	/** Back or forward availability changed. */
	readonly onDidChangeHistory: Event<void> = this.historyEmitter.event;

	private readonly areasEmitter = this._register(new Emitter<void>());
	readonly onDidChangeAreas: Event<void> = this.areasEmitter.event;

	private available: readonly ProductDestination[];
	private current: AuthenticatedLocation;
	private readonly backStack: AuthenticatedLocation[] = [];
	private readonly forwardStack: AuthenticatedLocation[] = [];

	constructor(areas: readonly string[], initialDestination: string) {
		super();
		this.available = destinationsOf(areas);
		this.current = Object.freeze({
			destination: this.resolve(initialDestination),
			activityView: 'overview',
			// Settings is an Account page; a window opened at Settings starts there.
			accountPage: initialDestination === 'settings' ? 'settings' : 'profile',
			administrationPage: 'overview',
			administrationSubject: undefined
		});
	}

	get location(): AuthenticatedLocation {
		return this.current;
	}

	get destinations(): readonly ProductDestination[] {
		return this.available;
	}

	get canGoBack(): boolean {
		return this.backStack.some((location) => this.isAvailable(location.destination));
	}

	get canGoForward(): boolean {
		return this.forwardStack.some((location) => this.isAvailable(location.destination));
	}

	isAvailable(destination: AuthenticatedDestination): boolean {
		return destination === 'account' || this.available.includes(destination);
	}

	/** Go somewhere new, remembering where the window was. Returns whether the location changed. */
	navigate(next: Partial<AuthenticatedLocation>): boolean {
		const target = this.locationFrom(next);
		if (sameLocation(target, this.current)) return false;
		this.backStack.push(this.current);
		if (this.backStack.length > MAX_HISTORY) this.backStack.shift();
		this.forwardStack.length = 0;
		this.move(target);
		this.historyEmitter.fire();
		return true;
	}

	back(): boolean {
		return this.traverse(this.backStack, this.forwardStack);
	}

	forward(): boolean {
		return this.traverse(this.forwardStack, this.backStack);
	}

	/** Replace the available areas with a fresh server projection. */
	setAreas(areas: readonly string[]): void {
		const next = destinationsOf(areas);
		if (next.join() === this.available.join()) return;
		this.available = next;
		this.areasEmitter.fire();
		if (!this.isAvailable(this.current.destination))
			this.move(this.locationFrom({ destination: this.current.destination }));
		this.historyEmitter.fire();
	}

	private traverse(from: AuthenticatedLocation[], to: AuthenticatedLocation[]): boolean {
		while (from.length > 0) {
			const candidate = from.pop()!;
			if (!this.isAvailable(candidate.destination)) continue;
			to.push(this.current);
			this.move(candidate);
			this.historyEmitter.fire();
			return true;
		}
		this.historyEmitter.fire();
		return false;
	}

	private move(target: AuthenticatedLocation): void {
		const previous = this.current;
		this.current = target;
		this.changeEmitter.fire({ previous, current: target });
	}

	private locationFrom(next: Partial<AuthenticatedLocation>): AuthenticatedLocation {
		const page = next.administrationPage ?? this.current.administrationPage;
		const subject =
			next.administrationPage === undefined
				? this.current.administrationSubject
				: next.administrationSubject;
		// A record page without its record shows the list it belongs to.
		const administration =
			administrationPageNeedsSubject(page) && subject === undefined
				? {
						administrationPage: administrationParents[page] ?? 'overview',
						administrationSubject: undefined
					}
				: {
						administrationPage: page,
						administrationSubject: administrationPageNeedsSubject(page)
							? subject
							: undefined
					};
		return Object.freeze({
			destination: this.resolve(next.destination ?? this.current.destination),
			activityView: next.activityView ?? this.current.activityView,
			accountPage: next.accountPage ?? this.current.accountPage,
			...administration
		});
	}

	/** An unavailable destination falls back to the first available area, then to Account. */
	private resolve(destination: string): AuthenticatedDestination {
		if (destination === 'account' || destination === 'settings') return 'account';
		const area = this.available.find((candidate) => candidate === destination);
		return area ?? this.available[0] ?? 'account';
	}
}

/** Product areas the server lists, in rail order; other listed areas, such as Account, are not destinations. */
function destinationsOf(areas: readonly string[]): readonly ProductDestination[] {
	return Object.freeze(
		productDestinations.filter((destination) =>
			areas.some(
				(area) =>
					Object.hasOwn(areaDestinations, area) &&
					areaDestinations[area as ProductArea] === destination
			)
		)
	);
}

function sameLocation(a: AuthenticatedLocation, b: AuthenticatedLocation): boolean {
	if (a.destination !== b.destination) return false;
	if (a.destination === 'activity') return a.activityView === b.activityView;
	if (a.destination === 'account') return a.accountPage === b.accountPage;
	if (a.destination === 'administration')
		return (
			a.administrationPage === b.administrationPage &&
			a.administrationSubject === b.administrationSubject
		);
	return true;
}
