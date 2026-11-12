/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/** Kinds of audited change, as the Audits Event filter offers them. */
export const auditEventKinds = [
	'signIn',
	'people',
	'access',
	'structure',
	'exams',
	'records'
] as const;
export type AuditEventKind = (typeof auditEventKinds)[number];

/**
 * The server's audited changes by kind. Reads (view, list, search) are left out: a filter by
 * kind is about changes. Each kind stays within the server's 32 actions a query.
 */
export const auditEventActions: Readonly<Record<AuditEventKind, readonly string[]>> = Object.freeze(
	{
		signIn: [
			'authentication.administrator_mfa_reset',
			'authentication.administrator_recovery',
			'authentication.desktop_authorization',
			'authentication.desktop_session_issue',
			'authentication.email_change.undo',
			'authentication.email_verification.complete',
			'authentication.email_verification.request',
			'authentication.external_login',
			'authentication.external_provision',
			'authentication.login',
			'authentication.password_reset.complete',
			'authentication.password_reset.request',
			'authentication.public_registration',
			'authentication.reauthenticate',
			'mfa.activate',
			'mfa.challenge',
			'mfa.disable',
			'mfa.recovery_codes.regenerate',
			'mfa.rekey',
			'mfa.setup'
		],
		people: [
			'user.manage',
			'user.mfa.reset',
			'user.profile_picture.manage',
			'user.settings.replace',
			'invitation.accept',
			'invitation.create',
			'invitation.manage',
			'onboarding_batch.manage',
			'external_identity.manage',
			'session.manage',
			'desktop_registration.rename',
			'desktop_registration.revoke',
			'personal_access_token.create',
			'personal_access_token.disable',
			'personal_access_token.enable',
			'personal_access_token.revoke'
		],
		access: [
			'role.manage',
			'role.system_admin.reconcile',
			'role_binding.manage',
			'access_policy.manage',
			'institution.manage',
			'desktop_compatibility_policy.manage',
			'installation.bootstrap'
		],
		structure: [
			'academic.progression.manage',
			'academic_period.manage',
			'academic_unit.manage',
			'academic_unit.members.manage',
			'class.manage',
			'class.members.manage',
			'programme.manage',
			'programme_level.manage'
		],
		exams: [
			'exam.create',
			'exam.create.override',
			'exam.manage',
			'exam.manage.override',
			'exam.publish',
			'exam.publish.override',
			'exam.records.complete',
			'exam.records.complete.override',
			'exam.records.export',
			'exam.records.export.override',
			'exam.records.hold',
			'exam.records.hold.override',
			'exam.sitting.create',
			'exam.sitting.create.override',
			'exam.sitting.manage',
			'exam.sitting.manage.override',
			'exam.sitting.participate',
			'submission.release',
			'submission.release.override',
			'submission.review',
			'submission.review.override'
		],
		records: [
			'retention_cleanup.manage',
			'retention_hold.release',
			'retention_policy.manage',
			'job.manage',
			'mail.manage',
			'mail.rekey'
		]
	}
);
