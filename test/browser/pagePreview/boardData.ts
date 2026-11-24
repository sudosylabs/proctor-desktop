import type {
	AdministrationClient,
	AdministrationIntent,
	AdministrationResponse
} from '../../../src/prctr/platform/administration/common/administrationProtocol.ts';

/*
 * The server as the design boards draw it: Northbridge University, the people and records the
 * Administration and Account boards show, so a page renders the boards' own content.
 */

/** The moment the boards are drawn at: Monday 9 November 2026, midday. */
export const BOARD_NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

export function boardId(seed: number): string {
	return `b${String(seed).padStart(25, '0')}`;
}

interface Person {
	readonly name: string;
	readonly email: string;
	readonly kind: 'staff' | 'student';
	readonly unit: string;
	readonly roles: readonly string[];
	readonly lastActive?: number;
	readonly status: 'active' | 'invited' | 'disabled';
}

/** The Users board's ten people, sorted by name. */
const PEOPLE: readonly Person[] = [
	{
		name: 'Ahmed Farouk',
		email: 'a.farouk',
		kind: 'staff',
		unit: 'Computer Science',
		roles: ['Teacher', 'Exam manager'],
		lastActive: Date.UTC(2026, 9, 27, 10),
		status: 'active'
	},
	{
		name: 'Daniel Mensah',
		email: 'd.mensah',
		kind: 'student',
		unit: 'BSc Computing · Year 2',
		roles: ['Teaching assistant'],
		lastActive: Date.UTC(2026, 10, 9, 9, 12),
		status: 'active'
	},
	{
		name: 'Grace Adeyemi',
		email: 'g.adeyemi',
		kind: 'staff',
		unit: 'Faculty of Science',
		roles: ['Institution administrator'],
		lastActive: Date.UTC(2026, 9, 20, 10),
		status: 'active'
	},
	{
		name: 'Hannah Lee',
		email: 'h.lee',
		kind: 'student',
		unit: 'BA History · Year 1',
		roles: [],
		lastActive: Date.UTC(2026, 10, 3, 10),
		status: 'active'
	},
	{
		name: 'Kwame Boateng',
		email: 'k.boateng',
		kind: 'staff',
		unit: 'Registry',
		roles: ['Records officer'],
		lastActive: Date.UTC(2026, 10, 2, 10),
		status: 'active'
	},
	{
		name: 'Lucas Moreau',
		email: 'l.moreau',
		kind: 'student',
		unit: 'BSc Mathematics · Year 2',
		roles: [],
		lastActive: Date.UTC(2026, 9, 21, 10),
		status: 'active'
	},
	{
		name: 'Mei Chen',
		email: 'm.chen',
		kind: 'student',
		unit: 'MSc Data Science',
		roles: [],
		status: 'invited'
	},
	{
		name: 'Priya Raman',
		email: 'p.raman',
		kind: 'staff',
		unit: 'Computer Science',
		roles: ['Exam manager'],
		lastActive: Date.UTC(2026, 10, 9, 8, 47),
		status: 'active'
	},
	{
		name: 'Sofia Novak',
		email: 's.novak',
		kind: 'student',
		unit: 'BSc Computing · Year 3',
		roles: [],
		lastActive: Date.UTC(2026, 9, 28, 10),
		status: 'disabled'
	},
	{
		name: 'Tomás Ortega',
		email: 't.ortega',
		kind: 'staff',
		unit: 'Mathematics',
		roles: ['Teacher'],
		lastActive: Date.UTC(2026, 10, 8, 17, 30),
		status: 'active'
	}
];
/** How many people the Users board counts in all. */
const PEOPLE_TOTAL = 1284;

function userEntry(person: Person, index: number) {
	const [first = '', ...rest] = person.name.split(' ');
	return {
		id: boardId(index + 1),
		username: person.email.replace('.', ''),
		displayName: person.name,
		firstName: first,
		lastName: rest.join(' '),
		email: `${person.email}@northbridge.example`,
		emailVerified: person.status !== 'invited',
		photoKind: 'default' as const,
		createdAt: BOARD_NOW - 200 * DAY,
		...(person.status === 'disabled' ? { disabledAt: BOARD_NOW - 5 * DAY } : {}),
		...(person.lastActive === undefined
			? {}
			: { lastActivityAt: person.lastActive, lastLoginAt: person.lastActive }),
		summary: {
			affiliations: [
				{
					kind: person.kind,
					units: [{ id: boardId(500 + index), name: person.unit }],
					unitsMore: 0
				}
			],
			affiliationsMore: 0,
			roles: person.roles.map((role, roleIndex) => ({
				roleId: boardId(700 + roleIndex),
				displayName: role,
				scopeType: 'institution' as const,
				scopeName: 'Northbridge University'
			})),
			rolesMore: 0
		}
	};
}

function data(resource: string, value: unknown): AdministrationResponse {
	return { kind: 'data', data: { resource, value } as never };
}

/** Administration answering every read the boards draw; a change succeeds without doing anything. */
export class BoardAdministration implements AdministrationClient {
	async request(intent: AdministrationIntent): Promise<AdministrationResponse> {
		switch (intent.kind) {
			case 'users':
				return data('users', {
					items: PEOPLE.map(userEntry).slice(0, intent.limit),
					cursor: 'page-2',
					total: PEOPLE_TOTAL,
					totalAtLeast: false
				});
			case 'counts':
				return data('counts', {
					pendingInvitations: { count: 0, atLeast: false },
					failedJobs: { count: 2, atLeast: false },
					failedMailDeliveries: { count: 0, atLeast: false },
					openImports: { count: 1, atLeast: false }
				});
			case 'institution':
				return data('institution', {
					id: boardId(900),
					name: 'northbridge',
					displayName: 'Northbridge University',
					description: ''
				});
			case 'roles':
			case 'academicUnits':
				return data(intent.kind, { items: [] });
			default:
				return { kind: 'error', reason: 'unavailable' };
		}
	}
}

export { HOUR };
