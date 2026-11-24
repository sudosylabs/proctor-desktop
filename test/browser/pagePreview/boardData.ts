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

/** The Invitations board's rows: invitee, role, where, invited by, expiry day, bounced. */
const INVITATIONS: readonly (readonly [
	string,
	string | undefined,
	string,
	string,
	number,
	boolean
])[] = [
	['m.chen@northbridge.example', undefined, 'Data Mining (DS501)', 'Priya Raman', 12, false],
	['j.okoro@northbridge.example', 'Teacher', 'Computer Science', 'Grace Adeyemi', 14, false],
	['r.silva@northbridge-alumni.example', undefined, 'Databases (CS204)', 'Priya Raman', 15, true],
	[
		'a.kowalski@northbridge.example',
		'Records officer',
		'Northbridge University',
		'You',
		16,
		false
	],
	[
		'f.haddad@northbridge.example',
		undefined,
		'Linear Algebra (MA101)',
		'Tomás Ortega',
		18,
		false
	],
	['e.walsh@northbridge.example', undefined, 'Linear Algebra (MA101)', 'Tomás Ortega', 18, false],
	['n.ibrahim@northbridge.example', 'Teacher', 'Mathematics', 'Grace Adeyemi', 19, false],
	['k.tanaka@northbridge.example', undefined, 'Databases (CS204)', 'Priya Raman', 20, false],
	['l.osei@northbridge.example', undefined, 'Databases (CS204)', 'Priya Raman', 20, false],
	['m.rossi@northbridge.example', 'Teacher', 'Physics', 'Grace Adeyemi', 21, false]
];

function invitation(
	[email, role, scope, by, day, bounced]: (typeof INVITATIONS)[number],
	index: number
) {
	return {
		id: boardId(100 + index),
		purpose:
			role === undefined
				? 'student_class'
				: role === 'Teacher'
					? 'teacher_academic_unit'
					: 'institution_role',
		state: 'pending',
		email,
		revision: 1,
		inviterId: by === 'You' ? 'p'.repeat(26) : boardId(800 + index),
		...(by === 'You' ? {} : { inviterName: by }),
		...(role === undefined || role === 'Teacher' ? {} : { roleName: role }),
		scopeName: scope,
		createdAt: BOARD_NOW - 3 * DAY,
		expiresAt: Date.UTC(2026, 10, day, 12),
		startAt: BOARD_NOW - 3 * DAY,
		...(bounced
			? {
					delivery: {
						state: 'failed',
						recipient: 'r***@northbridge-alumni.example',
						failureCode: 'mail.bounced',
						updatedAt: BOARD_NOW - DAY
					}
				}
			: {})
	};
}

/** The Imports board's files: name, mode, rows, uploaded, state, rows that didn't import. */
const IMPORTS: readonly (readonly [string, string, number, number, string, number, string?])[] = [
	[
		'spring-onboarding.csv',
		'student_class',
		412,
		Date.UTC(2026, 10, 9, 9, 20),
		'preview_ready',
		6
	],
	['new-teachers.csv', 'teacher_academic_unit', 14, Date.UTC(2026, 10, 9, 8, 2), 'parsing', 0],
	['autumn-late-joiners.csv', 'student_class', 37, Date.UTC(2026, 10, 5, 10), 'completed', 0],
	['registry-staff.csv', 'institution', 6, Date.UTC(2026, 10, 2, 10), 'completed_with_errors', 2],
	[
		'roster-final.xlsx.csv',
		'student_class',
		0,
		Date.UTC(2026, 10, 1, 10),
		'failed',
		0,
		'onboarding_import.file_invalid'
	],
	['test-upload.csv', 'student_class', 3, Date.UTC(2026, 9, 28, 10), 'canceled', 0]
];

function onboardingImport(
	[fileName, mode, rows, at, state, missed, failureCode]: (typeof IMPORTS)[number],
	index: number
) {
	return {
		id: boardId(400 + index),
		mode,
		fileName,
		scopeType: 'institution',
		scopeId: boardId(900),
		state,
		revision: 2,
		totalRows: rows,
		validRows: rows - missed,
		invalidRows: state === 'completed_with_errors' ? 0 : missed,
		succeededRows: state.startsWith('completed') ? rows - missed : 0,
		failedRows: state === 'completed_with_errors' ? missed : 0,
		skippedRows: 0,
		noOpRows: 0,
		...(failureCode === undefined ? {} : { failureCode }),
		createdAt: at,
		updatedAt: at + 60 * 1000,
		expiresAt: at + 30 * DAY
	};
}

function job(index: number, type: string, at: number) {
	return {
		id: boardId(200 + index),
		type,
		status: 'failed',
		revision: 3,
		attempts: 3,
		maximumAttempts: 3,
		createdAt: at - HOUR,
		updatedAt: at,
		availableAt: at - HOUR,
		completedAt: at,
		errorCode: 'job.failed'
	};
}

function audit(index: number, summary: string, at: number, reason?: string) {
	return {
		id: boardId(600 + index),
		action: 'change',
		status: 'success',
		summary,
		createdAt: at,
		resourceType: 'user',
		resourceId: boardId(index),
		...(reason === undefined ? {} : { reason })
	};
}

function data(resource: string, value: unknown): AdministrationResponse {
	return { kind: 'data', data: { resource, value } as never };
}

/** Administration answering every read the boards draw; a change succeeds without doing anything. */
export class BoardAdministration implements AdministrationClient {
	async request(intent: AdministrationIntent): Promise<AdministrationResponse> {
		switch (intent.kind) {
			case 'users': {
				const affiliation = intent.affiliation?.[0];
				return data('users', {
					items: PEOPLE.map(userEntry).slice(0, intent.limit),
					cursor: 'page-2',
					// Everyone, or the board's 1,201 students and 83 staff (some are both).
					total:
						affiliation === 'student'
							? 1201
							: affiliation === 'staff'
								? 113
								: PEOPLE_TOTAL,
					totalAtLeast: false
				});
			}
			case 'invitations':
				return data('invitations', {
					items: INVITATIONS.map(invitation).slice(0, intent.limit),
					cursor: 'page-2',
					total: 18,
					totalAtLeast: false
				});
			case 'jobs':
				return data('jobs', {
					items: [
						job(1, 'retention.cleanup', Date.UTC(2026, 10, 9, 9, 16)),
						job(2, 'mail.rekey', Date.UTC(2026, 10, 9, 9, 12))
					],
					total: 2,
					totalAtLeast: false
				});
			case 'mailDeliveries':
				return data('mailDeliveries', {
					items: [0, 1, 2, 3].map((index) => ({
						id: boardId(300 + index),
						state: 'failed',
						recipient: `r***@northbridge-alumni.example`,
						template: 'access.invitation',
						attempts: 3,
						createdAt: BOARD_NOW - (index + 2) * HOUR,
						updatedAt: BOARD_NOW - (index + 1) * HOUR,
						deadline: BOARD_NOW + DAY,
						failedAt: BOARD_NOW - (index + 1) * HOUR,
						failureCode: 'mail.bounced'
					})),
					total: 4,
					totalAtLeast: false
				});
			case 'retentionControl':
				return data('retentionControl', {
					revision: 3,
					state: 'paused',
					updatedAt: Date.UTC(2026, 10, 2, 10)
				});
			case 'onboardingImports': {
				const states = intent.state;
				return data('onboardingImports', {
					items: IMPORTS.map(onboardingImport).filter(
						(item) => states === undefined || states.includes(item.state as never)
					)
				});
			}
			case 'audits':
				return data('audits', {
					items: [
						audit(
							1,
							'Grace Adeyemi gave Priya Raman the role Exam manager at Computer Science',
							Date.UTC(2026, 10, 9, 8, 40)
						),
						audit(
							2,
							'Kwame Boateng disabled the account of Sofia Novak',
							Date.UTC(2026, 9, 28, 16, 2),
							'Left the programme'
						),
						audit(
							3,
							'Amara Okafor changed the access policy',
							Date.UTC(2026, 9, 27, 11, 15),
							'Revision 14 · Proctor password, invited people may set a password'
						)
					]
				});
			case 'counts':
				return data('counts', {
					pendingInvitations: { count: 18, atLeast: false },
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
