/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from 'node:crypto';
import type { AccountFailure } from '../../account/common/accountProtocol.js';
import {
	ServerApiError,
	type ApiInput,
	type ApiOperationId,
	type ApiResponse
} from '../../serverApi/common/serverApi.js';
import type { components } from '../../serverApi/common/serverApi.generated.js';
import { combinedDisposable, type IDisposable } from '../../../base/common/lifecycle.js';
import type { SessionBinding } from '../../serverApi/common/projection.js';
import { operationContract } from '../../serverApi/node/serverContract.js';
import type { ServerEventSubscription } from '../../serverApi/common/serverEvents.js';
import type { SessionApi } from '../../serverApi/node/sessionApi.js';
import {
	isAdministrationRead,
	validateAdministrationIntent,
	validateAdministrationResponse,
	type AdministrationChangeIntent,
	type AdministrationFailure,
	type AdministrationIntent,
	type AdministrationIntentOf,
	type AdministrationReadIntent,
	type AdministrationResponse
} from '../common/administrationProtocol.js';
import * as wire from './administrationWire.js';

type AuditAction = components['schemas']['AuditAction'];
type ResourceType = components['schemas']['ResourceType'];

export type AdministrationApi = Pick<SessionApi, 'request' | 'reads' | 'events'>;

/** What the Session owner lends Administration; credentials and refresh never leave it. */
export interface AdministrationSessionPort {
	/** The typed client of the bound Session; throws `sessionEnded` once it is not current. */
	apiForSession(binding: SessionBinding): AdministrationApi;
	/** The Institution the bound Session belongs to. */
	institutionId(binding: SessionBinding): string;
	/** Confirm it's you in the system browser; ends when the browser step completes or fails. */
	reauthenticate(binding: SessionBinding): Promise<'success' | AccountFailure>;
	cancelReauthentication(binding: SessionBinding): void;
}

/**
 * Every server operation Administration may send. A route outside this set is refused before
 * anything is sent, so a mistaken table entry can never reach another product capability.
 */
export const administrationOperations: ReadonlySet<ApiOperationId> = new Set<ApiOperationId>([
	'searchUsers',
	'getUserProfile',
	'getUserProfilePicture',
	'uploadUserProfilePicture',
	'removeUserProfilePicture',
	'runAcademicAdministrationBatch',
	'getAdministrationCounts',
	'listOnboardingImports',
	'listStudentProgressions',
	'getStudentProgression',
	'dryRunStudentProgression',
	'cancelStudentProgression',
	'commitStudentProgression',
	'listAcademicUnitMembers',
	'createAcademicUnitMember',
	'endAcademicUnitMember',
	'listJobAttempts',
	'getMailDelivery',
	'updateUserProfile',
	'disableUser',
	'enableUser',
	'listUserSessions',
	'revokeUserSessions',
	'revokeUserSession',
	'resetUserMFA',
	'changeUserEmail',
	'verifyUserEmailPrivileged',
	'listAffiliations',
	'createAffiliation',
	'endAffiliation',
	'listInvitations',
	'getInvitation',
	'issueInstitutionRoleInvitation',
	'issueAcademicUnitRoleInvitation',
	'issueTeacherAcademicUnitInvitation',
	'issueStudentClassInvitation',
	'runInvitationBatch',
	'replaceInvitation',
	'resendInvitation',
	'revokeInvitation',
	'uploadOnboardingImport',
	'getOnboardingImport',
	'cancelOnboardingImport',
	'commitOnboardingImport',
	'getInstitution',
	'updateInstitution',
	'listAcademicUnits',
	'createRootAcademicUnit',
	'createAcademicUnitChild',
	'listAcademicUnitChildren',
	'updateAcademicUnit',
	'archiveAcademicUnit',
	'searchClasses',
	'listProgrammes',
	'createProgramme',
	'updateProgramme',
	'archiveProgramme',
	'listProgrammeLevels',
	'createProgrammeLevel',
	'updateProgrammeLevel',
	'archiveProgrammeLevel',
	'listClasses',
	'createClass',
	'getClass',
	'updateClass',
	'archiveClass',
	'listClassMembers',
	'enrollClassMember',
	'endClassMember',
	'listAcademicPeriods',
	'createAcademicPeriod',
	'updateAcademicPeriod',
	'archiveAcademicPeriod',
	'listRoles',
	'createRole',
	'updateRole',
	'deleteRole',
	'listRoleBindings',
	'createRoleBinding',
	'endRoleBinding',
	'getAccessPolicy',
	'preflightAccessPolicy',
	'replaceAccessPolicy',
	'getDesktopCompatibilityPolicy',
	'replaceDesktopCompatibilityPolicy',
	'listAuditEvents',
	'getRetentionPolicy',
	'replaceRetentionPolicy',
	'getRetentionControl',
	'changeRetentionControl',
	'createRetentionPreview',
	'getRetentionPreview',
	'listRetentionRecords',
	'listJobs',
	'getJob',
	'cancelJob',
	'retryJob',
	'listMailDeliveries',
	'getMailMetrics',
	'cancelMailDelivery',
	'retryMailDelivery',
	'sendControlledTestMail',
	'inspectMailKeyState',
	'startMailRekey',
	'getMailRekeyStatus',
	'inspectMFAKeyState',
	'startMFARekey',
	'getMFARekeyStatus'
]);

/** Refuses any operation outside {@link administrationOperations} before it is sent. */
export function guardAdministrationApi(
	api: Pick<SessionApi, 'request'>
): Pick<SessionApi, 'request'> {
	return {
		request: (operation, input, options) => {
			if (!administrationOperations.has(operation))
				return Promise.reject(new ServerApiError('invalidRequest'));
			return api.request(operation, input, options);
		}
	};
}

/** Whether the contract has the server deduplicate the operation by an `Idempotency-Key`. */
export function requiresIdempotencyKey(operation: ApiOperationId): boolean {
	return operationContract(operation).idempotency === 'required';
}

// #region Routes

type RoutedKind = Exclude<
	AdministrationIntent['kind'],
	'reauthenticate' | 'cancelReauthentication'
>;
type Success<K extends ApiOperationId> = Extract<
	ApiResponse<K>,
	{ readonly status: 200 | 201 | 202 | 204 }
>['value'];
interface Route<I extends RoutedKind> {
	readonly operation: ApiOperationId;
	call(
		api: Pick<SessionApi, 'request'>,
		intent: AdministrationIntentOf<I>,
		idempotencyKey: string,
		signal?: AbortSignal
	): Promise<AdministrationResponse>;
}
function route<I extends RoutedKind, K extends ApiOperationId>(
	operation: K,
	input: (intent: AdministrationIntentOf<I>, idempotencyKey: string) => ApiInput<K>,
	project: (
		value: Success<K>,
		intent: AdministrationIntentOf<I>,
		headers: Readonly<Record<string, string>>
	) => AdministrationResponse
): Route<I> {
	return {
		operation,
		async call(api, intent, idempotencyKey, signal) {
			const result = await api.request(operation, input(intent, idempotencyKey), {
				signal
			});
			return project(result.value as Success<K>, intent, result.headers ?? {});
		}
	};
}

const success = (): AdministrationResponse => ({ kind: 'success' });
const created = (id: string): AdministrationResponse =>
	validateAdministrationResponse({ kind: 'created', id });
const iso = (value: number | undefined): string | undefined =>
	value === undefined ? undefined : new Date(value).toISOString();
/** A request body without the fields the intent left out. */
function body<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
const page = (intent: { readonly limit: number; readonly cursor?: string }) => ({
	limit: intent.limit,
	cursor: intent.cursor
});
const key = (idempotencyKey: string) => ({ 'Idempotency-Key': idempotencyKey });
const period = (intent: { readonly startAt?: number; readonly endAt?: number }) => ({
	start_at: iso(intent.startAt),
	end_at: iso(intent.endAt)
});
const expiry = (intent: { readonly expiresInDays?: number }) => ({
	expires_in_days: intent.expiresInDays
});
const naming = (intent: {
	readonly name?: string;
	readonly displayName?: string;
	readonly description?: string;
}) => ({ name: intent.name, display_name: intent.displayName, description: intent.description });
const accessSettings = (intent: Omit<AdministrationIntentOf<'replaceAccessPolicy'>, 'kind'>) => ({
	expected_revision: intent.expectedRevision,
	local_login_enabled: intent.localLogin,
	public_registration_enabled: intent.publicRegistration,
	invitation_admission_enabled: intent.invitationAdmission,
	invitation_local_credential_enabled: intent.invitationLocalCredential,
	desktop_authorization_enabled: intent.desktopAuthorization,
	provider_admissions: Object.fromEntries(
		intent.providerAdmissions.map((admission) => [admission.providerId, admission.mode])
	),
	role_holder_mfa_required: intent.roleHolderMfaRequired,
	session_idle_minutes: intent.sessionIdleMinutes ?? null,
	session_absolute_minutes: intent.sessionAbsoluteMinutes ?? null,
	revoke_existing_sessions: intent.revokeExistingSessions
});

const routes: { readonly [I in RoutedKind]: Route<I> } = {
	// Users
	users: route(
		'searchUsers',
		(i) => ({
			query: {
				...page(i),
				q: i.q,
				include_disabled: i.includeDisabled,
				affiliation: i.affiliation && [...i.affiliation],
				academic_unit_id: i.academicUnitId
			}
		}),
		(v) => wire.projectPage('users', v, wire.userEntry)
	),
	userPhoto: route(
		'getUserProfilePicture',
		(i) => ({ path: { user_id: i.userId }, query: { size: 256 as const } }),
		(v, _i, headers) => wire.userPhoto(v, headers.etag)
	),
	replaceUserPhoto: route(
		'uploadUserProfilePicture',
		(i) => ({
			path: { user_id: i.userId },
			...(i.etag === undefined ? {} : { header: { 'If-Match': i.etag } }),
			body: i.image,
			mediaType: i.mediaType
		}),
		success
	),
	removeUserPhoto: route(
		'removeUserProfilePicture',
		(i) => ({ path: { user_id: i.userId }, header: { 'If-Match': i.etag } }),
		success
	),
	runAcademicBatch: route(
		'runAcademicAdministrationBatch',
		(i, k) => ({
			header: key(k),
			body: {
				operation: i.operation,
				scope_type: i.scopeType,
				scope_id: i.scopeId,
				items: i.items.map((item) =>
					body({
						key: item.key,
						user_id: item.userId,
						relationship_id: item.relationshipId,
						role_id: item.roleId,
						affiliation_kind: item.affiliationKind,
						...period(item)
					})
				)
			}
		}),
		(v) => wire.academicBatch(v)
	),
	user: route(
		'getUserProfile',
		(i) => ({ path: { user_id: i.id } }),
		(v) => wire.projectData('user', wire.user(v))
	),
	userSessions: route(
		'listUserSessions',
		(i) => ({
			path: { user_id: i.userId },
			query: { ...page(i), include_revoked: i.includeRevoked }
		}),
		(v) => wire.projectPage('userSessions', v, wire.userSession)
	),
	affiliations: route(
		'listAffiliations',
		(i) => ({ path: { user_id: i.userId }, query: page(i) }),
		(v) => wire.projectPage('affiliations', v, wire.affiliation)
	),
	updateUser: route(
		'updateUserProfile',
		(i) => ({
			path: { user_id: i.id },
			body: body({
				username: i.username,
				display_name: i.displayName,
				first_name: i.firstName,
				last_name: i.lastName,
				locale: i.locale,
				timezone: i.timezone
			})
		}),
		success
	),
	disableUser: route(
		'disableUser',
		(i) => ({ path: { user_id: i.id }, body: { reason: i.reason ?? '' } }),
		success
	),
	enableUser: route('enableUser', (i) => ({ path: { user_id: i.id } }), success),
	revokeUserSessions: route(
		'revokeUserSessions',
		(i) => ({ path: { user_id: i.userId } }),
		success
	),
	revokeUserSession: route(
		'revokeUserSession',
		(i) => ({ path: { user_id: i.userId, session_id: i.sessionId } }),
		success
	),
	resetUserMfa: route(
		'resetUserMFA',
		(i) => ({
			path: { user_id: i.userId },
			body: {
				identity_verified: i.identityVerified,
				reason: i.reason,
				verification_reference: i.verificationReference
			}
		}),
		success
	),
	changeUserEmail: route(
		'changeUserEmail',
		(i) => ({ path: { user_id: i.userId }, body: { email: i.email } }),
		success
	),
	verifyUserEmail: route(
		'verifyUserEmailPrivileged',
		(i) => ({ path: { user_id: i.userId } }),
		success
	),
	createAffiliation: route(
		'createAffiliation',
		(i) => ({ path: { user_id: i.userId }, body: body({ kind: i.affiliation, ...period(i) }) }),
		(v) => created(v.id)
	),
	endAffiliation: route('endAffiliation', (i) => ({ path: { affiliation_id: i.id } }), success),
	// Invitations and onboarding imports
	invitations: route(
		'listInvitations',
		(i) => ({
			query: {
				...page(i),
				purpose: i.purpose,
				state: i.state,
				email: i.email,
				target_id: i.targetId
			}
		}),
		(v) => wire.projectPage('invitations', v, wire.invitation)
	),
	invitation: route(
		'getInvitation',
		(i) => ({ path: { invitation_id: i.id } }),
		(v) => wire.projectData('invitation', wire.invitation(v))
	),
	inviteToInstitution: route(
		'issueInstitutionRoleInvitation',
		(i) => ({
			path: { institution_id: i.institutionId },
			body: body({ email: i.email, role_id: i.roleId, ...period(i), ...expiry(i) })
		}),
		(v) => created(v.id)
	),
	inviteToUnit: route(
		'issueAcademicUnitRoleInvitation',
		(i) => ({
			path: { academic_unit_id: i.unitId },
			body: body({ email: i.email, role_id: i.roleId, ...period(i), ...expiry(i) })
		}),
		(v) => created(v.id)
	),
	inviteTeacher: route(
		'issueTeacherAcademicUnitInvitation',
		(i) => ({
			path: { academic_unit_id: i.unitId },
			body: body({ email: i.email, role_id: i.roleId, ...period(i), ...expiry(i) })
		}),
		(v) => created(v.id)
	),
	inviteStudent: route(
		'issueStudentClassInvitation',
		(i) => ({
			path: { class_id: i.classId },
			body: body({ email: i.email, ...period(i), ...expiry(i) })
		}),
		(v) => created(v.id)
	),
	runInvitationBatch: route(
		'runInvitationBatch',
		(i, k) => ({
			header: key(k),
			body: {
				operation: i.operation,
				scope_type: i.scopeType,
				scope_id: i.scopeId,
				items: i.items.map((item) =>
					body({
						key: item.key,
						email: item.email,
						role_id: item.roleId,
						invitation_id: item.invitationId,
						expected_revision: item.expectedRevision,
						...period(item),
						...expiry(item)
					})
				)
			}
		}),
		(v) => wire.invitationBatch(v)
	),
	replaceInvitation: route(
		'replaceInvitation',
		(i) => ({
			path: { invitation_id: i.id },
			body: body({
				expected_revision: i.expectedRevision,
				purpose: i.purpose,
				email: i.email,
				role_id: i.roleId,
				institution_id: i.institutionId,
				academic_unit_id: i.academicUnitId,
				class_id: i.classId,
				...period(i),
				...expiry(i)
			})
		}),
		(v) => created(v.id)
	),
	resendInvitation: route(
		'resendInvitation',
		(i) => ({
			path: { invitation_id: i.id },
			body: { expected_revision: i.expectedRevision }
		}),
		success
	),
	revokeInvitation: route(
		'revokeInvitation',
		(i) => ({
			path: { invitation_id: i.id },
			body: { expected_revision: i.expectedRevision }
		}),
		success
	),
	onboardingImports: route(
		'listOnboardingImports',
		(i) => ({ query: { ...page(i), state: i.state && [...i.state] } }),
		(v) => wire.projectPage('onboardingImports', v, wire.importSummary)
	),
	studentProgressions: route(
		'listStudentProgressions',
		(i) => ({
			query: {
				...page(i),
				state: i.state && [...i.state],
				source_class_id: i.sourceClassId,
				destination_class_id: i.destinationClassId
			}
		}),
		(v) => wire.projectPage('studentProgressions', v, wire.importSummary)
	),
	studentProgression: route(
		'getStudentProgression',
		(i) => ({ path: { student_progression_id: i.id } }),
		(v) => wire.projectData('studentProgression', wire.onboardingImport(v))
	),
	checkProgression: route(
		'dryRunStudentProgression',
		(i) => ({
			body: {
				source_period_id: i.sourcePeriodId,
				source_class_id: i.sourceClassId,
				destination_period_id: i.destinationPeriodId,
				destination_class_id: i.destinationClassId,
				effective_at: iso(i.effectiveAt)!
			}
		}),
		(v) => created(v.id)
	),
	cancelProgression: route(
		'cancelStudentProgression',
		(i) => ({ path: { student_progression_id: i.id } }),
		success
	),
	commitProgression: route(
		'commitStudentProgression',
		(i, k) => ({
			path: { student_progression_id: i.id },
			header: key(k),
			body: { expected_revision: i.expectedRevision, preview_digest: i.previewDigest }
		}),
		success
	),
	onboardingImport: route(
		'getOnboardingImport',
		(i) => ({ path: { onboarding_import_id: i.id } }),
		(v) => wire.projectData('onboardingImport', wire.onboardingImport(v))
	),
	uploadImport: route(
		'uploadOnboardingImport',
		(i) => ({
			query: {
				mode: i.mode,
				scope_type: i.scopeType,
				scope_id: i.scopeId,
				role_id: i.roleId,
				file_name: i.fileName
			},
			body: i.csv,
			mediaType: 'text/csv'
		}),
		(v) => created(v.id)
	),
	cancelImport: route(
		'cancelOnboardingImport',
		(i) => ({ path: { onboarding_import_id: i.id } }),
		success
	),
	commitImport: route(
		'commitOnboardingImport',
		(i, k) => ({
			path: { onboarding_import_id: i.id },
			header: key(k),
			body: {
				expected_revision: i.expectedRevision,
				policy: i.policy,
				preview_digest: i.previewDigest
			}
		}),
		success
	),
	// Academic structure
	institution: route(
		'getInstitution',
		() => ({}),
		(v) => wire.projectData('institution', wire.institution(v))
	),
	updateInstitution: route('updateInstitution', (i) => ({ body: body(naming(i)) }), success),
	academicUnits: route(
		'listAcademicUnits',
		(i) => ({ query: { ...page(i), q: i.q } }),
		(v) => wire.projectPage('academicUnits', v, wire.academicUnit)
	),
	unitChildren: route(
		'listAcademicUnitChildren',
		(i) => ({ path: { academic_unit_id: i.unitId }, query: page(i) }),
		(v) => wire.projectPage('unitChildren', v, wire.academicUnit)
	),
	createRootUnit: route(
		'createRootAcademicUnit',
		(i) => ({ body: body({ ...naming(i), name: i.name, display_name: i.displayName }) }),
		(v) => created(v.id)
	),
	createChildUnit: route(
		'createAcademicUnitChild',
		(i) => ({
			path: { academic_unit_id: i.parentId },
			body: body({ ...naming(i), name: i.name, display_name: i.displayName })
		}),
		(v) => created(v.id)
	),
	updateUnit: route(
		'updateAcademicUnit',
		(i) => ({
			path: { academic_unit_id: i.id },
			body: body({
				expected_revision: i.expectedRevision,
				...naming(i),
				parent_id: i.parentId
			})
		}),
		success
	),
	archiveUnit: route(
		'archiveAcademicUnit',
		(i) => ({
			path: { academic_unit_id: i.id },
			body: { expected_revision: i.expectedRevision }
		}),
		success
	),
	unitProgrammes: route(
		'listProgrammes',
		(i) => ({ path: { academic_unit_id: i.unitId }, query: { ...page(i), q: i.q } }),
		(v) => wire.projectPage('unitProgrammes', v, wire.programme)
	),
	createProgramme: route(
		'createProgramme',
		(i) => ({
			path: { academic_unit_id: i.unitId },
			body: body({ ...naming(i), name: i.name, display_name: i.displayName })
		}),
		(v) => created(v.id)
	),
	updateProgramme: route(
		'updateProgramme',
		(i) => ({
			path: { programme_id: i.id },
			body: body({ expected_revision: i.expectedRevision, ...naming(i) })
		}),
		success
	),
	archiveProgramme: route(
		'archiveProgramme',
		(i) => ({
			path: { programme_id: i.id },
			body: { expected_revision: i.expectedRevision }
		}),
		success
	),
	programmeLevels: route(
		'listProgrammeLevels',
		(i) => ({ path: { programme_id: i.programmeId }, query: { ...page(i), q: i.q } }),
		(v) => wire.projectPage('programmeLevels', v, wire.programmeLevel)
	),
	createLevel: route(
		'createProgrammeLevel',
		(i) => ({
			path: { programme_id: i.programmeId },
			body: body({ ...naming(i), name: i.name, display_name: i.displayName })
		}),
		(v) => created(v.id)
	),
	updateLevel: route(
		'updateProgrammeLevel',
		(i) => ({
			path: { programme_level_id: i.id },
			body: body({ expected_revision: i.expectedRevision, ...naming(i) })
		}),
		success
	),
	archiveLevel: route(
		'archiveProgrammeLevel',
		(i) => ({
			path: { programme_level_id: i.id },
			body: { expected_revision: i.expectedRevision }
		}),
		success
	),
	unitClasses: route(
		'searchClasses',
		(i) => ({ path: { academic_unit_id: i.unitId }, query: { ...page(i), q: i.q } }),
		(v) => wire.projectPage('unitClasses', v, wire.classOf)
	),
	levelClasses: route(
		'listClasses',
		(i) => ({ path: { programme_level_id: i.levelId }, query: page(i) }),
		(v) => wire.projectPage('levelClasses', v, wire.classOf)
	),
	class: route(
		'getClass',
		(i) => ({ path: { class_id: i.id } }),
		(v) => wire.projectData('class', wire.classOf(v))
	),
	createClass: route(
		'createClass',
		(i) => ({
			path: { programme_level_id: i.levelId },
			body: body({
				...naming(i),
				name: i.name,
				display_name: i.displayName,
				academic_period_id: i.academicPeriodId
			})
		}),
		(v) => created(v.id)
	),
	updateClass: route(
		'updateClass',
		(i) => ({
			path: { class_id: i.id },
			body: body({
				expected_revision: i.expectedRevision,
				...naming(i),
				academic_period_id: i.academicPeriodId,
				programme_level_id: i.levelId
			})
		}),
		success
	),
	archiveClass: route(
		'archiveClass',
		(i) => ({ path: { class_id: i.id }, body: { expected_revision: i.expectedRevision } }),
		success
	),
	unitMembers: route(
		'listAcademicUnitMembers',
		(i) => ({
			path: { academic_unit_id: i.unitId },
			query: { ...page(i), history: i.history }
		}),
		(v) => wire.projectPage('unitMembers', v, wire.unitMember)
	),
	addUnitMember: route(
		'createAcademicUnitMember',
		(i) => ({
			path: { academic_unit_id: i.unitId },
			body: body({ user_id: i.userId, start_at: iso(i.startAt) })
		}),
		(v) => created(v.id)
	),
	endUnitMember: route(
		'endAcademicUnitMember',
		(i) => ({ path: { academic_unit_member_id: i.id } }),
		success
	),
	classMembers: route(
		'listClassMembers',
		(i) => ({ path: { class_id: i.classId }, query: { ...page(i), history: i.history } }),
		(v) => wire.projectPage('classMembers', v, wire.classMember)
	),
	enrollClassMember: route(
		'enrollClassMember',
		(i) => ({
			path: { class_id: i.classId },
			body: body({ user_id: i.userId, ...period(i) })
		}),
		(v) => created(v.membership.id)
	),
	endClassMember: route('endClassMember', (i) => ({ path: { class_member_id: i.id } }), success),
	academicPeriods: route(
		'listAcademicPeriods',
		(i) => ({ query: { ...page(i), q: i.q } }),
		(v) => wire.projectPage('academicPeriods', v, wire.academicPeriod)
	),
	createAcademicPeriod: route(
		'createAcademicPeriod',
		(i) => ({
			body: body({
				...naming(i),
				name: i.name,
				display_name: i.displayName,
				owner_type: i.ownerType,
				owner_id: i.ownerId,
				start_at: iso(i.startAt)!,
				end_at: iso(i.endAt)!
			})
		}),
		(v) => created(v.id)
	),
	updateAcademicPeriod: route(
		'updateAcademicPeriod',
		(i) => ({
			path: { academic_period_id: i.id },
			body: body({ expected_revision: i.expectedRevision, ...naming(i), ...period(i) })
		}),
		success
	),
	archiveAcademicPeriod: route(
		'archiveAcademicPeriod',
		(i) => ({
			path: { academic_period_id: i.id },
			body: { expected_revision: i.expectedRevision }
		}),
		success
	),
	// Roles and role bindings
	roles: route(
		'listRoles',
		(i) => ({ query: page(i) }),
		(v) => wire.projectPage('roles', v, wire.role)
	),
	createRole: route(
		'createRole',
		(i) => ({
			body: body({
				...naming(i),
				name: i.name,
				display_name: i.displayName,
				permissions: [...i.permissions]
			})
		}),
		(v) => created(v.id)
	),
	updateRole: route(
		'updateRole',
		(i) => ({
			path: { role_id: i.id },
			body: body({
				display_name: i.displayName,
				description: i.description,
				permissions: i.permissions && [...i.permissions]
			})
		}),
		success
	),
	deleteRole: route('deleteRole', (i) => ({ path: { role_id: i.id } }), success),
	roleBindings: route(
		'listRoleBindings',
		(i) => ({
			query: {
				...page(i),
				user_id: i.userId,
				scope_type: i.scopeType,
				scope_id: i.scopeId
			}
		}),
		(v) => wire.projectPage('roleBindings', v, wire.roleBinding)
	),
	createRoleBinding: route(
		'createRoleBinding',
		(i) => ({
			body: body({
				role_id: i.roleId,
				user_id: i.userId,
				scope_type: i.scopeType,
				scope_id: i.scopeId,
				...period(i)
			})
		}),
		(v) => created(v.id)
	),
	endRoleBinding: route('endRoleBinding', (i) => ({ path: { role_binding_id: i.id } }), success),
	// Access policy and Desktop compatibility
	accessPolicy: route(
		'getAccessPolicy',
		() => ({}),
		(v) => wire.projectData('accessPolicy', wire.accessPolicy(v))
	),
	preflightAccessPolicy: route(
		'preflightAccessPolicy',
		(i) => ({ body: accessSettings(i) }),
		(v) => wire.projectData('accessPolicyPreflight', wire.accessPolicyPreflight(v))
	),
	replaceAccessPolicy: route(
		'replaceAccessPolicy',
		(i, k) => ({ header: key(k), body: accessSettings(i) }),
		success
	),
	desktopCompatibility: route(
		'getDesktopCompatibilityPolicy',
		() => ({}),
		(v) => wire.projectData('desktopCompatibility', wire.desktopCompatibility(v))
	),
	replaceDesktopCompatibility: route(
		'replaceDesktopCompatibilityPolicy',
		(i, k) => ({
			header: key(k),
			body: body({
				expected_revision: i.expectedRevision,
				availability: i.availability,
				minimum_desktop_release: i.minimumRelease,
				administrator_message: i.message,
				retry_at: iso(i.retryAt),
				revoked_desktop_build_ids: [...i.revokedBuildIds]
			})
		}),
		success
	),
	// Audits
	audits: route(
		'listAuditEvents',
		(i) => ({
			query: {
				...page(i),
				actor_id: i.actorId,
				// The contract's request validation refuses a name outside its catalogue.
				action: i.action === undefined ? undefined : [i.action as AuditAction],
				resource_type: i.resourceType as ResourceType | undefined,
				resource_id: i.resourceId,
				created_after: iso(i.createdAfter),
				created_before: iso(i.createdBefore)
			}
		}),
		(v) => wire.projectPage('audits', v, wire.audit)
	),
	// Retention
	retentionPolicy: route(
		'getRetentionPolicy',
		() => ({}),
		(v) => wire.projectData('retentionPolicy', wire.retentionPolicy(v))
	),
	replaceRetentionPolicy: route(
		'replaceRetentionPolicy',
		(i, k) => ({
			header: key(k),
			body: body({
				expected_revision: i.expectedRevision,
				audit_retention_days: i.auditDays,
				browser_activity_retention_days: i.browserActivityDays,
				deletion_grace_days: i.deletionGraceDays,
				export_retention_days: i.exportDays,
				integrity_retention_days: i.integrityDays,
				security_operational_retention_days: i.securityOperationalDays,
				submission_retention_days: i.submissionDays,
				candidate_notices: i.candidateNotices
			})
		}),
		success
	),
	retentionControl: route(
		'getRetentionControl',
		() => ({}),
		(v) => wire.projectData('retentionControl', wire.retentionControl(v))
	),
	changeRetentionControl: route(
		'changeRetentionControl',
		(i, k) => ({
			header: key(k),
			body: body({
				expected_revision: i.expectedRevision,
				expected_policy_revision: i.expectedPolicyRevision,
				state: i.state,
				preview_id: i.previewId
			})
		}),
		success
	),
	createRetentionPreview: route(
		'createRetentionPreview',
		(i, k) => ({ header: key(k), body: { expected_revision: i.expectedRevision } }),
		(v) => created(v.id)
	),
	retentionPreview: route(
		'getRetentionPreview',
		(i) => ({ path: { retention_preview_id: i.id } }),
		(v) => wire.projectData('retentionPreview', wire.retentionPreview(v))
	),
	retentionRecords: route(
		'listRetentionRecords',
		(i) => ({ query: page(i) }),
		(v) => wire.retentionRecords(v)
	),
	// Jobs
	jobs: route(
		'listJobs',
		(i) => ({ query: { ...page(i), status: i.status && [...i.status] } }),
		(v) => wire.projectPage('jobs', v, wire.job)
	),
	job: route(
		'getJob',
		(i) => ({ path: { job_id: i.id } }),
		(v) => wire.projectData('job', wire.job(v))
	),
	jobAttempts: route(
		'listJobAttempts',
		(i) => ({ path: { job_id: i.jobId }, query: page(i) }),
		(v) => wire.projectPage('jobAttempts', v, wire.jobAttempt)
	),
	cancelJob: route('cancelJob', (i) => ({ path: { job_id: i.id } }), success),
	retryJob: route('retryJob', (i) => ({ path: { job_id: i.id } }), success),
	// Mail and MFA keys
	mailDeliveries: route(
		'listMailDeliveries',
		(i) => ({ query: { ...page(i), state: i.state && [...i.state] } }),
		(v) => wire.projectPage('mailDeliveries', v, wire.mailDelivery)
	),
	mailDelivery: route(
		'getMailDelivery',
		(i) => ({ path: { mail_delivery_id: i.id } }),
		(v) => wire.projectData('mailDelivery', wire.mailDeliveryDetail(v))
	),
	counts: route(
		'getAdministrationCounts',
		() => ({}),
		(v) => wire.projectData('counts', wire.administrationCounts(v))
	),
	mailMetrics: route(
		'getMailMetrics',
		() => ({}),
		(v) => wire.projectData('mailMetrics', wire.mailMetrics(v))
	),
	cancelMailDelivery: route(
		'cancelMailDelivery',
		(i) => ({ path: { mail_delivery_id: i.id } }),
		success
	),
	retryMailDelivery: route(
		'retryMailDelivery',
		(i) => ({ path: { mail_delivery_id: i.id } }),
		success
	),
	sendTestMail: route(
		'sendControlledTestMail',
		() => ({}),
		(v) => created(v.id)
	),
	mailKeys: route(
		'inspectMailKeyState',
		() => ({}),
		(v) => wire.projectData('mailKeys', wire.mailKeys(v))
	),
	startMailRekey: route(
		'startMailRekey',
		(i) => ({ body: { retiring_key_id: i.retiringKeyId } }),
		(v) => created(v.job_id)
	),
	mailRekey: route(
		'getMailRekeyStatus',
		(i) => ({ path: { job_id: i.jobId } }),
		(v) => wire.projectData('mailRekey', wire.rekey(v))
	),
	mfaKeys: route(
		'inspectMFAKeyState',
		() => ({}),
		(v) => wire.projectData('mfaKeys', wire.mfaKeys(v))
	),
	startMfaRekey: route(
		'startMFARekey',
		(i) => ({ body: { retiring_key_id: i.retiringKeyId } }),
		(v) => created(v.job_id)
	),
	mfaRekey: route(
		'getMFARekeyStatus',
		(i) => ({ path: { job_id: i.jobId } }),
		(v) => wire.projectData('mfaRekey', wire.rekey(v))
	)
};

/** The operation a routed intent sends; for tests and diagnostics. */
export function administrationOperationOf(kind: RoutedKind): ApiOperationId {
	return routes[kind].operation;
}

// #endregion

const failureFields = /^[A-Za-z0-9_.[\]-]{1,128}$/u;
/** Reads that name one collection; the server hides a collection it will not show with 404. */
const collections = new Set<AdministrationIntent['kind']>([
	'users',
	'userSessions',
	'affiliations',
	'invitations',
	'academicUnits',
	'unitChildren',
	'unitClasses',
	'unitProgrammes',
	'programmeLevels',
	'levelClasses',
	'classMembers',
	'unitMembers',
	'onboardingImports',
	'studentProgressions',
	'jobAttempts',
	'academicPeriods',
	'roles',
	'roleBindings',
	'audits',
	'retentionRecords',
	'jobs',
	'mailDeliveries'
]);

/** How often a page with no server event is re-read. */
const POLL_MS = 60_000;
/** How often a page its server event keeps current is re-read anyway. */
const SAFETY_POLL_MS = 300_000;

/**
 * The privileged Administration capability. Every intent becomes one allow-listed operation on
 * the bound Session's typed client; replies are whitelist projections, and failures are closed
 * reasons. One change runs at a time.
 */
export class AdministrationService {
	#changing = false;
	#disposed = false;
	constructor(private readonly session: AdministrationSessionPort) {}

	async administration(
		binding: SessionBinding,
		raw: AdministrationIntent
	): Promise<AdministrationResponse> {
		const intent = validateAdministrationIntent(raw);
		if (!isAdministrationRead(intent)) return this.#change(binding, intent);
		try {
			return await this.#api(binding).reads.read(['administration', intent], (signal) =>
				this.#read(binding, intent, signal)
			);
		} catch (error) {
			return this.#failure(error, intent);
		}
	}

	observeAdministration(
		binding: SessionBinding,
		raw: AdministrationIntent,
		listener: (response: AdministrationResponse) => void
	): IDisposable {
		const intent = validateAdministrationIntent(raw);
		if (!isAdministrationRead(intent)) throw new ServerApiError('invalidRequest');
		const api = this.#api(binding);
		const key = ['administration', intent] as const;
		const refresh = () => api.reads.refresh(key);
		const changes = this.#subscribeChanges(binding, intent.kind, refresh);
		// Events are best-effort after commit, so a page they cover is still re-read now and then;
		// a page with no event, or whose subscription the server refuses, is polled.
		const observation = api.reads.observe(
			key,
			(signal) => this.#read(binding, intent, signal),
			(state) => {
				if (state.error) listener(this.#failure(state.error, intent));
				else if (state.value) listener(state.value);
			},
			{ pollIntervalMs: changes ? SAFETY_POLL_MS : POLL_MS }
		);
		if (!changes) {
			// Invitations announce only the ones you issued, so the page is still polled.
			if (intent.kind !== 'invitations' && intent.kind !== 'invitation') return observation;
			return combinedDisposable(
				observation,
				api.events.on('invitation.changed', undefined, refresh)
			);
		}
		let fallback: ReturnType<typeof setInterval> | undefined;
		let disposed = false;
		void changes.accepted.then((accepted) => {
			if (!accepted && !disposed) fallback = setInterval(refresh, POLL_MS);
		});
		return combinedDisposable(observation, changes, {
			dispose: () => {
				disposed = true;
				clearInterval(fallback);
			}
		});
	}

	/**
	 * Subscribes to the server event that reports changes to a page, when there is one. Jobs,
	 * imports and the Access Policy are subscribed to on the Institution; a viewer the server
	 * doesn't let see them there is refused, and the page falls back to polling.
	 */
	#subscribeChanges(
		binding: SessionBinding,
		kind: AdministrationReadIntent['kind'],
		refresh: () => void
	): ServerEventSubscription | undefined {
		const events = this.#api(binding).events;
		const institution = <A extends string>(action: A) =>
			({
				action,
				resourceType: 'institution',
				resourceId: this.session.institutionId(binding)
			}) as const;
		switch (kind) {
			case 'accessPolicy':
				return events.on(
					'access_policy_changed',
					institution('access_policy.view'),
					refresh
				);
			case 'jobs':
			case 'job':
			case 'jobAttempts':
				return events.on('job.changed', institution('job.view'), refresh);
			case 'onboardingImports':
			case 'onboardingImport': {
				const subscribed = events.on(
					'onboarding_import.changed',
					institution('onboarding_batch.view'),
					refresh
				);
				// An import only its creator may read is announced to the creator alone.
				const mine = events.on('onboarding_import.changed', undefined, refresh);
				return {
					accepted: subscribed.accepted,
					dispose: () => combinedDisposable(subscribed, mine).dispose()
				};
			}
			default:
				return undefined;
		}
	}

	dispose(): void {
		this.#disposed = true;
	}

	#api(binding: SessionBinding): AdministrationApi {
		if (this.#disposed) throw new ServerApiError('sessionEnded');
		return this.session.apiForSession(binding);
	}

	/** One read. It throws on failure, so the cache retries only what is transient. */
	#read(
		binding: SessionBinding,
		intent: AdministrationReadIntent,
		signal: AbortSignal
	): Promise<AdministrationResponse> {
		const api = guardAdministrationApi(this.#api(binding));
		return (routes[intent.kind] as Route<RoutedKind>).call(
			api,
			intent as AdministrationIntentOf<RoutedKind>,
			'',
			signal
		);
	}

	async #change(
		binding: SessionBinding,
		intent: AdministrationChangeIntent
	): Promise<AdministrationResponse> {
		// Stopping a confirmation is never blocked by the confirmation it stops.
		if (intent.kind === 'cancelReauthentication') {
			try {
				this.#api(binding);
				this.session.cancelReauthentication(binding);
				return { kind: 'success' };
			} catch (error) {
				return this.#failure(error, intent);
			}
		}
		if (this.#changing) return { kind: 'error', reason: 'unavailable' };
		this.#changing = true;
		try {
			const api = guardAdministrationApi(this.#api(binding));
			if (intent.kind === 'reauthenticate') {
				const outcome = await this.session.reauthenticate(binding);
				if (outcome === 'success') return { kind: 'success' };
				return {
					kind: 'error',
					reason: outcome === 'strongAuthenticationRequired' ? 'strongRequired' : outcome
				};
			}
			const route = routes[intent.kind] as Route<RoutedKind>;
			const typed = intent as AdministrationIntentOf<RoutedKind>;
			const idempotent = requiresIdempotencyKey(route.operation);
			// One key per change; the single retry after a lost reply reuses it.
			const idempotencyKey = idempotent ? randomBytes(32).toString('base64url') : '';
			try {
				return await route.call(api, typed, idempotencyKey);
			} catch (error) {
				if (!idempotent || !lostReply(error)) throw error;
				return await route.call(
					guardAdministrationApi(this.#api(binding)),
					typed,
					idempotencyKey
				);
			}
		} catch (error) {
			return this.#failure(error, intent);
		} finally {
			this.#changing = false;
		}
	}

	/** The closed failure reply for an error; the Session signer already ended a refused Session. */
	#failure(error: unknown, intent: AdministrationIntent): AdministrationResponse {
		const change = !isAdministrationRead(intent);
		const fail = (reason: AdministrationFailure): AdministrationResponse => ({
			kind: 'error',
			reason
		});
		if (this.#disposed) return fail('sessionEnded');
		if (!(error instanceof ServerApiError)) return fail(change ? 'unconfirmed' : 'unavailable');
		if (error.kind === 'sessionEnded') return fail('sessionEnded');
		if (error.kind === 'invalidRequest') return fail('invalid');
		if (error.kind !== 'server') return fail(change ? 'unconfirmed' : 'unavailable');
		const status = error.status ?? 0;
		const code = error.problem?.code;
		if (status === 401) return fail('sessionEnded');
		if (code === 'authentication.reauthentication_required')
			return fail('reauthenticationRequired');
		if (code === 'authentication.strong_required') return fail('strongRequired');
		if (status === 403) return fail('noAccess');
		if (status === 404)
			return fail(!change && collections.has(intent.kind) ? 'noAccess' : 'notFound');
		if (status === 409 || status === 412) return fail('conflict');
		if (status === 400 || status === 422) {
			const fields = Object.keys(error.problem?.fields ?? {})
				.filter((field) => failureFields.test(field))
				.slice(0, 32);
			return fields.length
				? { kind: 'error', reason: 'invalid', fields: Object.freeze(fields) }
				: fail('invalid');
		}
		return fail(change && status >= 500 ? 'unconfirmed' : 'unavailable');
	}
}

/** A failure after which the server may have applied the change. */
function lostReply(error: unknown): boolean {
	return (
		error instanceof ServerApiError &&
		(error.kind === 'network' ||
			error.kind === 'timeout' ||
			(error.kind === 'server' && [502, 503, 504].includes(error.status ?? 0)))
	);
}
