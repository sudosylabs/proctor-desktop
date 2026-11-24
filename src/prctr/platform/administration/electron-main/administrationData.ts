/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	changeTags,
	tagCovers,
	type ServerChangeTags,
	type ServerDataTag
} from '../../serverApi/common/serverDataTags.js';
import type {
	AdministrationChangeIntent,
	AdministrationIntentOf,
	AdministrationReadIntent,
	AdministrationResponse
} from '../common/administrationProtocol.js';

/*
 * What each Administration read holds and what each change writes, as server data tags. A
 * change fences only the reads its tags cover, so a page about something else keeps its data.
 * Both maps are exhaustive over their intents: a new read or change does not compile until it
 * says what it touches.
 *
 * Collections: `user`, `invitation`, `import`, `progression`, `institution`, `structure` (units,
 * programmes, levels, classes, periods and their members), `role`, `policy/access`,
 * `policy/desktop`, `retention`, `job`, `mail`, `keys`, `preview`, `audit` and `counts`.
 */

type ReadKind = AdministrationReadIntent['kind'];
type ChangeKind = AdministrationChangeIntent['kind'];

interface ReadTags<K extends ReadKind> {
	readonly tags: (intent: AdministrationIntentOf<K>) => readonly ServerDataTag[];
	/** The collection whose rows a page lists; each row adds `<collection>/<row id>`. */
	readonly rows?: string;
}
const fixed =
	(...tags: readonly ServerDataTag[]) =>
	(): readonly ServerDataTag[] =>
		tags;

const reads: { readonly [K in ReadKind]: ReadTags<K> } = {
	users: { tags: fixed('user'), rows: 'user' },
	user: { tags: (i) => [`user/${i.id}`] },
	userPhoto: { tags: (i) => [`user/${i.userId}/photo`] },
	userSessions: { tags: (i) => [`user/${i.userId}/sessions`] },
	affiliations: { tags: (i) => [`user/${i.userId}/affiliations`] },
	invitations: { tags: fixed('invitation'), rows: 'invitation' },
	invitation: { tags: (i) => [`invitation/${i.id}`] },
	onboardingImports: { tags: fixed('import'), rows: 'import' },
	onboardingImport: { tags: (i) => [`import/${i.id}`] },
	studentProgressions: { tags: fixed('progression'), rows: 'progression' },
	studentProgression: { tags: (i) => [`progression/${i.id}`] },
	institution: { tags: fixed('institution') },
	academicUnits: { tags: fixed('structure') },
	unitChildren: { tags: fixed('structure') },
	unitMembers: { tags: fixed('structure') },
	unitClasses: { tags: fixed('structure') },
	unitProgrammes: { tags: fixed('structure') },
	programmeLevels: { tags: fixed('structure') },
	levelClasses: { tags: fixed('structure') },
	class: { tags: fixed('structure') },
	classMembers: { tags: fixed('structure') },
	academicPeriods: { tags: fixed('structure') },
	roles: { tags: fixed('role') },
	roleBindings: { tags: fixed('role') },
	accessPolicy: { tags: fixed('policy/access') },
	desktopCompatibility: { tags: fixed('policy/desktop') },
	audits: { tags: fixed('audit') },
	retentionPolicy: { tags: fixed('retention') },
	retentionControl: { tags: fixed('retention') },
	retentionPreview: { tags: fixed('retention') },
	retentionRecords: { tags: fixed('retention') },
	jobs: { tags: fixed('job'), rows: 'job' },
	job: { tags: (i) => [`job/${i.id}`] },
	jobAttempts: { tags: (i) => [`job/${i.jobId}`] },
	mailDeliveries: { tags: fixed('mail'), rows: 'mail' },
	mailDelivery: { tags: (i) => [`mail/${i.id}`] },
	mailMetrics: { tags: fixed('mail') },
	counts: { tags: fixed('counts') },
	mfaKeys: { tags: fixed('keys') },
	mailKeys: { tags: fixed('keys') },
	mfaRekey: { tags: (i) => [`job/${i.jobId}`, 'keys'] },
	mailRekey: { tags: (i) => [`job/${i.jobId}`, 'keys'] },
	academicPreview: { tags: (i) => [`preview/${i.id}`] },
	academicPreviewRows: { tags: (i) => [`preview/${i.id}`] }
};

type ChangeTagsOf<K extends ChangeKind> = (intent: AdministrationIntentOf<K>) => ServerChangeTags;
const all =
	(...tags: readonly ServerDataTag[]) =>
	(): ServerChangeTags =>
		changeTags(...tags);
/** A change that only checks something: it waits for writers of `tags` but fences nothing. */
const checks =
	(...tags: readonly ServerDataTag[]) =>
	(): ServerChangeTags => ({ writes: [], locks: tags });

/** Everything an academic batch, preview or import can touch. */
const academic = ['user', 'structure', 'role', 'invitation', 'preview', 'job', 'mail'] as const;

const changes: { readonly [K in ChangeKind]: ChangeTagsOf<K> } = {
	updateUser: (i) => changeTags(`user/${i.id}`),
	disableUser: (i) => changeTags(`user/${i.id}`, 'counts'),
	enableUser: (i) => changeTags(`user/${i.id}`, 'counts'),
	revokeUserSessions: (i) => changeTags(`user/${i.userId}/sessions`),
	revokeUserSession: (i) => changeTags(`user/${i.userId}/sessions`),
	resetUserMfa: (i) => changeTags(`user/${i.userId}`),
	changeUserEmail: (i) => changeTags(`user/${i.userId}`, 'mail'),
	verifyUserEmail: (i) => changeTags(`user/${i.userId}`, 'mail'),
	createAffiliation: (i) => changeTags(`user/${i.userId}`, 'counts'),
	// The intent names the affiliation, not its User.
	endAffiliation: all('user', 'counts'),
	replaceUserPhoto: (i) => changeTags(`user/${i.userId}`),
	removeUserPhoto: (i) => changeTags(`user/${i.userId}`),
	runAcademicBatch: all(...academic, 'counts'),
	createAcademicPreview: all('preview'),
	commitAcademicPreview: all(...academic, 'counts'),
	cancelAcademicPreview: (i) => changeTags(`preview/${i.id}`),
	inviteToInstitution: all('invitation', 'mail', 'counts'),
	inviteToUnit: all('invitation', 'mail', 'counts'),
	inviteTeacher: all('invitation', 'mail', 'counts'),
	inviteStudent: all('invitation', 'mail', 'counts'),
	runInvitationBatch: all('invitation', 'mail', 'job', 'counts'),
	replaceInvitation: (i) => changeTags(`invitation/${i.id}`, 'mail'),
	resendInvitation: (i) => changeTags(`invitation/${i.id}`, 'mail'),
	revokeInvitation: (i) => changeTags(`invitation/${i.id}`, 'counts'),
	uploadImport: all('import', 'job'),
	cancelImport: (i) => changeTags(`import/${i.id}`),
	commitImport: all('import', ...academic, 'counts'),
	checkProgression: all('progression', 'job'),
	cancelProgression: (i) => changeTags(`progression/${i.id}`),
	commitProgression: all('progression', 'structure', 'user', 'job'),
	updateInstitution: all('institution'),
	createRootUnit: all('structure', 'counts'),
	createChildUnit: all('structure', 'counts'),
	updateUnit: all('structure'),
	archiveUnit: all('structure', 'counts'),
	createProgramme: all('structure', 'counts'),
	updateProgramme: all('structure'),
	archiveProgramme: all('structure', 'counts'),
	createLevel: all('structure', 'counts'),
	updateLevel: all('structure'),
	archiveLevel: all('structure', 'counts'),
	createClass: all('structure', 'counts'),
	updateClass: all('structure'),
	archiveClass: all('structure', 'counts'),
	enrollClassMember: all('structure', 'user', 'counts'),
	endClassMember: all('structure', 'user', 'counts'),
	addUnitMember: all('structure', 'user', 'counts'),
	endUnitMember: all('structure', 'user', 'counts'),
	createAcademicPeriod: all('structure'),
	updateAcademicPeriod: all('structure'),
	archiveAcademicPeriod: all('structure'),
	createRole: all('role', 'counts'),
	updateRole: all('role'),
	deleteRole: all('role', 'counts'),
	createRoleBinding: all('role', 'user'),
	endRoleBinding: all('role', 'user'),
	preflightAccessPolicy: checks('policy/access'),
	replaceAccessPolicy: all('policy/access'),
	replaceDesktopCompatibility: all('policy/desktop'),
	replaceRetentionPolicy: all('retention'),
	changeRetentionControl: all('retention', 'job'),
	createRetentionPreview: all('retention'),
	cancelJob: (i) => changeTags(`job/${i.id}`),
	retryJob: (i) => changeTags(`job/${i.id}`),
	cancelMailDelivery: (i) => changeTags(`mail/${i.id}`, 'mail'),
	retryMailDelivery: (i) => changeTags(`mail/${i.id}`, 'mail'),
	sendTestMail: all('mail'),
	startMailRekey: all('keys', 'job'),
	startMfaRekey: all('keys', 'job'),
	// The confirmation itself writes nothing on the server's data.
	reauthenticate: all(),
	cancelReauthentication: all()
};

/** The tags a read carries before it answers. */
export function administrationReadTags(intent: AdministrationReadIntent): readonly ServerDataTag[] {
	return (reads[intent.kind] as ReadTags<ReadKind>).tags(intent as never);
}

/** The tags an answer adds: one per listed row, for a page that lists a collection. */
export function administrationValueTags(
	intent: AdministrationReadIntent
): ((value: unknown) => readonly ServerDataTag[]) | undefined {
	const collection = reads[intent.kind].rows;
	if (collection === undefined) return undefined;
	return (value) => {
		const response = value as AdministrationResponse;
		if (response.kind !== 'data' || !('items' in response.data.value)) return [];
		return (response.data.value.items as readonly { readonly id?: unknown }[]).flatMap(
			(item) => (typeof item.id === 'string' ? [`${collection}/${item.id}`] : [])
		);
	};
}

/**
 * The tags a change writes and locks. Every change is audited, so it writes `audit`; one that
 * writes the signed-in person's own User also writes `account`, so the Account pages re-read.
 */
export function administrationChangeTags(
	intent: AdministrationChangeIntent,
	principalId: string
): ServerChangeTags {
	const tags = (changes[intent.kind] as ChangeTagsOf<ChangeKind>)(intent as never);
	if (intent.kind === 'reauthenticate' || intent.kind === 'cancelReauthentication') return tags;
	const own = tags.writes.some((tag) => tagCovers(tag, `user/${principalId}`));
	return {
		writes: [...tags.writes, 'audit', ...(own ? ['account'] : [])],
		locks: tags.locks
	};
}

/** The tags a server event names, by event. */
export const administrationEventTags = {
	access_policy_changed: ['policy/access'],
	'job.changed': ['job', 'keys'],
	'onboarding_import.changed': ['import'],
	'invitation.changed': ['invitation', 'counts']
} as const satisfies Readonly<Record<string, readonly ServerDataTag[]>>;
