/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { ObservableCapability } from '../../capabilityObservation/common/capabilityObservation.js';
import {
	projectionFlag,
	projectionId,
	projectionList,
	projectionMember,
	projectionRecord,
	projectionText,
	projectionTime
} from '../../serverApi/common/projection.js';

/**
 * The Administration capability of one AuthenticatedWindow. Each intent names one closed read or
 * change; operations, URLs, headers and credentials never cross IPC. The server authorizes every
 * operation: a refusal is an answer, never a hint that something exists.
 */
export const ADMINISTRATION_CHANNEL = 'prctr:authenticated:administration';
/** The page sizes an administration list offers. */
export const ADMINISTRATION_PAGE_SIZES = [10, 25, 50] as const;
export type AdministrationPageSize = (typeof ADMINISTRATION_PAGE_SIZES)[number];
/** Items on one page of an administration list unless the person chose more. */
export const ADMINISTRATION_PAGE_SIZE = 10;
/** The most items one page of an administration list may hold. */
export const ADMINISTRATION_MAX_PAGE_SIZE = 50;

// #region Field language

/**
 * One bounded field. A string names a scalar, an array lists its closed members, `list` and
 * `shape` nest, and `optional` (only directly inside a shape) may be absent.
 */
type ScalarField = keyof ScalarValues;
interface ScalarValues {
	readonly id: string;
	/** An opaque continuation the server issued for the same query. */
	readonly cursor: string;
	/** One of {@link ADMINISTRATION_PAGE_SIZES}. */
	readonly pageLimit: AdministrationPageSize;
	/** A non-negative safe integer: a count or a revision. */
	readonly count: number;
	/** Epoch milliseconds. */
	readonly instant: number;
	/** Whole days, 0 to 36500. */
	readonly days: number;
	readonly flag: boolean;
	/** An explicit attestation; only `true` is accepted. */
	readonly confirmed: true;
	/** Server text up to 512 characters; control characters become spaces. */
	readonly text: string;
	/** Server text up to 4096 characters; control characters become spaces. */
	readonly longText: string;
	/** A name the person typed: 1 to 256 characters, no control characters. */
	readonly label: string;
	/** A description the person typed: up to 2048 characters; only line breaks are allowed. */
	readonly description: string;
	/** A search the person typed: 1 to 100 characters. */
	readonly search: string;
	readonly email: string;
	/** A catalogue name: a permission, an action, a scope type or a server code. */
	readonly code: string;
	/** A 32-digit hexadecimal key identifier. */
	readonly keyId: string;
	/** A 64-digit hexadecimal digest. */
	readonly digest: string;
	readonly buildId: string;
	readonly release: string;
	/** A client-chosen key for one item of a batch. */
	readonly batchKey: string;
	/** A CSV file of at most 10 MiB. */
	readonly csv: Uint8Array;
	/** Why an administrator did something, up to 500 characters; only line breaks are allowed. */
	readonly reason: string;
	/** How many days an invitation stays open: 1 to 30. */
	readonly expiryDays: number;
	/** A session length in minutes: 1 to 527,040, a leap year. */
	readonly minutes: number;
	/** The name of a file the person chose: 1 to 255 characters, no control characters. */
	readonly fileName: string;
	/** The strong revision of one profile photo. */
	readonly etag: string;
	/** A PNG, JPEG or WebP image of at most 5 MiB. */
	readonly image: Uint8Array;
	/** A profile photo the server rendered, as a WebP data URL. */
	readonly photo: string;
}
interface ListField {
	readonly list: Field;
	readonly max: number;
}
interface ShapeField {
	readonly shape: Shape;
}
interface OptionalField {
	readonly optional: Field;
}
type Field = ScalarField | readonly string[] | ListField | ShapeField;
type Shape = { readonly [key: string]: Field | OptionalField };

export type FieldValue<F> = F extends ScalarField
	? ScalarValues[F]
	: F extends readonly (infer M)[]
		? M
		: F extends { readonly list: infer I }
			? readonly FieldValue<I>[]
			: F extends { readonly shape: infer S }
				? ShapeValue<S>
				: never;
type RequiredKeys<S> = { [K in keyof S]: S[K] extends OptionalField ? never : K }[keyof S];
type OptionalKeys<S> = { [K in keyof S]: S[K] extends OptionalField ? K : never }[keyof S];
export type ShapeValue<S> = { readonly [K in RequiredKeys<S>]: FieldValue<S[K]> } & {
	readonly [K in OptionalKeys<S>]?: S[K] extends { readonly optional: infer F }
		? FieldValue<F>
		: never;
};

const scalarPatterns: Partial<Record<ScalarField, RegExp>> = {
	cursor: /^[\x21-\x7e]{1,2048}$/u,
	code: /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/u,
	keyId: /^[0-9a-f]{32}$/u,
	digest: /^[0-9a-f]{64}$/u,
	buildId: /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u,
	release: /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u,
	batchKey: /^[A-Za-z0-9._~-]{1,128}$/u,
	email: /^[^\s@\u0000-\u001f\u007f]{1,64}@[^\s@\u0000-\u001f\u007f]{1,189}$/u,
	etag: /^"[a-f0-9]{64}"$/u
};
function typed(value: unknown, limit: number, allowLineBreaks = false): string {
	if (
		typeof value !== 'string' ||
		value.length > limit ||
		(allowLineBreaks ? /[\u0000-\u0009\u000b-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(
			value
		)
	)
		throw new TypeError('Invalid administration text');
	return value;
}
function integer(value: unknown, minimum: number, maximum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum)
		throw new TypeError('Invalid administration number');
	return Number(value);
}
function readScalar(kind: ScalarField, value: unknown): unknown {
	const pattern = scalarPatterns[kind];
	if (pattern) {
		if (typeof value !== 'string' || !pattern.test(value))
			throw new TypeError('Invalid administration value');
		return value;
	}
	switch (kind) {
		case 'id':
			return projectionId(value);
		case 'pageLimit':
			if (!ADMINISTRATION_PAGE_SIZES.includes(value as AdministrationPageSize))
				throw new TypeError('Invalid administration page size');
			return value;
		case 'count':
		case 'instant':
			return projectionTime(value);
		case 'days':
			return integer(value, 0, 36500);
		case 'flag':
			return projectionFlag(value);
		case 'confirmed':
			if (value !== true) throw new TypeError('Invalid administration attestation');
			return true;
		case 'text':
			return projectionText(value, 512);
		case 'longText':
			return projectionText(value, 4096);
		case 'label': {
			const label = typed(value, 256);
			if (label.trim().length === 0) throw new TypeError('Invalid administration name');
			return label;
		}
		case 'description':
			return typed(value, 2048, true);
		case 'reason':
			return typed(value, 500, true);
		case 'expiryDays':
			return integer(value, 1, 30);
		case 'minutes':
			return integer(value, 1, 527040);
		case 'fileName': {
			const name = typed(value, 255);
			if (name.length === 0) throw new TypeError('Invalid administration file name');
			return name;
		}
		case 'image':
			if (
				!(value instanceof Uint8Array) ||
				value.byteLength < 1 ||
				value.byteLength > 5 * 1024 * 1024
			)
				throw new TypeError('Invalid administration image');
			return value.slice();
		case 'photo':
			if (
				typeof value !== 'string' ||
				value.length > 3 * 1024 * 1024 ||
				!/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)
			)
				throw new TypeError('Invalid administration photo');
			return value;
		case 'search': {
			const search = typed(value, 100);
			if (search.length === 0) throw new TypeError('Invalid administration search');
			return search;
		}
		case 'csv':
			if (
				!(value instanceof Uint8Array) ||
				value.byteLength < 1 ||
				value.byteLength > 10 * 1024 * 1024
			)
				throw new TypeError('Invalid administration file');
			return value.slice();
	}
	throw new TypeError('Invalid administration field');
}
function readField(field: Field, value: unknown): unknown {
	if (typeof field === 'string') return readScalar(field as ScalarField, value);
	if (Array.isArray(field)) return projectionMember(value, field as readonly string[]);
	if ('list' in (field as object)) {
		const list = field as ListField;
		return Object.freeze(
			projectionList(value, list.max).map((item) => readField(list.list, item))
		);
	}
	return readShape((field as ShapeField).shape, value);
}
function isOptional(field: Field | OptionalField): field is OptionalField {
	return typeof field === 'object' && !Array.isArray(field) && 'optional' in field;
}
/** Reads a record with exactly the shape's keys; an absent optional key stays absent. */
function readShape(shape: Shape, value: unknown, omit?: string): Record<string, unknown> {
	const input = projectionRecord(value);
	for (const key of Object.keys(input))
		if (key !== omit && !Object.hasOwn(shape, key))
			throw new TypeError('Unexpected administration field');
	const result: Record<string, unknown> = {};
	for (const [key, field] of Object.entries(shape)) {
		const item = input[key];
		if (item === undefined) {
			if (isOptional(field)) continue;
			throw new TypeError('Missing administration field');
		}
		result[key] = readField(isOptional(field) ? field.optional : field, item);
	}
	return Object.freeze(result);
}

// #endregion

// #region Server catalogues

export const affiliationKinds = ['student', 'teacher', 'staff', 'external'] as const;
export const invitationPurposes = [
	'student_class',
	'teacher_academic_unit',
	'academic_unit_role',
	'institution_role'
] as const;
export const invitationStates = [
	'pending',
	'accepted',
	'revoked',
	'expired',
	'superseded'
] as const;
export const invitationDeliveryStates = [
	'queued',
	'sending',
	'accepted',
	'failed',
	'suppressed',
	'canceled'
] as const;
export const invitationBatchOperations = [
	'student_class.create',
	'teacher_academic_unit.create',
	'academic_unit_role.create',
	'institution_role.create',
	'resend',
	'revoke'
] as const;
export const invitationScopeTypes = ['institution', 'academic_unit', 'class'] as const;
export const importModes = [
	'student_class',
	'teacher_academic_unit',
	'institution',
	'academic_administration'
] as const;
export const importStates = [
	'uploading',
	'parsing',
	'preview_ready',
	'executing',
	'completed',
	'completed_with_errors',
	'canceled',
	'failed'
] as const;
export const importRowStates = [
	'valid',
	'invalid',
	'duplicate',
	'pending',
	'succeeded',
	'no_op',
	'failed',
	'skipped',
	'canceled'
] as const;
export const importCommitPolicies = ['require_all_valid', 'valid_rows_only'] as const;
export const desktopPlatforms = ['darwin', 'win32', 'linux'] as const;
export const periodOwnerTypes = ['institution', 'academic_unit'] as const;
export const providerAdmissionModes = [
	'linked_only',
	'invitation_required',
	'auto_provision'
] as const;
export const accessPolicyFields = [
	'local_login_enabled',
	'public_registration_enabled',
	'invitation_admission_enabled',
	'invitation_local_credential_enabled',
	'desktop_authorization_enabled',
	'provider_admissions',
	'role_holder_mfa_required',
	'session_idle_minutes',
	'session_absolute_minutes',
	'revoke_existing_sessions'
] as const;
export const accessPolicyBlockers = [
	'provider_unavailable',
	'provider_admission_unsupported',
	'invitation_delivery_unavailable',
	'last_system_administrator_path',
	'mfa_unavailable'
] as const;
export const desktopAvailabilities = ['ready', 'maintenance'] as const;
export const retentionControlStates = ['disabled', 'enabled', 'paused'] as const;
export const retentionCategories = [
	'work',
	'integrity',
	'browser_activity',
	'security_operational'
] as const;
export const retentionBlockers = [
	'',
	'retired',
	'records_incomplete',
	'preservation_hold',
	'retention_unconfigured',
	'supporting_integrity',
	'export_in_progress',
	'retention_period'
] as const;
export const jobStates = [
	'queued',
	'running',
	'cancel_requested',
	'succeeded',
	'failed',
	'canceled'
] as const;
export const mailDeliveryStates = invitationDeliveryStates;
export const mailHealth = [
	'',
	'mail.disabled',
	'mail.healthy',
	'mail.smtp_outage',
	'mail.queue_delayed'
] as const;
export const batchItemStates = ['succeeded', 'no_op', 'failed'] as const;
export const academicBatchOperations = [
	'affiliation.add',
	'affiliation.end',
	'academic_unit_member.add',
	'academic_unit_member.end',
	'class.enroll',
	'class.end',
	'class.transfer',
	'role_binding.create',
	'role_binding.end',
	'user.enable',
	'user.disable',
	'user_sessions.revoke'
] as const;
export const jobAttemptStates = [
	'running',
	'succeeded',
	'failed',
	'canceled',
	'lease_expired',
	'incompatible'
] as const;
/** The existing-user operations a filter preview may apply; a transfer names exact memberships. */
export const academicPreviewOperations = academicBatchOperations.filter(
	(operation): operation is Exclude<(typeof academicBatchOperations)[number], 'class.transfer'> =>
		operation !== 'class.transfer'
);
export const academicPreviewStates = [
	'parsing',
	'preview_ready',
	'executing',
	'completed',
	'completed_with_errors',
	'canceled',
	'failed'
] as const;
export const academicPreviewGroups = ['will_change', 'no_op', 'skipped'] as const;
export const academicPreviewSkipReasons = [
	'academic_administration_preview.ambiguous',
	'academic_administration_preview.enrollment_conflict',
	'academic_administration_preview.self',
	'academic_administration_preview.student_affiliation_required',
	'academic_administration_preview.system_administrator'
] as const;
export const academicPreviewRowStates = [
	'valid',
	'invalid',
	'pending',
	'succeeded',
	'no_op',
	'failed',
	'skipped',
	'canceled'
] as const;
export const userStates = ['active', 'disabled'] as const;
export const auditStatuses = ['attempt', 'success', 'fail'] as const;
/** The list orders the server offers, by list. */
export const sortDirections = ['asc', 'desc'] as const;
export const userSorts = ['username', 'name', 'created', 'last_active'] as const;
export const classMemberSorts = ['enrolled', 'name'] as const;
export const unitMemberSorts = ['since', 'name'] as const;
export const mailDeliverySorts = ['updated', 'created'] as const;
export const photoMediaTypes = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** The counts the sidebar badges show; each is left out when the person can't list it. */
export const administrationCounts = [
	'pendingInvitations',
	'failedJobs',
	'failedMailDeliveries',
	'openImports'
] as const;

// #endregion

// #region Intents

const page = { cursor: { optional: 'cursor' }, limit: 'pageLimit' } as const;
const dir = { dir: { optional: sortDirections } } as const;
const order = { order: { optional: sortDirections } } as const;
/** The User directory's filters, shared by the Users list and a filter preview. */
const directoryFilter = {
	q: { optional: 'search' },
	affiliation: { optional: { list: affiliationKinds, max: affiliationKinds.length } },
	academicUnitId: { optional: 'id' },
	roleIds: { optional: { list: 'id', max: 16 } },
	state: { optional: userStates },
	neverSignedIn: { optional: 'flag' },
	lastActiveAfter: { optional: 'instant' },
	lastActiveBefore: { optional: 'instant' }
} as const;
const byId = { id: 'id' } as const;
const revised = { id: 'id', expectedRevision: 'count' } as const;
const period = { startAt: { optional: 'instant' }, endAt: { optional: 'instant' } } as const;
const expiry = { expiresInDays: { optional: 'expiryDays' } } as const;
const naming = {
	name: 'label',
	displayName: 'label',
	description: { optional: 'description' }
} as const;
const renaming = {
	name: { optional: 'label' },
	displayName: { optional: 'label' },
	description: { optional: 'description' }
} as const;
const accessSettings = {
	expectedRevision: 'count',
	localLogin: 'flag',
	publicRegistration: 'flag',
	invitationAdmission: 'flag',
	invitationLocalCredential: 'flag',
	desktopAuthorization: 'flag',
	providerAdmissions: {
		list: { shape: { providerId: 'code', mode: providerAdmissionModes } },
		max: 64
	},
	/** Everyone who holds a role must sign in with two-step verification. */
	roleHolderMfaRequired: 'flag',
	/** Left out to keep the deployment's default. */
	sessionIdleMinutes: { optional: 'minutes' },
	sessionAbsoluteMinutes: { optional: 'minutes' },
	revokeExistingSessions: 'flag'
} as const;

/** One read per resource, with its exact filters. */
export const administrationReads = {
	users: {
		...page,
		...directoryFilter,
		includeDisabled: { optional: 'flag' },
		sort: { optional: userSorts },
		...dir
	},
	user: byId,
	userPhoto: { userId: 'id' },
	userSessions: { ...page, userId: 'id', includeRevoked: { optional: 'flag' } },
	affiliations: { ...page, userId: 'id' },
	invitations: {
		...page,
		purpose: { optional: invitationPurposes },
		state: { optional: invitationStates },
		email: { optional: 'email' },
		targetId: { optional: 'id' }
	},
	invitation: byId,
	onboardingImports: {
		...page,
		state: { optional: { list: importStates, max: importStates.length } },
		...order
	},
	onboardingImport: byId,
	studentProgressions: {
		...page,
		state: { optional: { list: importStates, max: importStates.length } },
		sourceClassId: { optional: 'id' },
		destinationClassId: { optional: 'id' }
	},
	studentProgression: byId,
	institution: {},
	academicUnits: { ...page, q: { optional: 'search' } },
	unitChildren: { ...page, unitId: 'id' },
	unitMembers: {
		...page,
		unitId: 'id',
		history: { optional: 'flag' },
		sort: { optional: unitMemberSorts },
		...dir
	},
	unitClasses: { ...page, unitId: 'id', q: { optional: 'search' }, ...dir },
	unitProgrammes: { ...page, unitId: 'id', q: { optional: 'search' } },
	programmeLevels: { ...page, programmeId: 'id', q: { optional: 'search' } },
	levelClasses: { ...page, levelId: 'id', ...dir },
	class: byId,
	classMembers: {
		...page,
		classId: 'id',
		history: { optional: 'flag' },
		sort: { optional: classMemberSorts },
		...dir
	},
	academicPeriods: { ...page, q: { optional: 'search' } },
	roles: page,
	roleBindings: {
		...page,
		userId: { optional: 'id' },
		scopeType: { optional: 'code' },
		scopeId: { optional: 'id' }
	},
	accessPolicy: {},
	desktopCompatibility: {},
	audits: {
		...page,
		actorId: { optional: 'id' },
		/** Whom the events were about, as actor or resource. */
		subjectUserId: { optional: 'id' },
		actions: { optional: { list: 'code', max: 32 } },
		status: { optional: auditStatuses },
		resourceType: { optional: 'code' },
		resourceId: { optional: 'id' },
		createdAfter: { optional: 'instant' },
		createdBefore: { optional: 'instant' },
		...order
	},
	retentionPolicy: {},
	retentionControl: {},
	retentionPreview: byId,
	retentionRecords: page,
	jobs: {
		...page,
		status: { optional: { list: jobStates, max: jobStates.length } },
		...order
	},
	job: byId,
	jobAttempts: { ...page, jobId: 'id' },
	mailDeliveries: {
		...page,
		state: { optional: { list: mailDeliveryStates, max: mailDeliveryStates.length } },
		recipientUserId: { optional: 'id' },
		createdAfter: { optional: 'instant' },
		createdBefore: { optional: 'instant' },
		sort: { optional: mailDeliverySorts },
		...dir
	},
	mailDelivery: byId,
	mailMetrics: {},
	counts: {},
	mfaKeys: {},
	mailKeys: {},
	mfaRekey: { jobId: 'id' },
	mailRekey: { jobId: 'id' },
	academicPreview: byId,
	/** One class of a ready preview's rows; `reason` narrows only the skipped rows. */
	academicPreviewRows: {
		...page,
		id: 'id',
		group: academicPreviewGroups,
		reason: { optional: academicPreviewSkipReasons }
	}
} as const satisfies Record<string, Shape>;

/** One change per action, with its exact fields. */
export const administrationChanges = {
	// Users
	updateUser: {
		id: 'id',
		username: { optional: 'label' },
		displayName: { optional: 'label' },
		firstName: { optional: 'label' },
		lastName: { optional: 'label' },
		locale: { optional: 'code' },
		timezone: { optional: 'code' }
	},
	disableUser: { id: 'id', reason: { optional: 'reason' } },
	enableUser: byId,
	revokeUserSessions: { userId: 'id' },
	revokeUserSession: { userId: 'id', sessionId: 'id' },
	resetUserMfa: {
		userId: 'id',
		identityVerified: 'confirmed',
		reason: 'label',
		verificationReference: 'label'
	},
	changeUserEmail: { userId: 'id', email: 'email' },
	verifyUserEmail: { userId: 'id' },
	createAffiliation: { userId: 'id', affiliation: affiliationKinds, ...period },
	endAffiliation: byId,
	replaceUserPhoto: {
		userId: 'id',
		image: 'image',
		mediaType: photoMediaTypes,
		etag: { optional: 'etag' }
	},
	removeUserPhoto: { userId: 'id', etag: 'etag' },
	runAcademicBatch: {
		operation: academicBatchOperations,
		scopeType: invitationScopeTypes,
		scopeId: 'id',
		items: {
			list: {
				shape: {
					key: 'batchKey',
					userId: { optional: 'id' },
					relationshipId: { optional: 'id' },
					roleId: { optional: 'id' },
					affiliationKind: { optional: ['student', 'teacher', 'staff'] },
					...period
				}
			},
			max: 200
		}
	},
	/**
	 * Proposes one operation for every User the directory filter matches now. Nothing changes until
	 * the ready preview is committed with its revision and digest.
	 */
	createAcademicPreview: {
		operation: academicPreviewOperations,
		scopeType: invitationScopeTypes,
		scopeId: 'id',
		filter: { shape: directoryFilter },
		roleId: { optional: 'id' },
		affiliationKind: { optional: affiliationKinds },
		...period
	},
	commitAcademicPreview: { ...revised, previewDigest: 'digest' },
	cancelAcademicPreview: byId,
	// Invitations and onboarding imports
	inviteToInstitution: {
		institutionId: 'id',
		email: 'email',
		roleId: 'id',
		...period,
		...expiry
	},
	inviteToUnit: { unitId: 'id', email: 'email', roleId: 'id', ...period, ...expiry },
	inviteTeacher: { unitId: 'id', email: 'email', roleId: 'id', ...period, ...expiry },
	inviteStudent: { classId: 'id', email: 'email', ...period, ...expiry },
	runInvitationBatch: {
		operation: invitationBatchOperations,
		scopeType: invitationScopeTypes,
		scopeId: 'id',
		items: {
			list: {
				shape: {
					key: 'batchKey',
					email: { optional: 'email' },
					roleId: { optional: 'id' },
					invitationId: { optional: 'id' },
					expectedRevision: { optional: 'count' },
					...period,
					...expiry
				}
			},
			max: 200
		}
	},
	replaceInvitation: {
		...revised,
		purpose: invitationPurposes,
		email: 'email',
		roleId: { optional: 'id' },
		institutionId: { optional: 'id' },
		academicUnitId: { optional: 'id' },
		classId: { optional: 'id' },
		...period,
		...expiry
	},
	resendInvitation: revised,
	revokeInvitation: revised,
	uploadImport: {
		mode: importModes,
		scopeType: invitationScopeTypes,
		scopeId: 'id',
		roleId: { optional: 'id' },
		fileName: { optional: 'fileName' },
		csv: 'csv'
	},
	cancelImport: byId,
	commitImport: { ...revised, policy: importCommitPolicies, previewDigest: 'digest' },
	checkProgression: {
		sourcePeriodId: 'id',
		sourceClassId: 'id',
		destinationPeriodId: 'id',
		destinationClassId: 'id',
		effectiveAt: 'instant'
	},
	cancelProgression: byId,
	commitProgression: { ...revised, previewDigest: 'digest' },
	// Academic structure
	updateInstitution: renaming,
	createRootUnit: naming,
	createChildUnit: { parentId: 'id', ...naming },
	updateUnit: { ...revised, ...renaming, parentId: { optional: 'id' } },
	archiveUnit: revised,
	createProgramme: { unitId: 'id', ...naming },
	updateProgramme: { ...revised, ...renaming },
	archiveProgramme: revised,
	createLevel: { programmeId: 'id', ...naming },
	updateLevel: { ...revised, ...renaming },
	archiveLevel: revised,
	createClass: { levelId: 'id', academicPeriodId: 'id', ...naming },
	updateClass: {
		...revised,
		...renaming,
		academicPeriodId: { optional: 'id' },
		levelId: { optional: 'id' }
	},
	archiveClass: revised,
	enrollClassMember: { classId: 'id', userId: 'id', ...period },
	endClassMember: byId,
	addUnitMember: { unitId: 'id', userId: 'id', startAt: { optional: 'instant' } },
	endUnitMember: byId,
	createAcademicPeriod: {
		ownerType: periodOwnerTypes,
		ownerId: 'id',
		...naming,
		startAt: 'instant',
		endAt: 'instant'
	},
	updateAcademicPeriod: { ...revised, ...renaming, ...period },
	archiveAcademicPeriod: revised,
	// Roles and role bindings
	createRole: { ...naming, name: 'code', permissions: { list: 'code', max: 256 } },
	updateRole: {
		id: 'id',
		displayName: { optional: 'label' },
		description: { optional: 'description' },
		permissions: { optional: { list: 'code', max: 256 } }
	},
	deleteRole: byId,
	createRoleBinding: {
		roleId: 'id',
		userId: 'id',
		scopeType: 'code',
		scopeId: 'id',
		...period
	},
	endRoleBinding: byId,
	// Access policy and Desktop compatibility
	preflightAccessPolicy: accessSettings,
	replaceAccessPolicy: accessSettings,
	replaceDesktopCompatibility: {
		expectedRevision: 'count',
		availability: desktopAvailabilities,
		minimumRelease: 'release',
		message: 'description',
		retryAt: { optional: 'instant' },
		revokedBuildIds: { list: 'buildId', max: 256 }
	},
	// Retention
	replaceRetentionPolicy: {
		expectedRevision: 'count',
		auditDays: 'days',
		browserActivityDays: 'days',
		deletionGraceDays: 'days',
		exportDays: 'days',
		integrityDays: 'days',
		securityOperationalDays: 'days',
		submissionDays: 'days',
		candidateNotices: 'flag'
	},
	changeRetentionControl: {
		expectedRevision: 'count',
		expectedPolicyRevision: 'count',
		state: ['enabled', 'paused'],
		previewId: { optional: 'id' }
	},
	createRetentionPreview: { expectedRevision: 'count' },
	// Jobs
	cancelJob: byId,
	retryJob: byId,
	// Mail and MFA keys
	cancelMailDelivery: byId,
	retryMailDelivery: byId,
	sendTestMail: {},
	startMailRekey: { retiringKeyId: 'keyId' },
	startMfaRekey: { retiringKeyId: 'keyId' },
	// Confirm it's you, for a change that needs a recent sign-in
	reauthenticate: {},
	cancelReauthentication: {}
} as const satisfies Record<string, Shape>;

type IntentsOf<T> = { [K in keyof T]: { readonly kind: K } & ShapeValue<T[K]> }[keyof T];
export type AdministrationReadKind = keyof typeof administrationReads;
export type AdministrationChangeKind = keyof typeof administrationChanges;
export type AdministrationReadIntent = IntentsOf<typeof administrationReads>;
export type AdministrationChangeIntent = IntentsOf<typeof administrationChanges>;
export type AdministrationIntent = AdministrationReadIntent | AdministrationChangeIntent;
export type AdministrationIntentOf<K extends AdministrationIntent['kind']> = Extract<
	AdministrationIntent,
	{ readonly kind: K }
>;

export function isAdministrationRead(
	intent: AdministrationIntent
): intent is AdministrationReadIntent {
	return Object.hasOwn(administrationReads, intent.kind);
}

/** Pairs of instants where the second must come after the first. */
const instantRanges = [
	['startAt', 'endAt'],
	['createdAfter', 'createdBefore'],
	['lastActiveAfter', 'lastActiveBefore']
] as const;

export function validateAdministrationIntent(value: unknown): AdministrationIntent {
	const input = projectionRecord(value);
	const kind = input.kind;
	const shape: Shape | undefined =
		typeof kind !== 'string'
			? undefined
			: Object.hasOwn(administrationReads, kind)
				? administrationReads[kind as AdministrationReadKind]
				: Object.hasOwn(administrationChanges, kind)
					? administrationChanges[kind as AdministrationChangeKind]
					: undefined;
	if (!shape) throw new TypeError('Invalid administration action');
	const fields = readShape(shape, input, 'kind');
	const ranges = [fields, fields.filter as Record<string, unknown> | undefined];
	for (const range of ranges)
		for (const [from, to] of instantRanges)
			if (
				typeof range?.[from] === 'number' &&
				typeof range[to] === 'number' &&
				range[to] <= range[from]
			)
				throw new TypeError('Invalid administration period');
	if (kind === 'academicPreviewRows' && fields.reason !== undefined && fields.group !== 'skipped')
		throw new TypeError('Invalid administration preview reason');
	return Object.freeze({ kind, ...fields }) as AdministrationIntent;
}

// #endregion

// #region Resources

function pageOf<S extends Shape>(item: S) {
	return {
		items: { list: { shape: item }, max: ADMINISTRATION_MAX_PAGE_SIZE },
		cursor: { optional: 'cursor' },
		/** On a first page only: how many items the whole list holds, at most 10,000. */
		total: { optional: 'count' },
		/** The list holds at least `total` items. */
		totalAtLeast: { optional: 'flag' }
	} as const;
}
const userShape = {
	id: 'id',
	username: 'text',
	displayName: 'text',
	firstName: 'text',
	lastName: 'text',
	email: { optional: 'text' },
	emailVerified: { optional: 'flag' },
	locale: { optional: 'text' },
	timezone: { optional: 'text' },
	photoKind: ['custom', 'default'],
	createdAt: 'instant',
	disabledAt: { optional: 'instant' },
	lastLoginAt: { optional: 'instant' },
	lastActivityAt: { optional: 'instant' }
} as const;
/** A person's current affiliations and roles, as the Users list shows them. */
const userSummaryShape = {
	affiliations: {
		list: {
			shape: {
				kind: affiliationKinds,
				units: { list: { shape: { id: 'id', name: 'text' } }, max: 2 },
				unitsMore: 'count'
			}
		},
		max: 3
	},
	affiliationsMore: 'count',
	/** Left out when the person can't see role grants. */
	roles: {
		optional: {
			list: {
				shape: {
					roleId: 'id',
					displayName: 'text',
					scopeType: invitationScopeTypes,
					scopeName: 'text'
				}
			},
			max: 3
		}
	},
	rolesMore: { optional: 'count' }
} as const;
const userEntryShape = {
	...userShape,
	summary: { optional: { shape: userSummaryShape } }
} as const;
const userSessionShape = {
	id: 'id',
	client: 'text',
	method: 'text',
	strength: 'text',
	platform: { optional: desktopPlatforms },
	deviceName: { optional: 'text' },
	release: { optional: 'text' },
	createdAt: 'instant',
	lastActivityAt: 'instant',
	expiresAt: 'instant',
	revokedAt: { optional: 'instant' },
	revocationCode: { optional: 'code' }
} as const;
const affiliationShape = {
	id: 'id',
	kind: affiliationKinds,
	startAt: 'instant',
	endAt: { optional: 'instant' }
} as const;
const invitationShape = {
	id: 'id',
	purpose: invitationPurposes,
	state: invitationStates,
	email: 'text',
	revision: 'count',
	inviterId: 'id',
	acceptedUserId: { optional: 'id' },
	academicUnitId: { optional: 'id' },
	classId: { optional: 'id' },
	academicPeriodId: { optional: 'id' },
	roleId: { optional: 'id' },
	createdAt: 'instant',
	expiresAt: 'instant',
	startAt: 'instant',
	endAt: { optional: 'instant' },
	delivery: {
		optional: {
			shape: {
				state: invitationDeliveryStates,
				recipient: 'text',
				failureCode: { optional: 'code' },
				updatedAt: 'instant'
			}
		}
	}
} as const;
const importSummaryShape = {
	id: 'id',
	mode: [...importModes, 'student_progression'],
	fileName: { optional: 'text' },
	scopeType: invitationScopeTypes,
	scopeId: 'id',
	roleId: { optional: 'id' },
	state: importStates,
	revision: 'count',
	totalRows: 'count',
	validRows: 'count',
	invalidRows: 'count',
	succeededRows: 'count',
	failedRows: 'count',
	skippedRows: 'count',
	noOpRows: 'count',
	previewDigest: { optional: 'digest' },
	commitPolicy: { optional: importCommitPolicies },
	failureCode: { optional: 'code' },
	createdAt: 'instant',
	updatedAt: 'instant',
	expiresAt: 'instant',
	/** A progression's classes and the day students move on. */
	sourceClassId: { optional: 'id' },
	sourceClassName: { optional: 'text' },
	sourcePeriodId: { optional: 'id' },
	destinationClassId: { optional: 'id' },
	destinationClassName: { optional: 'text' },
	destinationPeriodId: { optional: 'id' },
	effectiveAt: { optional: 'instant' }
} as const;
const importShape = {
	...importSummaryShape,
	/** The first rows of the preview or report. */
	rows: {
		list: {
			shape: {
				row: 'count',
				reference: 'text',
				operation: 'code',
				status: importRowStates,
				code: { optional: 'code' }
			}
		},
		max: 100
	},
	moreRows: 'flag'
} as const;
const named = {
	id: 'id',
	name: 'text',
	displayName: 'text',
	description: 'longText'
} as const;
const structured = {
	...named,
	revision: 'count',
	archivedAt: { optional: 'instant' }
} as const;
const unitShape = { ...structured, parentId: { optional: 'id' } } as const;
const programmeShape = { ...structured, unitId: 'id' } as const;
const levelShape = { ...structured, programmeId: 'id' } as const;
const classShape = {
	...structured,
	levelId: 'id',
	academicPeriodId: 'id',
	/** On a list row, for a viewer who may see members: current members, stopped at 10,000. */
	studentCount: { optional: 'count' },
	/** The count reached its bound, so there are at least `studentCount`. */
	studentCountAtLeast: { optional: 'flag' }
} as const;
const classMemberShape = {
	id: 'id',
	userId: 'id',
	classId: 'id',
	academicPeriodId: 'id',
	startAt: 'instant',
	endAt: { optional: 'instant' }
} as const;
const unitMemberShape = {
	id: 'id',
	userId: 'id',
	unitId: 'id',
	startAt: 'instant',
	endAt: { optional: 'instant' },
	user: {
		shape: { displayName: 'text', username: 'text', email: { optional: 'text' } }
	},
	/** Left out when the person can't see role grants in the unit. */
	rolesHere: {
		optional: { list: { shape: { roleId: 'id', displayName: 'text' } }, max: 5 }
	},
	rolesHereMore: { optional: 'count' }
} as const;
const periodShape = {
	...structured,
	ownerType: periodOwnerTypes,
	ownerId: 'id',
	startAt: 'instant',
	endAt: 'instant'
} as const;
const roleShape = {
	id: 'id',
	name: 'code',
	displayName: 'text',
	description: 'longText',
	builtIn: 'flag',
	permissions: { list: 'code', max: 256 },
	archivedAt: { optional: 'instant' }
} as const;
const roleBindingShape = {
	id: 'id',
	roleId: 'id',
	userId: 'id',
	scopeType: 'code',
	scopeId: 'id',
	startAt: 'instant',
	endAt: { optional: 'instant' }
} as const;
const auditShape = {
	id: 'id',
	action: 'text',
	status: 'text',
	/** One sentence the server wrote for display, naming only what the viewer may see. */
	summary: 'longText',
	createdAt: 'instant',
	resourceType: 'text',
	resourceId: 'text',
	actorId: { optional: 'text' },
	scopeType: { optional: 'text' },
	scopeId: { optional: 'text' },
	client: { optional: 'text' },
	method: { optional: 'text' },
	ipAddress: { optional: 'text' },
	userAgent: { optional: 'text' },
	errorCode: { optional: 'text' },
	/** Why an account was disabled; only institution-wide readers see it. */
	reason: { optional: 'longText' }
} as const;
const retentionCounts = {
	total: 'count',
	eligible: 'count',
	held: 'count',
	awaitingDeadline: 'count',
	unconfigured: 'count'
} as const;
const jobShape = {
	id: 'id',
	type: 'text',
	status: jobStates,
	revision: 'count',
	attempts: 'count',
	maximumAttempts: 'count',
	createdAt: 'instant',
	updatedAt: 'instant',
	availableAt: 'instant',
	startedAt: { optional: 'instant' },
	completedAt: { optional: 'instant' },
	errorCode: { optional: 'text' },
	progress: { optional: { shape: { stage: 'text', current: 'count', total: 'count' } } },
	createdById: { optional: 'id' },
	createdByName: { optional: 'text' },
	/** What the job works on, such as an exam's title. */
	subject: { optional: 'text' }
} as const;
const jobAttemptShape = {
	id: 'id',
	number: 'count',
	status: jobAttemptStates,
	startedAt: 'instant',
	completedAt: { optional: 'instant' },
	errorCode: { optional: 'code' }
} as const;
const mailDeliveryShape = {
	id: 'id',
	state: mailDeliveryStates,
	recipient: 'text',
	template: 'code',
	attempts: 'count',
	createdAt: 'instant',
	updatedAt: 'instant',
	deadline: 'instant',
	acceptedAt: { optional: 'instant' },
	failedAt: { optional: 'instant' },
	failureCode: { optional: 'text' }
} as const;
const mailDeliveryDetailShape = {
	...mailDeliveryShape,
	/** Left out for an email to an invitee who has no account yet. */
	targetUserId: { optional: 'id' },
	/** Present instead of the user for an email to an invitee. */
	targetInvitationId: { optional: 'id' },
	messageId: 'longText'
} as const;
/** A User directory filter as a preview froze it. */
const directoryFilterShape = {
	q: { optional: 'text' },
	affiliation: { optional: { list: affiliationKinds, max: affiliationKinds.length } },
	academicUnitId: { optional: 'id' },
	roleIds: { optional: { list: 'id', max: 16 } },
	state: { optional: userStates },
	neverSignedIn: { optional: 'flag' },
	lastActiveAfter: { optional: 'instant' },
	lastActiveBefore: { optional: 'instant' }
} as const;
const academicPreviewShape = {
	id: 'id',
	operation: academicPreviewOperations,
	state: academicPreviewStates,
	scopeType: invitationScopeTypes,
	scopeId: 'id',
	filter: { shape: directoryFilterShape },
	roleId: { optional: 'id' },
	affiliationKind: { optional: affiliationKinds },
	startAt: { optional: 'instant' },
	endAt: { optional: 'instant' },
	revision: 'count',
	/** Present once ready; the commit must name it. */
	previewDigest: { optional: 'digest' },
	totalRows: 'count',
	succeededRows: 'count',
	failedRows: 'count',
	skippedRows: 'count',
	noOpRows: 'count',
	/** Once ready: the rows by class, with skipped rows counted by reason. */
	summary: {
		optional: {
			shape: {
				willChange: 'count',
				noOp: 'count',
				skipped: 'count',
				skipReasons: { list: { shape: { reason: 'code', rows: 'count' } }, max: 32 }
			}
		}
	},
	failureCode: { optional: 'code' },
	previewJobId: 'id',
	executionJobId: { optional: 'id' },
	createdAt: 'instant',
	updatedAt: 'instant',
	expiresAt: 'instant',
	/** When a ready preview can no longer be committed. */
	commitBy: { optional: 'instant' }
} as const;
const academicPreviewRowShape = {
	row: 'count',
	userId: 'id',
	username: 'text',
	displayName: 'text',
	group: academicPreviewGroups,
	status: academicPreviewRowStates,
	/** Why a skipped row is skipped; the catalogue may grow. */
	reason: { optional: 'code' },
	/** The outcome code of a row after commit. */
	code: { optional: 'code' },
	/** What the row created or ended. */
	resourceId: { optional: 'id' }
} as const;
const countShape = { optional: { shape: { count: 'count', atLeast: 'flag' } } } as const;
const rekeyShape = {
	jobId: 'id',
	status: jobStates,
	primaryKeyId: 'keyId',
	retiringKeyId: 'keyId',
	processed: 'count',
	changed: 'count',
	errorCode: { optional: 'text' },
	createdAt: 'instant',
	updatedAt: 'instant',
	completedAt: { optional: 'instant' }
} as const;

/** What each read answers, plus the access policy preflight. */
export const administrationResources = {
	users: pageOf(userEntryShape),
	user: userShape,
	userPhoto: { dataUrl: 'photo', etag: 'etag' },
	userSessions: pageOf(userSessionShape),
	affiliations: pageOf(affiliationShape),
	invitations: pageOf(invitationShape),
	invitation: invitationShape,
	onboardingImports: pageOf(importSummaryShape),
	onboardingImport: importShape,
	studentProgressions: pageOf(importSummaryShape),
	studentProgression: importShape,
	institution: { ...named, archivedAt: { optional: 'instant' } },
	academicUnits: pageOf(unitShape),
	unitChildren: pageOf(unitShape),
	unitMembers: pageOf(unitMemberShape),
	unitClasses: pageOf(classShape),
	unitProgrammes: pageOf(programmeShape),
	programmeLevels: pageOf(levelShape),
	levelClasses: pageOf(classShape),
	class: classShape,
	classMembers: pageOf(classMemberShape),
	academicPeriods: pageOf(periodShape),
	roles: pageOf(roleShape),
	roleBindings: pageOf(roleBindingShape),
	accessPolicy: {
		revision: 'count',
		localLogin: 'flag',
		publicRegistration: 'flag',
		invitationAdmission: 'flag',
		invitationLocalCredential: 'flag',
		desktopAuthorization: 'flag',
		durableMail: 'flag',
		roleHolderMfaRequired: 'flag',
		/** False while two-step verification is off on the server, so the rule waits. */
		roleHolderMfaEnforced: 'flag',
		/** Absent while the deployment's default applies. */
		sessionIdleMinutes: { optional: 'count' },
		sessionIdleDefault: 'count',
		sessionIdleMaximum: 'count',
		sessionAbsoluteMinutes: { optional: 'count' },
		sessionAbsoluteDefault: 'count',
		sessionAbsoluteMaximum: 'count',
		providers: {
			list: { shape: { id: 'code', displayName: 'text', type: 'text' } },
			max: 64
		},
		providerAdmissions: {
			list: { shape: { providerId: 'code', mode: providerAdmissionModes } },
			max: 64
		},
		history: {
			list: {
				shape: {
					fromRevision: 'count',
					toRevision: 'count',
					changedAt: 'instant',
					actorId: 'id',
					changedFields: { list: 'code', max: 32 }
				}
			},
			max: 100
		},
		updatedAt: 'instant'
	},
	accessPolicyPreflight: {
		blockers: {
			list: { shape: { code: 'code', providerId: { optional: 'code' } } },
			max: 66
		},
		roleHoldersWithoutMfa: 'count',
		singleFactorSessions: 'count'
	},
	desktopCompatibility: {
		revision: 'count',
		availability: desktopAvailabilities,
		minimumRelease: 'text',
		message: 'text',
		retryAt: { optional: 'instant' },
		revokedBuildIds: { list: 'text', max: 256 },
		updatedAt: 'instant'
	},
	audits: pageOf(auditShape),
	retentionPolicy: {
		revision: 'count',
		auditDays: 'days',
		browserActivityDays: 'days',
		deletionGraceDays: 'days',
		exportDays: 'days',
		integrityDays: 'days',
		securityOperationalDays: 'days',
		submissionDays: 'days',
		candidateNotices: 'flag',
		automaticDeletion: 'flag',
		updatedAt: 'instant'
	},
	retentionControl: {
		revision: 'count',
		state: retentionControlStates,
		approvedPolicyRevision: { optional: 'count' },
		approvedPreviewId: { optional: 'id' },
		updatedAt: 'instant'
	},
	retentionPreview: {
		id: 'id',
		policyRevision: 'count',
		createdAt: 'instant',
		expiresAt: 'instant',
		work: { shape: retentionCounts },
		integrity: { shape: retentionCounts },
		browserActivity: { shape: retentionCounts },
		securityOperational: { shape: retentionCounts },
		audit: { shape: retentionCounts },
		receipts: { shape: retentionCounts }
	},
	retentionRecords: {
		...pageOf({
			submissionId: 'id',
			examId: 'id',
			sittingId: 'id',
			category: retentionCategories,
			blocker: retentionBlockers,
			held: 'flag',
			eligibleAt: { optional: 'instant' },
			retiredAt: { optional: 'instant' },
			completedAt: { optional: 'instant' }
		} as const),
		asOf: 'instant',
		policyRevision: 'count'
	},
	jobs: pageOf(jobShape),
	job: jobShape,
	jobAttempts: pageOf(jobAttemptShape),
	mailDeliveries: pageOf(mailDeliveryShape),
	mailDelivery: mailDeliveryDetailShape,
	counts: Object.fromEntries(administrationCounts.map((name) => [name, countShape])) as {
		readonly [N in (typeof administrationCounts)[number]]: typeof countShape;
	},
	mailMetrics: {
		health: mailHealth,
		queues: {
			list: {
				shape: {
					state: mailDeliveryStates,
					count: 'count',
					oldestAgeMs: 'count',
					health: mailHealth,
					truncated: 'flag'
				}
			},
			max: 64
		},
		deliveries: {
			list: { shape: { state: mailDeliveryStates, count: 'count', outcome: 'text' } },
			max: 64
		}
	},
	mfaKeys: {
		primaryKeyId: 'keyId',
		requiredPrimaryKeyId: { optional: 'keyId' },
		activeRekeyJobId: { optional: 'id' },
		keys: {
			list: { shape: { keyId: 'keyId', configured: 'flag', credentials: 'count' } },
			max: 9
		}
	},
	mailKeys: {
		primaryKeyId: 'keyId',
		requiredPrimaryKeyId: { optional: 'keyId' },
		keys: { list: { shape: { keyId: 'keyId', references: 'count' } }, max: 9 }
	},
	mfaRekey: rekeyShape,
	mailRekey: rekeyShape,
	academicPreview: academicPreviewShape,
	academicPreviewRows: pageOf(academicPreviewRowShape)
} as const satisfies Record<AdministrationReadKind | 'accessPolicyPreflight', Shape>;

export type AdministrationResource = keyof typeof administrationResources;
export type AdministrationValue<R extends AdministrationResource> = ShapeValue<
	(typeof administrationResources)[R]
>;
export type AdministrationData = {
	[R in AdministrationResource]: {
		readonly resource: R;
		readonly value: AdministrationValue<R>;
	};
}[AdministrationResource];

const batchResultShape = {
	operation: [...invitationBatchOperations, ...academicBatchOperations],
	succeeded: 'count',
	failed: 'count',
	noOp: 'count',
	items: {
		list: {
			shape: {
				index: 'count',
				status: batchItemStates,
				invitationId: { optional: 'id' },
				/** What an academic change created or ended. */
				resourceId: { optional: 'id' },
				errorCode: { optional: 'code' }
			}
		},
		max: 200
	}
} as const;
export type AdministrationBatchResult = ShapeValue<typeof batchResultShape>;

// #endregion

// #region Responses

/**
 * Account's failures, where the server's refusal of an administration operation is `noAccess`
 * and a change that needs a multi-factor session is `strongRequired`.
 */
export const administrationFailures = [
	'unavailable',
	'sessionEnded',
	'reauthenticationRequired',
	'strongRequired',
	'noAccess',
	'denied',
	'notFound',
	'unconfirmed',
	'conflict',
	'invalid',
	'cancelled',
	/** The preview is past its commit deadline; a new preview is needed. */
	'expired',
	/** The person can no longer see what the preview's filter selects, so it can't be used. */
	'accessChanged'
] as const;
export type AdministrationFailure = (typeof administrationFailures)[number];

export type AdministrationResponse =
	| { readonly kind: 'data'; readonly data: AdministrationData }
	| { readonly kind: 'success' }
	/** A change created a resource or started a job; reads present it. */
	| { readonly kind: 'created'; readonly id: string }
	| { readonly kind: 'batchResult'; readonly result: AdministrationBatchResult }
	| {
			readonly kind: 'error';
			readonly reason: AdministrationFailure;
			/** For `invalid`: the request fields the server named, never its messages. */
			readonly fields?: readonly string[];
	  };

export interface AdministrationClient extends ObservableCapability<
	AdministrationIntent,
	AdministrationResponse
> {
	request(intent: AdministrationIntent): Promise<AdministrationResponse>;
}

const fieldName = /^[A-Za-z0-9_.[\]-]{1,128}$/u;
export function validateAdministrationResponse(value: unknown): AdministrationResponse {
	const input = projectionRecord(value);
	const keys = Object.keys(input).sort().join();
	if (input.kind === 'success' && keys === 'kind') return Object.freeze({ kind: 'success' });
	if (input.kind === 'created' && keys === 'id,kind')
		return Object.freeze({ kind: 'created', id: projectionId(input.id) });
	if (input.kind === 'batchResult' && keys === 'kind,result')
		return Object.freeze({
			kind: 'batchResult',
			result: readShape(batchResultShape, input.result) as AdministrationBatchResult
		});
	if (input.kind === 'error' && (keys === 'kind,reason' || keys === 'fields,kind,reason')) {
		const reason = projectionMember(input.reason, administrationFailures);
		if (input.fields === undefined) return Object.freeze({ kind: 'error', reason });
		const fields = projectionList(input.fields, 32).map((field) => {
			if (typeof field !== 'string' || !fieldName.test(field))
				throw new TypeError('Invalid administration field name');
			return field;
		});
		return Object.freeze({ kind: 'error', reason, fields: Object.freeze(fields) });
	}
	if (input.kind !== 'data' || keys !== 'data,kind')
		throw new TypeError('Invalid administration response');
	const data = projectionRecord(input.data);
	const resource = data.resource;
	if (
		typeof resource !== 'string' ||
		!Object.hasOwn(administrationResources, resource) ||
		Object.keys(data).sort().join() !== 'resource,value'
	)
		throw new TypeError('Invalid administration resource');
	const shape: Shape = administrationResources[resource as AdministrationResource];
	const result = readShape(shape, data.value);
	if (Array.isArray(result.items)) {
		const ids = (result.items as readonly Record<string, unknown>[])
			.map((item) => item.id)
			.filter((id) => id !== undefined);
		if (new Set(ids).size !== ids.length)
			throw new TypeError('Ambiguous administration resource list');
	}
	return Object.freeze({
		kind: 'data',
		data: Object.freeze({ resource, value: result }) as AdministrationData
	});
}

// #endregion
