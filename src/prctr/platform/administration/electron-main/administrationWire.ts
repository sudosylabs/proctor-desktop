/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { components } from '../../serverApi/common/serverApi.generated.js';
import { projectionInstant } from '../../serverApi/common/projection.js';
import {
	ADMINISTRATION_MAX_PAGE_SIZE,
	validateAdministrationResponse,
	type AdministrationBatchResult,
	type AdministrationResource,
	type AdministrationResponse,
	type AdministrationValue
} from '../common/administrationProtocol.js';

/**
 * Whitelist projections of the server's administration DTOs. Each names only the fields a page
 * presents; everything else the server sends (URLs, request identifiers, digests, raw options)
 * stays in main. The protocol validator bounds the result before it leaves.
 */
type Schema<N extends keyof components['schemas']> = components['schemas'][N];
type Item<R extends AdministrationResource> =
	AdministrationValue<R> extends { readonly items: readonly (infer I)[] } ? I : never;

function at(value: string): number {
	return projectionInstant(value)!;
}
function optionalAt(value: string | undefined): number | undefined {
	return value === undefined ? undefined : at(value);
}

export function projectData<R extends AdministrationResource>(
	resource: R,
	value: AdministrationValue<R>
): AdministrationResponse {
	return validateAdministrationResponse({ kind: 'data', data: { resource, value } });
}
/**
 * One page; the server is asked for at most a page, and a longer answer is refused. The route
 * also refuses a page longer than the one asked for.
 */
export function projectPage<R extends AdministrationResource, T>(
	resource: R,
	page: {
		readonly items: readonly T[];
		readonly next_cursor?: string;
		readonly total?: number;
		readonly total_is_lower_bound?: boolean;
	},
	item: (value: T) => Item<R>,
	extra: Omit<AdministrationValue<R>, 'items' | 'cursor'> = {} as Omit<
		AdministrationValue<R>,
		'items' | 'cursor'
	>
): AdministrationResponse {
	if (page.items.length > ADMINISTRATION_MAX_PAGE_SIZE) throw new TypeError('Oversized page');
	return projectData(resource, {
		...extra,
		items: page.items.map(item),
		...(page.next_cursor ? { cursor: page.next_cursor } : {}),
		...(page.total === undefined
			? {}
			: { total: page.total, totalAtLeast: page.total_is_lower_bound === true })
	} as unknown as AdministrationValue<R>);
}

export function user(
	u: Schema<'UserProfileResponse'> | Schema<'UserDirectoryEntryResponse'>
): AdministrationValue<'user'> {
	return {
		id: u.id,
		username: u.username,
		displayName: u.display_name,
		firstName: u.first_name,
		lastName: u.last_name,
		email: u.email,
		emailVerified: u.email_verified,
		locale: u.locale,
		timezone: u.timezone,
		photoKind: u.profile_picture_kind,
		createdAt: at(u.created_at),
		disabledAt: optionalAt(u.disabled_at),
		lastLoginAt: optionalAt(u.last_login_at),
		lastActivityAt: optionalAt(u.last_activity_at)
	};
}
/** The photo the server rendered; anything but WebP is refused. */
export function userPhoto(value: unknown, etag: string | undefined): AdministrationResponse {
	if (!(value instanceof Uint8Array)) throw new TypeError('Invalid profile photo');
	const bytes = Buffer.from(value);
	if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP')
		throw new TypeError('Invalid profile photo');
	return projectData('userPhoto', {
		dataUrl: `data:image/webp;base64,${bytes.toString('base64')}`,
		etag: etag ?? ''
	});
}
export function userEntry(u: Schema<'UserDirectoryEntryResponse'>): Item<'users'> {
	const summary = u.summary;
	return {
		...user(u),
		summary: summary && {
			affiliations: summary.affiliations.map((affiliation) => ({
				kind: affiliation.kind,
				units: affiliation.academic_units.map((unit) => ({ id: unit.id, name: unit.name })),
				unitsMore: affiliation.academic_units_more
			})),
			affiliationsMore: summary.affiliations_more,
			roles: summary.roles?.map((role) => ({
				roleId: role.role_id,
				displayName: role.display_name,
				scopeType: role.scope_type,
				scopeName: role.scope_name
			})),
			rolesMore: summary.roles_more
		}
	};
}
export function userSession(s: Schema<'SessionAdministrationResponse'>): Item<'userSessions'> {
	return {
		id: s.id,
		client: s.client_type,
		method: s.authentication_method,
		strength: s.authentication_strength,
		platform: s.desktop_platform,
		deviceName: s.device_name,
		release: s.desktop_release,
		createdAt: at(s.created_at),
		lastActivityAt: at(s.last_activity_at),
		expiresAt: at(s.expires_at),
		revokedAt: optionalAt(s.revoked_at),
		revocationCode: s.revocation_reason_code
	};
}
export function affiliation(a: Schema<'AffiliationResponse'>): Item<'affiliations'> {
	return { id: a.id, kind: a.kind, startAt: at(a.start_at), endAt: optionalAt(a.end_at) };
}
export function invitation(
	i: Schema<'InvitationAdministrationResponse'>
): AdministrationValue<'invitation'> {
	return {
		id: i.id,
		purpose: i.purpose,
		state: i.state,
		email: i.email,
		revision: i.revision,
		inviterId: i.inviter_user_id,
		inviterName: i.inviter?.display_name,
		roleName: i.role?.display_name,
		scopeName: i.scope?.display_name,
		acceptedUserId: i.accepted_user_id,
		academicUnitId: i.academic_unit_id,
		classId: i.class_id,
		academicPeriodId: i.academic_period_id,
		roleId: i.role_id,
		createdAt: at(i.created_at),
		expiresAt: at(i.expires_at),
		startAt: at(i.start_at),
		endAt: optionalAt(i.end_at),
		delivery: i.delivery && {
			state: i.delivery.state,
			recipient: i.delivery.masked_recipient,
			failureCode: i.delivery.public_failure_code,
			updatedAt: at(i.delivery.updated_at)
		}
	};
}
const IMPORT_ROWS = 100;
export function importSummary(i: Schema<'OnboardingImportResponse'>): Item<'onboardingImports'> {
	return {
		id: i.id,
		mode: i.mode,
		fileName: i.file_name,
		scopeType: i.scope_type,
		scopeId: i.scope_id,
		roleId: i.role_id,
		state: i.state,
		revision: i.revision,
		totalRows: i.total_rows,
		validRows: i.valid_rows,
		invalidRows: i.invalid_rows,
		succeededRows: i.succeeded_rows,
		failedRows: i.failed_rows,
		skippedRows: i.skipped_rows,
		noOpRows: i.no_op_rows,
		previewDigest: i.preview_digest,
		commitPolicy: i.commit_policy,
		failureCode: i.failure_code,
		createdAt: at(i.created_at),
		updatedAt: at(i.updated_at),
		expiresAt: at(i.expires_at),
		sourceClassId: i.source_class_id,
		sourceClassName: i.source_class_name,
		sourcePeriodId: i.source_period_id,
		destinationClassId: i.destination_class_id,
		destinationClassName: i.destination_class_name,
		destinationPeriodId: i.destination_period_id,
		effectiveAt: optionalAt(i.effective_at)
	};
}
export function onboardingImport(
	i: Schema<'OnboardingImportResponse'>
): AdministrationValue<'onboardingImport'> {
	const rows = i.rows ?? [];
	return {
		...importSummary(i),
		rows: rows.slice(0, IMPORT_ROWS).map((row) => ({
			row: row.row,
			reference: row.reference,
			operation: row.operation,
			status: row.status,
			code: row.public_code ?? row.preview_code
		})),
		moreRows: rows.length > IMPORT_ROWS
	};
}
export function institution(i: Schema<'InstitutionResponse'>): AdministrationValue<'institution'> {
	return {
		id: i.id,
		name: i.name,
		displayName: i.display_name,
		description: i.description,
		archivedAt: optionalAt(i.archived_at)
	};
}
function structured(s: {
	readonly id: string;
	readonly name: string;
	readonly display_name: string;
	readonly description: string;
	readonly revision: number;
	readonly archived_at?: string;
}) {
	return {
		id: s.id,
		name: s.name,
		displayName: s.display_name,
		description: s.description,
		revision: s.revision,
		archivedAt: optionalAt(s.archived_at)
	};
}
export function academicUnit(u: Schema<'AcademicUnitResponse'>): Item<'academicUnits'> {
	return { ...structured(u), parentId: u.parent_id };
}
export function programme(p: Schema<'ProgrammeResponse'>): Item<'unitProgrammes'> {
	return { ...structured(p), unitId: p.academic_unit_id };
}
export function programmeLevel(l: Schema<'ProgrammeLevelResponse'>): Item<'programmeLevels'> {
	return { ...structured(l), programmeId: l.programme_id };
}
export function classOf(
	c: Schema<'ClassResponse'> | Schema<'ClassListItemResponse'>
): AdministrationValue<'class'> {
	const count = 'student_count' in c ? c.student_count : undefined;
	return {
		...structured(c),
		levelId: c.programme_level_id,
		academicPeriodId: c.academic_period_id,
		...(count === undefined
			? {}
			: {
					studentCount: count,
					studentCountAtLeast:
						'student_count_is_lower_bound' in c &&
						c.student_count_is_lower_bound === true
				})
	};
}
export function classMember(m: Schema<'ClassMemberResponse'>): Item<'classMembers'> {
	return {
		id: m.id,
		userId: m.user_id,
		classId: m.class_id,
		academicPeriodId: m.academic_period_id,
		startAt: at(m.start_at),
		endAt: optionalAt(m.end_at)
	};
}
export function unitMember(m: Schema<'AcademicUnitMemberListItemResponse'>): Item<'unitMembers'> {
	return {
		id: m.id,
		userId: m.user_id,
		unitId: m.academic_unit_id,
		startAt: at(m.start_at),
		endAt: optionalAt(m.end_at),
		user: {
			displayName: m.user.display_name,
			username: m.user.username,
			email: m.email
		},
		rolesHere: m.roles_here?.map((role) => ({
			roleId: role.role_id,
			displayName: role.display_name
		})),
		rolesHereMore: m.roles_here_more
	};
}
export function academicPeriod(p: Schema<'AcademicPeriodResponse'>): Item<'academicPeriods'> {
	return {
		...structured(p),
		ownerType: p.owner_type,
		ownerId: p.owner_id,
		startAt: at(p.start_at),
		endAt: at(p.end_at)
	};
}
export function role(r: Schema<'RoleResponse'>): Item<'roles'> {
	return {
		id: r.id,
		name: r.name,
		displayName: r.display_name,
		description: r.description,
		builtIn: r.built_in,
		permissions: r.permissions,
		archivedAt: optionalAt(r.archived_at),
		holders: r.holders && {
			bindings: r.holders.bindings,
			bindingsIsLowerBound: r.holders.bindings_is_lower_bound,
			users: r.holders.users,
			usersIsLowerBound: r.holders.users_is_lower_bound,
			scopes: r.holders.scopes,
			scopesIsLowerBound: r.holders.scopes_is_lower_bound
		}
	};
}
export function roleBinding(b: Schema<'RoleBindingResponse'>): Item<'roleBindings'> {
	return {
		id: b.id,
		roleId: b.role_id,
		userId: b.user_id,
		scopeType: b.scope_type,
		scopeId: b.scope_id,
		startAt: at(b.start_at),
		endAt: optionalAt(b.end_at)
	};
}
export function accessPolicy(
	p: Schema<'AccessPolicyResponse'>
): AdministrationValue<'accessPolicy'> {
	return {
		revision: p.revision,
		localLogin: p.local_login_enabled,
		publicRegistration: p.public_registration_enabled,
		invitationAdmission: p.invitation_admission_enabled,
		invitationLocalCredential: p.invitation_local_credential_enabled,
		desktopAuthorization: p.desktop_authorization_enabled,
		durableMail: p.durable_mail,
		roleHolderMfaRequired: p.role_holder_mfa_required,
		roleHolderMfaEnforced: p.role_holder_mfa_enforced,
		sessionIdleMinutes: p.session_idle_minutes ?? undefined,
		sessionIdleDefault: p.session_idle_minutes_default,
		sessionIdleMaximum: p.session_idle_minutes_maximum,
		sessionAbsoluteMinutes: p.session_absolute_minutes ?? undefined,
		sessionAbsoluteDefault: p.session_absolute_minutes_default,
		sessionAbsoluteMaximum: p.session_absolute_minutes_maximum,
		providers: p.available_providers.map((provider) => ({
			id: provider.id,
			displayName: provider.display_name,
			type: provider.type
		})),
		providerAdmissions: Object.entries(p.provider_admissions).map(([providerId, mode]) => ({
			providerId,
			mode
		})),
		history: p.history.map((transition) => ({
			fromRevision: transition.from_revision,
			toRevision: transition.to_revision,
			changedAt: at(transition.changed_at),
			actorId: transition.actor_user_id,
			changedFields: transition.changed_fields
		})),
		updatedAt: at(p.updated_at)
	};
}
export function accessPolicyPreflight(
	p: Schema<'AccessPolicyPreflightResponse'>
): AdministrationValue<'accessPolicyPreflight'> {
	return {
		blockers: p.blockers.map((blocker) => ({
			code: blocker.code,
			providerId: blocker.provider_id
		})),
		roleHoldersWithoutMfa: p.role_holders_without_mfa_count,
		singleFactorSessions: p.role_holder_single_factor_session_count
	};
}
export function desktopCompatibility(
	p: Schema<'DesktopCompatibilityPolicyResponse'>
): AdministrationValue<'desktopCompatibility'> {
	return {
		revision: p.revision,
		availability: p.availability,
		minimumRelease: p.minimum_desktop_release,
		message: p.administrator_message,
		retryAt: optionalAt(p.retry_at),
		revokedBuilds: p.revoked_desktop_builds.map((b) => ({
			buildId: b.build_id,
			reason: b.reason
		})),
		updatedAt: at(p.updated_at)
	};
}
export function audit(a: Schema<'AuditEventResponse'>): Item<'audits'> {
	return {
		id: a.id,
		action: a.action,
		status: a.status,
		summary: a.summary,
		createdAt: at(a.created_at),
		resourceType: a.resource.type,
		resourceId: a.resource.id,
		actorId: a.actor_id,
		scopeType: a.scope_type,
		scopeId: a.scope_id,
		client: a.client_type,
		method: a.authentication_method,
		ipAddress: a.ip_address,
		userAgent: a.user_agent,
		errorCode: a.error_code,
		reason: a.reason
	};
}
export function retentionPolicy(
	p: Schema<'RetentionPolicyResponse'>
): AdministrationValue<'retentionPolicy'> {
	return {
		revision: p.revision,
		auditDays: p.audit_retention_days,
		browserActivityDays: p.browser_activity_retention_days,
		deletionGraceDays: p.deletion_grace_days,
		exportDays: p.export_retention_days,
		integrityDays: p.integrity_retention_days,
		securityOperationalDays: p.security_operational_retention_days,
		submissionDays: p.submission_retention_days,
		candidateNotices: p.candidate_notices,
		automaticDeletion: p.automatic_deletion_enabled,
		updatedAt: at(p.updated_at)
	};
}
export function retentionControl(
	c: Schema<'RetentionControlResponse'>
): AdministrationValue<'retentionControl'> {
	return {
		revision: c.revision,
		state: c.state,
		approvedPolicyRevision: c.approved_policy_revision,
		approvedPreviewId: c.approved_preview_id,
		updatedAt: at(c.updated_at)
	};
}
function counts(c: {
	readonly total: number;
	readonly eligible: number;
	readonly held: number;
	readonly awaiting_deadline: number;
	readonly unconfigured: number;
}) {
	return {
		total: c.total,
		eligible: c.eligible,
		held: c.held,
		awaitingDeadline: c.awaiting_deadline,
		unconfigured: c.unconfigured
	};
}
export function retentionPreview(
	p: Schema<'RetentionPreviewResponse'>
): AdministrationValue<'retentionPreview'> {
	return {
		id: p.id,
		policyRevision: p.policy_revision,
		createdAt: at(p.created_at),
		expiresAt: at(p.expires_at),
		work: counts(p.work),
		integrity: counts(p.integrity),
		browserActivity: counts(p.browser_activity),
		securityOperational: counts(p.security_operational),
		audit: counts(p.audit),
		receipts: counts(p.receipts)
	};
}
export function retentionRecords(p: Schema<'RetentionRecordsResponse'>): AdministrationResponse {
	return projectPage(
		'retentionRecords',
		p,
		(r) => ({
			submissionId: r.submission_id,
			examId: r.exam_id,
			sittingId: r.exam_sitting_id,
			category: r.category,
			blocker: r.blocker,
			held: r.held,
			eligibleAt: optionalAt(r.eligible_at),
			retiredAt: optionalAt(r.retired_at),
			completedAt: optionalAt(r.completed_at)
		}),
		{ asOf: at(p.as_of), policyRevision: p.policy_revision }
	);
}
export function job(j: Schema<'JobResponse'>): AdministrationValue<'job'> {
	return {
		id: j.id,
		type: j.type,
		status: j.status,
		revision: j.revision,
		attempts: j.attempt_count,
		maximumAttempts: j.maximum_attempts,
		createdAt: at(j.created_at),
		updatedAt: at(j.updated_at),
		availableAt: at(j.available_at),
		startedAt: optionalAt(j.started_at),
		completedAt: optionalAt(j.completed_at),
		errorCode: j.public_error_code,
		progress: j.progress && {
			stage: j.progress.stage,
			current: j.progress.current,
			total: j.progress.total
		},
		createdById: j.created_by_user_id,
		createdByName: j.created_by_display_name,
		subject: j.subject
	};
}
export function jobAttempt(a: Schema<'JobAttemptResponse'>): Item<'jobAttempts'> {
	return {
		id: a.id,
		number: a.number,
		status: a.status,
		startedAt: at(a.started_at),
		completedAt: optionalAt(a.completed_at),
		errorCode: a.public_error_code
	};
}
export function mailDelivery(d: Schema<'MailDeliveryResponse'>): Item<'mailDeliveries'> {
	return {
		id: d.id,
		state: d.state,
		recipient: d.masked_recipient,
		recipientName: d.recipient_display_name,
		targetUserId: d.target_user_id,
		template: d.template_key,
		attempts: d.attempt_count,
		createdAt: at(d.created_at),
		updatedAt: at(d.updated_at),
		deadline: at(d.deadline),
		acceptedAt: optionalAt(d.accepted_at),
		failedAt: optionalAt(d.failed_at),
		failureCode: d.public_failure_code
	};
}
export function mailDeliveryDetail(
	d: Schema<'MailDeliveryResponse'>
): AdministrationValue<'mailDelivery'> {
	return {
		...mailDelivery(d),
		targetInvitationId: d.target_invitation_id,
		messageId: d.message_id
	};
}
export function administrationCounts(
	c: Schema<'AdministrationCountsResponse'>
): AdministrationValue<'counts'> {
	const count = (value: number | undefined, atLeast: boolean | undefined) =>
		value === undefined ? undefined : { count: value, atLeast: atLeast === true };
	return {
		pendingInvitations: count(c.pending_invitations, c.pending_invitations_is_lower_bound),
		failedJobs: count(c.failed_jobs, c.failed_jobs_is_lower_bound),
		failedMailDeliveries: count(
			c.failed_mail_deliveries,
			c.failed_mail_deliveries_is_lower_bound
		),
		openImports: count(c.open_onboarding_imports, c.open_onboarding_imports_is_lower_bound)
	};
}
const METRICS = 64;
export function mailMetrics(m: Schema<'MailMetricsResponse'>): AdministrationValue<'mailMetrics'> {
	return {
		health: m.health_code,
		queues: m.queues.slice(0, METRICS).map((queue) => ({
			state: queue.state,
			count: queue.count,
			oldestAgeMs: queue.oldest_age_millis,
			health: queue.health_code,
			truncated: queue.truncated
		})),
		deliveries: m.deliveries.slice(0, METRICS).map((delivery) => ({
			state: delivery.state,
			count: delivery.count,
			outcome: delivery.outcome_code
		}))
	};
}
export function mfaKeys(k: Schema<'MFAKeyStateResponse'>): AdministrationValue<'mfaKeys'> {
	return {
		primaryKeyId: k.primary_key_id,
		requiredPrimaryKeyId: k.required_primary_key_id,
		activeRekeyJobId: k.active_rekey_job_id,
		keys: k.active.map((key) => ({
			keyId: key.key_id,
			configured: key.configured,
			credentials: key.credentials
		}))
	};
}
export function mailKeys(k: Schema<'MailKeyStateResponse'>): AdministrationValue<'mailKeys'> {
	return {
		primaryKeyId: k.primary_key_id,
		requiredPrimaryKeyId: k.required_primary_key_id,
		keys: k.active.map((key) => ({ keyId: key.key_id, references: key.active_references }))
	};
}
export function rekey(
	s: Schema<'MFARekeyStatusResponse'> | Schema<'MailRekeyStatusResponse'>
): AdministrationValue<'mfaRekey'> {
	return {
		jobId: s.job_id,
		status: s.status,
		primaryKeyId: s.primary_key_id,
		retiringKeyId: s.retiring_key_id,
		processed: s.processed,
		changed: 'resealed' in s ? s.resealed : s.reencrypted,
		errorCode: s.public_error_code,
		createdAt: at(s.created_at),
		updatedAt: at(s.updated_at),
		completedAt: optionalAt(s.completed_at)
	};
}
function directoryFilter(f: Schema<'AcademicAdministrationPreviewFilter'>) {
	return {
		q: f.q,
		affiliation: f.affiliation,
		academicUnitId: f.academic_unit_id,
		roleIds: f.role_id,
		state: f.state,
		neverSignedIn: f.never_signed_in,
		lastActiveAfter: optionalAt(f.last_active_after),
		lastActiveBefore: optionalAt(f.last_active_before)
	};
}
export function academicPreview(
	p: Schema<'AcademicAdministrationPreviewResponse'>
): AdministrationValue<'academicPreview'> {
	return {
		id: p.id,
		operation: p.operation,
		state: p.state,
		scopeType: p.scope_type,
		scopeId: p.scope_id,
		filter: directoryFilter(p.filter),
		roleId: p.role_id,
		affiliationKind: p.affiliation_kind,
		startAt: optionalAt(p.start_at),
		endAt: optionalAt(p.end_at),
		revision: p.revision,
		previewDigest: p.preview_digest,
		totalRows: p.total_rows,
		succeededRows: p.succeeded_rows,
		failedRows: p.failed_rows,
		skippedRows: p.skipped_rows,
		noOpRows: p.no_op_rows,
		summary: p.summary && {
			willChange: p.summary.will_change,
			noOp: p.summary.no_op,
			skipped: p.summary.skipped,
			skipReasons: p.summary.skip_reasons.map((reason) => ({
				reason: reason.reason,
				rows: reason.rows
			}))
		},
		failureCode: p.failure_code,
		previewJobId: p.preview_job_id,
		executionJobId: p.execution_job_id,
		createdAt: at(p.created_at),
		updatedAt: at(p.updated_at),
		expiresAt: at(p.expires_at),
		commitBy: optionalAt(p.preview_expires_at)
	};
}
export function academicPreviewRow(
	r: Schema<'AcademicAdministrationPreviewRowResponse'>
): Item<'academicPreviewRows'> {
	return {
		row: r.row,
		userId: r.user_id,
		username: r.username,
		displayName: r.display_name,
		group: r.group,
		status: r.status,
		reason: r.reason,
		code: r.public_code,
		resourceId: r.resource_id
	};
}
export function invitationBatch(b: Schema<'InvitationBatchResponse'>): AdministrationResponse {
	const result: AdministrationBatchResult = {
		operation: b.operation,
		succeeded: b.succeeded,
		failed: b.failed,
		noOp: b.no_op,
		items: b.items.map((item) => ({
			index: item.index,
			status: item.status,
			invitationId: item.invitation_id,
			errorCode: item.error_code
		}))
	};
	return validateAdministrationResponse({ kind: 'batchResult', result });
}
export function academicBatch(
	b: Schema<'AcademicAdministrationBatchResponse'>
): AdministrationResponse {
	const result: AdministrationBatchResult = {
		operation: b.operation,
		succeeded: b.succeeded,
		failed: b.failed,
		noOp: b.no_op,
		items: b.items.map((item) => ({
			index: item.index,
			status: item.status,
			resourceId: item.resource_id,
			errorCode: item.error_code
		}))
	};
	return validateAdministrationResponse({ kind: 'batchResult', result });
}
