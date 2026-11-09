/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/**
 * Words for the server's closed catalogues. The server names a code; the desktop says what it
 * means. A code outside these lists falls back to its own words.
 */

export const problemCodeMessages = Object.freeze({
	problemAcademicUnitMemberConflict: defineMessage({
		id: 'administration.code.problem.academic.unit.member.conflict',
		defaultMessage: 'Already a member of this unit.',
		description:
			'Why the server refused or stopped something, for the code `academic_unit_member.conflict`.'
	}),
	problemAcademicUnitMemberInvalid: defineMessage({
		id: 'administration.code.problem.academic.unit.member.invalid',
		defaultMessage: 'This unit membership isn’t valid.',
		description:
			'Why the server refused or stopped something, for the code `academic_unit_member.invalid`.'
	}),
	problemAdministrationUnavailable: defineMessage({
		id: 'administration.code.problem.administration.unavailable',
		defaultMessage: 'Administration isn’t available right now.',
		description:
			'Why the server refused or stopped something, for the code `administration.unavailable`.'
	}),
	problemAffiliationConflict: defineMessage({
		id: 'administration.code.problem.affiliation.conflict',
		defaultMessage: 'Already has this affiliation for these dates.',
		description:
			'Why the server refused or stopped something, for the code `affiliation.conflict`.'
	}),
	problemAffiliationInvalid: defineMessage({
		id: 'administration.code.problem.affiliation.invalid',
		defaultMessage: 'This affiliation isn’t valid.',
		description:
			'Why the server refused or stopped something, for the code `affiliation.invalid`.'
	}),
	problemAffiliationStudentHasActiveEnrollment: defineMessage({
		id: 'administration.code.problem.affiliation.student.has.active.enrollment',
		defaultMessage: 'Is still enrolled in a class, so the student affiliation can’t end.',
		description:
			'Why the server refused or stopped something, for the code `affiliation.student_has_active_enrollment`.'
	}),
	problemAuditUnavailable: defineMessage({
		id: 'administration.code.problem.audit.unavailable',
		defaultMessage: 'The change couldn’t be recorded in Audits, so it wasn’t made.',
		description:
			'Why the server refused or stopped something, for the code `audit.unavailable`.'
	}),
	problemAuthenticationReauthenticationRequired: defineMessage({
		id: 'administration.code.problem.authentication.reauthentication.required',
		defaultMessage: 'Needs you to confirm it’s you first.',
		description:
			'Why the server refused or stopped something, for the code `authentication.reauthentication_required`.'
	}),
	problemAuthenticationStrongRequired: defineMessage({
		id: 'administration.code.problem.authentication.strong.required',
		defaultMessage: 'Needs a sign-in with two-step verification.',
		description:
			'Why the server refused or stopped something, for the code `authentication.strong_required`.'
	}),
	problemAuthenticationTokenInvalid: defineMessage({
		id: 'administration.code.problem.authentication.token.invalid',
		defaultMessage: 'Your sign-in ended.',
		description:
			'Why the server refused or stopped something, for the code `authentication.token_invalid`.'
	}),
	problemAuthorizationDenied: defineMessage({
		id: 'administration.code.problem.authorization.denied',
		defaultMessage: 'You don’t have access to do this.',
		description:
			'Why the server refused or stopped something, for the code `authorization.denied`.'
	}),
	problemAuthorizationRequestInvalid: defineMessage({
		id: 'administration.code.problem.authorization.request.invalid',
		defaultMessage: 'This request can’t be checked for access.',
		description:
			'Why the server refused or stopped something, for the code `authorization.request.invalid`.'
	}),
	problemAuthorizationUnavailable: defineMessage({
		id: 'administration.code.problem.authorization.unavailable',
		defaultMessage: 'Access couldn’t be checked right now.',
		description:
			'Why the server refused or stopped something, for the code `authorization.unavailable`.'
	}),
	problemClassEnrollmentConflict: defineMessage({
		id: 'administration.code.problem.class.enrollment.conflict',
		defaultMessage: 'Is already enrolled in a class of this level for this period.',
		description:
			'Why the server refused or stopped something, for the code `class.enrollment_conflict`.'
	}),
	problemClassMemberInvalid: defineMessage({
		id: 'administration.code.problem.class.member.invalid',
		defaultMessage: 'This enrolment isn’t valid.',
		description:
			'Why the server refused or stopped something, for the code `class_member.invalid`.'
	}),
	problemClassMemberStudentAffiliationRequired: defineMessage({
		id: 'administration.code.problem.class.member.student.affiliation.required',
		defaultMessage: 'Isn’t a student here yet, so can’t join a class.',
		description:
			'Why the server refused or stopped something, for the code `class_member.student_affiliation_required`.'
	}),
	problemDatabaseUnavailable: defineMessage({
		id: 'administration.code.problem.database.unavailable',
		defaultMessage: 'Storage didn’t answer in time.',
		description:
			'Why the server refused or stopped something, for the code `database.unavailable`.'
	}),
	problemDependencyUnavailable: defineMessage({
		id: 'administration.code.problem.dependency.unavailable',
		defaultMessage: 'A service Proctor relies on didn’t answer.',
		description:
			'Why the server refused or stopped something, for the code `dependency.unavailable`.'
	}),
	problemExamExportExpired: defineMessage({
		id: 'administration.code.problem.exam.export.expired',
		defaultMessage: 'The export expired before it finished.',
		description:
			'Why the server refused or stopped something, for the code `exam.export.expired`.'
	}),
	problemExamExportUnavailable: defineMessage({
		id: 'administration.code.problem.exam.export.unavailable',
		defaultMessage: 'The export isn’t available.',
		description:
			'Why the server refused or stopped something, for the code `exam.export.unavailable`.'
	}),
	problemFileBackendUnavailable: defineMessage({
		id: 'administration.code.problem.file.backend.unavailable',
		defaultMessage: 'File storage didn’t answer.',
		description:
			'Why the server refused or stopped something, for the code `file.backend_unavailable`.'
	}),
	problemIdempotencyConflict: defineMessage({
		id: 'administration.code.problem.idempotency.conflict',
		defaultMessage: 'A different change was already sent with this request.',
		description:
			'Why the server refused or stopped something, for the code `idempotency.conflict`.'
	}),
	problemIdempotencyInProgress: defineMessage({
		id: 'administration.code.problem.idempotency.in.progress',
		defaultMessage: 'The same change is still being made.',
		description:
			'Why the server refused or stopped something, for the code `idempotency.in_progress`.'
	}),
	problemInvitationClassPeriodConflict: defineMessage({
		id: 'administration.code.problem.invitation.class.period.conflict',
		defaultMessage: 'The class isn’t open in the chosen period.',
		description:
			'Why the server refused or stopped something, for the code `invitation.class_period_conflict`.'
	}),
	problemInvitationConflict: defineMessage({
		id: 'administration.code.problem.invitation.conflict',
		defaultMessage: 'Already has an open invitation for this.',
		description:
			'Why the server refused or stopped something, for the code `invitation.conflict`.'
	}),
	problemInvitationInvalid: defineMessage({
		id: 'administration.code.problem.invitation.invalid',
		defaultMessage: 'This invitation isn’t valid.',
		description:
			'Why the server refused or stopped something, for the code `invitation.invalid`.'
	}),
	problemInvitationMailUnavailable: defineMessage({
		id: 'administration.code.problem.invitation.mail.unavailable',
		defaultMessage: 'Invitation email can’t be sent right now.',
		description:
			'Why the server refused or stopped something, for the code `invitation.mail_unavailable`.'
	}),
	problemInvitationRoleNotDelegable: defineMessage({
		id: 'administration.code.problem.invitation.role.not.delegable',
		defaultMessage: 'You can’t give this role to others.',
		description:
			'Why the server refused or stopped something, for the code `invitation.role_not_delegable`.'
	}),
	problemInvitationUnavailable: defineMessage({
		id: 'administration.code.problem.invitation.unavailable',
		defaultMessage: 'Invitations aren’t available right now.',
		description:
			'Why the server refused or stopped something, for the code `invitation.unavailable`.'
	}),
	problemJobCanceled: defineMessage({
		id: 'administration.code.problem.job.canceled',
		defaultMessage: 'The job was cancelled.',
		description: 'Why the server refused or stopped something, for the code `job.canceled`.'
	}),
	problemJobCheckpointInvalid: defineMessage({
		id: 'administration.code.problem.job.checkpoint.invalid',
		defaultMessage: 'The job’s saved progress couldn’t be used.',
		description:
			'Why the server refused or stopped something, for the code `job.checkpoint.invalid`.'
	}),
	problemJobCommandInvalid: defineMessage({
		id: 'administration.code.problem.job.command.invalid',
		defaultMessage: 'The job was given something it can’t do.',
		description:
			'Why the server refused or stopped something, for the code `job.command.invalid`.'
	}),
	problemJobInvariantFailed: defineMessage({
		id: 'administration.code.problem.job.invariant.failed',
		defaultMessage: 'The job stopped to keep records consistent.',
		description:
			'Why the server refused or stopped something, for the code `job.invariant_failed`.'
	}),
	problemMailDeliveryCanceled: defineMessage({
		id: 'administration.code.problem.mail.delivery.canceled',
		defaultMessage: 'Delivery was cancelled.',
		description:
			'Why the server refused or stopped something, for the code `mail.delivery.canceled`.'
	}),
	problemMailDeliveryConflict: defineMessage({
		id: 'administration.code.problem.mail.delivery.conflict',
		defaultMessage: 'The delivery changed while this was sent.',
		description:
			'Why the server refused or stopped something, for the code `mail.delivery.conflict`.'
	}),
	problemMailDeliveryExpired: defineMessage({
		id: 'administration.code.problem.mail.delivery.expired',
		defaultMessage: 'Delivery stopped trying after its deadline.',
		description:
			'Why the server refused or stopped something, for the code `mail.delivery.expired`.'
	}),
	problemMailDeliveryFailed: defineMessage({
		id: 'administration.code.problem.mail.delivery.failed',
		defaultMessage: 'The email couldn’t be delivered.',
		description:
			'Why the server refused or stopped something, for the code `mail.delivery.failed`.'
	}),
	problemMailDeliveryNotFound: defineMessage({
		id: 'administration.code.problem.mail.delivery.not.found',
		defaultMessage: 'The delivery no longer exists.',
		description:
			'Why the server refused or stopped something, for the code `mail.delivery.not_found`.'
	}),
	problemMailDeliveryObsolete: defineMessage({
		id: 'administration.code.problem.mail.delivery.obsolete',
		defaultMessage: 'The email was no longer needed.',
		description:
			'Why the server refused or stopped something, for the code `mail.delivery.obsolete`.'
	}),
	problemMailDeliveryRecipientIneligible: defineMessage({
		id: 'administration.code.problem.mail.delivery.recipient.ineligible',
		defaultMessage: 'The person can no longer receive this email.',
		description:
			'Why the server refused or stopped something, for the code `mail.delivery.recipient_ineligible`.'
	}),
	problemMailDeliverySuppressedDisabled: defineMessage({
		id: 'administration.code.problem.mail.delivery.suppressed.disabled',
		defaultMessage: 'Not sent because the account is disabled.',
		description:
			'Why the server refused or stopped something, for the code `mail.delivery.suppressed_disabled`.'
	}),
	problemMailDeliveryUnavailable: defineMessage({
		id: 'administration.code.problem.mail.delivery.unavailable',
		defaultMessage: 'Mail delivery isn’t available.',
		description:
			'Why the server refused or stopped something, for the code `mail.delivery.unavailable`.'
	}),
	problemMailMessageInvalid: defineMessage({
		id: 'administration.code.problem.mail.message.invalid',
		defaultMessage: 'The email couldn’t be built.',
		description:
			'Why the server refused or stopped something, for the code `mail.message.invalid`.'
	}),
	problemMailOperatorRetry: defineMessage({
		id: 'administration.code.problem.mail.operator.retry',
		defaultMessage: 'Retried by an administrator.',
		description:
			'Why the server refused or stopped something, for the code `mail.operator.retry`.'
	}),
	problemMailPayloadUnavailable: defineMessage({
		id: 'administration.code.problem.mail.payload.unavailable',
		defaultMessage: 'The email’s content is no longer available.',
		description:
			'Why the server refused or stopped something, for the code `mail.payload.unavailable`.'
	}),
	problemMailRekeyFenced: defineMessage({
		id: 'administration.code.problem.mail.rekey.fenced',
		defaultMessage: 'Another key rotation took over.',
		description:
			'Why the server refused or stopped something, for the code `mail.rekey.fenced`.'
	}),
	problemMailRekeyIncomplete: defineMessage({
		id: 'administration.code.problem.mail.rekey.incomplete',
		defaultMessage: 'Not every email was re-encrypted.',
		description:
			'Why the server refused or stopped something, for the code `mail.rekey.incomplete`.'
	}),
	problemMailRekeyInvariantFailed: defineMessage({
		id: 'administration.code.problem.mail.rekey.invariant.failed',
		defaultMessage: 'Key rotation stopped to keep mail consistent.',
		description:
			'Why the server refused or stopped something, for the code `mail.rekey.invariant_failed`.'
	}),
	problemMailRekeyPayloadUnavailable: defineMessage({
		id: 'administration.code.problem.mail.rekey.payload.unavailable',
		defaultMessage: 'Some email content couldn’t be read to re-encrypt it.',
		description:
			'Why the server refused or stopped something, for the code `mail.rekey.payload_unavailable`.'
	}),
	problemMailRekeyPrimaryMismatch: defineMessage({
		id: 'administration.code.problem.mail.rekey.primary.mismatch',
		defaultMessage: 'The primary mail key changed during rotation.',
		description:
			'Why the server refused or stopped something, for the code `mail.rekey.primary_mismatch`.'
	}),
	problemMailSittingBundleUnavailable: defineMessage({
		id: 'administration.code.problem.mail.sitting.bundle.unavailable',
		defaultMessage: 'The sitting’s email bundle isn’t available.',
		description:
			'Why the server refused or stopped something, for the code `mail.sitting.bundle_unavailable`.'
	}),
	problemMailSittingInvalid: defineMessage({
		id: 'administration.code.problem.mail.sitting.invalid',
		defaultMessage: 'The sitting’s email couldn’t be built.',
		description:
			'Why the server refused or stopped something, for the code `mail.sitting.invalid`.'
	}),
	problemMailSittingRecipientUnavailable: defineMessage({
		id: 'administration.code.problem.mail.sitting.recipient.unavailable',
		defaultMessage: 'A recipient of the sitting’s email isn’t available.',
		description:
			'Why the server refused or stopped something, for the code `mail.sitting.recipient_unavailable`.'
	}),
	problemMailSittingUnavailable: defineMessage({
		id: 'administration.code.problem.mail.sitting.unavailable',
		defaultMessage: 'The sitting isn’t available for email.',
		description:
			'Why the server refused or stopped something, for the code `mail.sitting.unavailable`.'
	}),
	problemMailTransportAcceptanceUncertain: defineMessage({
		id: 'administration.code.problem.mail.transport.acceptance.uncertain',
		defaultMessage: 'The mail server may not have accepted it.',
		description:
			'Why the server refused or stopped something, for the code `mail.transport.acceptance_uncertain`.'
	}),
	problemMailTransportPermanent: defineMessage({
		id: 'administration.code.problem.mail.transport.permanent',
		defaultMessage: 'The receiving server refused it for good.',
		description:
			'Why the server refused or stopped something, for the code `mail.transport.permanent`.'
	}),
	problemMailTransportTemporary: defineMessage({
		id: 'administration.code.problem.mail.transport.temporary',
		defaultMessage: 'The receiving server asked to try again later.',
		description:
			'Why the server refused or stopped something, for the code `mail.transport.temporary`.'
	}),
	problemMailTransportUnknown: defineMessage({
		id: 'administration.code.problem.mail.transport.unknown',
		defaultMessage: 'The mail server gave an unknown answer.',
		description:
			'Why the server refused or stopped something, for the code `mail.transport.unknown`.'
	}),
	problemMailUnavailable: defineMessage({
		id: 'administration.code.problem.mail.unavailable',
		defaultMessage: 'Email can’t be sent right now.',
		description: 'Why the server refused or stopped something, for the code `mail.unavailable`.'
	}),
	problemMfaRekeyFenced: defineMessage({
		id: 'administration.code.problem.mfa.rekey.fenced',
		defaultMessage: 'Another key rotation took over.',
		description: 'Why the server refused or stopped something, for the code `mfa.rekey.fenced`.'
	}),
	problemMfaRekeyIncomplete: defineMessage({
		id: 'administration.code.problem.mfa.rekey.incomplete',
		defaultMessage: 'Not every two-step secret was resealed.',
		description:
			'Why the server refused or stopped something, for the code `mfa.rekey.incomplete`.'
	}),
	problemMfaRekeyInvariantFailed: defineMessage({
		id: 'administration.code.problem.mfa.rekey.invariant.failed',
		defaultMessage: 'Key rotation stopped to keep two-step secrets consistent.',
		description:
			'Why the server refused or stopped something, for the code `mfa.rekey.invariant_failed`.'
	}),
	problemMfaRekeyPrimaryMismatch: defineMessage({
		id: 'administration.code.problem.mfa.rekey.primary.mismatch',
		defaultMessage: 'The primary two-step key changed during rotation.',
		description:
			'Why the server refused or stopped something, for the code `mfa.rekey.primary_mismatch`.'
	}),
	problemMfaRekeySecretUnavailable: defineMessage({
		id: 'administration.code.problem.mfa.rekey.secret.unavailable',
		defaultMessage: 'Some two-step secrets couldn’t be read.',
		description:
			'Why the server refused or stopped something, for the code `mfa.rekey.secret_unavailable`.'
	}),
	problemOnboardingBatchDuplicate: defineMessage({
		id: 'administration.code.problem.onboarding.batch.duplicate',
		defaultMessage: 'Appears more than once in this list.',
		description:
			'Why the server refused or stopped something, for the code `onboarding_batch.duplicate`.'
	}),
	problemOnboardingImportAuthorizationLost: defineMessage({
		id: 'administration.code.problem.onboarding.import.authorization.lost',
		defaultMessage: 'You lost access while the import ran.',
		description:
			'Why the server refused or stopped something, for the code `onboarding_import.authorization_lost`.'
	}),
	problemOnboardingImportFileInvalid: defineMessage({
		id: 'administration.code.problem.onboarding.import.file.invalid',
		defaultMessage: 'The file couldn’t be read as CSV.',
		description:
			'Why the server refused or stopped something, for the code `onboarding_import.file_invalid`.'
	}),
	problemRequestInvalid: defineMessage({
		id: 'administration.code.problem.request.invalid',
		defaultMessage: 'Something in this request isn’t valid.',
		description: 'Why the server refused or stopped something, for the code `request.invalid`.'
	}),
	problemResourceNotFound: defineMessage({
		id: 'administration.code.problem.resource.not.found',
		defaultMessage: 'No longer exists, or you can’t see it.',
		description:
			'Why the server refused or stopped something, for the code `resource.not_found`.'
	}),
	problemRetentionUnavailable: defineMessage({
		id: 'administration.code.problem.retention.unavailable',
		defaultMessage: 'Retention isn’t available right now.',
		description:
			'Why the server refused or stopped something, for the code `retention.unavailable`.'
	}),
	problemRoleBindingConflict: defineMessage({
		id: 'administration.code.problem.role.binding.conflict',
		defaultMessage: 'Already has this role here.',
		description:
			'Why the server refused or stopped something, for the code `role_binding.conflict`.'
	}),
	problemRoleBindingInvalid: defineMessage({
		id: 'administration.code.problem.role.binding.invalid',
		defaultMessage: 'This role can’t be granted here.',
		description:
			'Why the server refused or stopped something, for the code `role_binding.invalid`.'
	}),
	problemRoleBindingLastSystemAdmin: defineMessage({
		id: 'administration.code.problem.role.binding.last.system.admin',
		defaultMessage: 'Is the last system administrator, so this role must stay.',
		description:
			'Why the server refused or stopped something, for the code `role_binding.last_system_admin`.'
	}),
	problemRoleBindingSystemAdminScopeInvalid: defineMessage({
		id: 'administration.code.problem.role.binding.system.admin.scope.invalid',
		defaultMessage: 'System administrator can only be granted institution-wide.',
		description:
			'Why the server refused or stopped something, for the code `role_binding.system_admin_scope_invalid`.'
	}),
	problemSessionNotFound: defineMessage({
		id: 'administration.code.problem.session.not.found',
		defaultMessage: 'Has no sessions to end.',
		description:
			'Why the server refused or stopped something, for the code `session.not_found`.'
	}),
	problemStudentProgressionAuthorizationLost: defineMessage({
		id: 'administration.code.problem.student.progression.authorization.lost',
		defaultMessage: 'You lost access while the progression ran.',
		description:
			'Why the server refused or stopped something, for the code `student_progression.authorization_lost`.'
	}),
	problemStudentProgressionConflict: defineMessage({
		id: 'administration.code.problem.student.progression.conflict',
		defaultMessage: 'Another progression already moves these students.',
		description:
			'Why the server refused or stopped something, for the code `student_progression.conflict`.'
	}),
	problemStudentProgressionDestinationConflict: defineMessage({
		id: 'administration.code.problem.student.progression.destination.conflict',
		defaultMessage: 'Already enrolled in the class they’d move to.',
		description:
			'Why the server refused or stopped something, for the code `student_progression.destination_conflict`.'
	}),
	problemStudentProgressionDestinationExists: defineMessage({
		id: 'administration.code.problem.student.progression.destination.exists',
		defaultMessage: 'Already enrolled in the class they’d move to.',
		description:
			'Why the server refused or stopped something, for the code `student_progression.destination_exists`.'
	}),
	problemStudentProgressionEffectiveDateConflict: defineMessage({
		id: 'administration.code.problem.student.progression.effective.date.conflict',
		defaultMessage: 'The move date clashes with an enrolment.',
		description:
			'Why the server refused or stopped something, for the code `student_progression.effective_date_conflict`.'
	}),
	problemStudentProgressionIneligibleTarget: defineMessage({
		id: 'administration.code.problem.student.progression.ineligible.target',
		defaultMessage: 'Can’t move to that class.',
		description:
			'Why the server refused or stopped something, for the code `student_progression.ineligible_target`.'
	}),
	problemStudentProgressionLineageConflict: defineMessage({
		id: 'administration.code.problem.student.progression.lineage.conflict',
		defaultMessage: 'The classes aren’t in a sequence a progression can follow.',
		description:
			'Why the server refused or stopped something, for the code `student_progression.lineage_conflict`.'
	}),
	problemStudentProgressionRosterTooLarge: defineMessage({
		id: 'administration.code.problem.student.progression.roster.too.large',
		defaultMessage: 'The class has too many students for one progression.',
		description:
			'Why the server refused or stopped something, for the code `student_progression.roster_too_large`.'
	}),
	problemStudentProgressionTargetConflict: defineMessage({
		id: 'administration.code.problem.student.progression.target.conflict',
		defaultMessage: 'The class they’d move to changed.',
		description:
			'Why the server refused or stopped something, for the code `student_progression.target_conflict`.'
	}),
	problemUserConflict: defineMessage({
		id: 'administration.code.problem.user.conflict',
		defaultMessage: 'Clashes with another account.',
		description: 'Why the server refused or stopped something, for the code `user.conflict`.'
	}),
	problemUserInvalid: defineMessage({
		id: 'administration.code.problem.user.invalid',
		defaultMessage: 'This account change isn’t valid.',
		description: 'Why the server refused or stopped something, for the code `user.invalid`.'
	}),
	problemUserLastSystemAdmin: defineMessage({
		id: 'administration.code.problem.user.last.system.admin',
		defaultMessage: 'Is the last system administrator, so the account must stay enabled.',
		description:
			'Why the server refused or stopped something, for the code `user.last_system_admin`.'
	}),
	problemUserNotFound: defineMessage({
		id: 'administration.code.problem.user.not.found',
		defaultMessage: 'The account no longer exists.',
		description: 'Why the server refused or stopped something, for the code `user.not_found`.'
	})
});

export const jobTypeMessages = Object.freeze({
	jobTypeAuditAttemptSweep: defineMessage({
		id: 'administration.code.job.audit.attempt.sweep',
		defaultMessage: 'Audit sweep',
		description: 'A kind of background job, for `audit.attempt_sweep`.'
	}),
	jobTypeCommandOutcomeCleanup: defineMessage({
		id: 'administration.code.job.command.outcome.cleanup',
		defaultMessage: 'Command cleanup',
		description: 'A kind of background job, for `command_outcome.cleanup`.'
	}),
	jobTypeExamExportBuild: defineMessage({
		id: 'administration.code.job.exam.export.build',
		defaultMessage: 'Exam export',
		description: 'A kind of background job, for `exam_export.build`.'
	}),
	jobTypeExamExportCleanup: defineMessage({
		id: 'administration.code.job.exam.export.cleanup',
		defaultMessage: 'Export cleanup',
		description: 'A kind of background job, for `exam_export.cleanup`.'
	}),
	jobTypeExamSittingLifecycle: defineMessage({
		id: 'administration.code.job.exam.sitting.lifecycle',
		defaultMessage: 'Sitting schedule',
		description: 'A kind of background job, for `exam_sitting.lifecycle`.'
	}),
	jobTypeExamSittingLifecycleRecovery: defineMessage({
		id: 'administration.code.job.exam.sitting.lifecycle.recovery',
		defaultMessage: 'Sitting recovery',
		description: 'A kind of background job, for `exam_sitting.lifecycle_recovery`.'
	}),
	jobTypeExamSittingSealing: defineMessage({
		id: 'administration.code.job.exam.sitting.sealing',
		defaultMessage: 'Sitting sealing',
		description: 'A kind of background job, for `exam_sitting.sealing`.'
	}),
	jobTypeFilePurgeExpiredContent: defineMessage({
		id: 'administration.code.job.file.purge.expired.content',
		defaultMessage: 'File cleanup',
		description: 'A kind of background job, for `file.purge_expired_content`.'
	}),
	jobTypeInvitationMaintenance: defineMessage({
		id: 'administration.code.job.invitation.maintenance',
		defaultMessage: 'Invitation upkeep',
		description: 'A kind of background job, for `invitation.maintenance`.'
	}),
	jobTypeJobCleanup: defineMessage({
		id: 'administration.code.job.job.cleanup',
		defaultMessage: 'Job cleanup',
		description: 'A kind of background job, for `job.cleanup`.'
	}),
	jobTypeMailCleanup: defineMessage({
		id: 'administration.code.job.mail.cleanup',
		defaultMessage: 'Mail cleanup',
		description: 'A kind of background job, for `mail.cleanup`.'
	}),
	jobTypeMailDeliver: defineMessage({
		id: 'administration.code.job.mail.deliver',
		defaultMessage: 'Email delivery',
		description: 'A kind of background job, for `mail.deliver`.'
	}),
	jobTypeMailDeliverCredential: defineMessage({
		id: 'administration.code.job.mail.deliver.credential',
		defaultMessage: 'Sign-in email',
		description: 'A kind of background job, for `mail.deliver_credential`.'
	}),
	jobTypeMailExpandSitting: defineMessage({
		id: 'administration.code.job.mail.expand.sitting',
		defaultMessage: 'Sitting email',
		description: 'A kind of background job, for `mail.expand_sitting`.'
	}),
	jobTypeMailRekey: defineMessage({
		id: 'administration.code.job.mail.rekey',
		defaultMessage: 'Mail key rotation',
		description: 'A kind of background job, for `mail.rekey`.'
	}),
	jobTypeMfaRekey: defineMessage({
		id: 'administration.code.job.mfa.rekey',
		defaultMessage: 'Two-step key rotation',
		description: 'A kind of background job, for `mfa.rekey`.'
	}),
	jobTypeOnboardingImportExecute: defineMessage({
		id: 'administration.code.job.onboarding.import.execute',
		defaultMessage: 'Onboarding import',
		description: 'A kind of background job, for `onboarding_import.execute`.'
	}),
	jobTypeOnboardingImportParse: defineMessage({
		id: 'administration.code.job.onboarding.import.parse',
		defaultMessage: 'Import check',
		description: 'A kind of background job, for `onboarding_import.parse`.'
	}),
	jobTypeProfilePictureGenerateDefault: defineMessage({
		id: 'administration.code.job.profile.picture.generate.default',
		defaultMessage: 'Profile photo',
		description: 'A kind of background job, for `profile_picture.generate_default`.'
	}),
	jobTypeProfilePictureReconcileDefaults: defineMessage({
		id: 'administration.code.job.profile.picture.reconcile.defaults',
		defaultMessage: 'Photo upkeep',
		description: 'A kind of background job, for `profile_picture.reconcile_defaults`.'
	}),
	jobTypeRetentionExpire: defineMessage({
		id: 'administration.code.job.retention.expire',
		defaultMessage: 'Retention expiry',
		description: 'A kind of background job, for `retention.expire`.'
	}),
	jobTypeRetentionNotices: defineMessage({
		id: 'administration.code.job.retention.notices',
		defaultMessage: 'Retention notices',
		description: 'A kind of background job, for `retention.notices`.'
	}),
	jobTypeRetentionPurge: defineMessage({
		id: 'administration.code.job.retention.purge',
		defaultMessage: 'Record cleanup',
		description: 'A kind of background job, for `retention.purge`.'
	}),
	jobTypeRetentionReconcile: defineMessage({
		id: 'administration.code.job.retention.reconcile',
		defaultMessage: 'Retention check',
		description: 'A kind of background job, for `retention.reconcile`.'
	}),
	jobTypeSessionPurgeRetired: defineMessage({
		id: 'administration.code.job.session.purge.retired',
		defaultMessage: 'Session cleanup',
		description: 'A kind of background job, for `session.purge_retired`.'
	}),
	jobTypeStudentProgressionPreview: defineMessage({
		id: 'administration.code.job.student.progression.preview',
		defaultMessage: 'Progression check',
		description: 'A kind of background job, for `student_progression.preview`.'
	})
});

export const jobStageMessages = Object.freeze({
	jobStageCompleted: defineMessage({
		id: 'administration.code.stage.completed',
		defaultMessage: 'Finished',
		description: 'How far a background job got, for `completed`.'
	}),
	jobStageExecuting: defineMessage({
		id: 'administration.code.stage.executing',
		defaultMessage: 'Running',
		description: 'How far a background job got, for `executing`.'
	}),
	jobStageExpanding: defineMessage({
		id: 'administration.code.stage.expanding',
		defaultMessage: 'Preparing',
		description: 'How far a background job got, for `expanding`.'
	}),
	jobStagePurging: defineMessage({
		id: 'administration.code.stage.purging',
		defaultMessage: 'Deleting',
		description: 'How far a background job got, for `purging`.'
	}),
	jobStageReconciling: defineMessage({
		id: 'administration.code.stage.reconciling',
		defaultMessage: 'Checking',
		description: 'How far a background job got, for `reconciling`.'
	}),
	jobStageReencrypting: defineMessage({
		id: 'administration.code.stage.reencrypting',
		defaultMessage: 'Re-encrypting',
		description: 'How far a background job got, for `reencrypting`.'
	}),
	jobStageResealing: defineMessage({
		id: 'administration.code.stage.resealing',
		defaultMessage: 'Resealing',
		description: 'How far a background job got, for `resealing`.'
	}),
	jobStageSealing: defineMessage({
		id: 'administration.code.stage.sealing',
		defaultMessage: 'Sealing',
		description: 'How far a background job got, for `sealing`.'
	})
});

export const mailTemplateMessages = Object.freeze({
	mailKindAcademicAcademicUnitAssigned: defineMessage({
		id: 'administration.code.mail.academic.academic.unit.assigned',
		defaultMessage: 'Unit membership',
		description: 'A kind of email Proctor sends, for `academic.academic_unit_assigned`.'
	}),
	mailKindAcademicAcademicUnitAssignmentEnded: defineMessage({
		id: 'administration.code.mail.academic.academic.unit.assignment.ended',
		defaultMessage: 'Unit membership ended',
		description: 'A kind of email Proctor sends, for `academic.academic_unit_assignment_ended`.'
	}),
	mailKindAcademicClassEnrolled: defineMessage({
		id: 'administration.code.mail.academic.class.enrolled',
		defaultMessage: 'Class enrolment',
		description: 'A kind of email Proctor sends, for `academic.class_enrolled`.'
	}),
	mailKindAcademicClassEnrollmentEnded: defineMessage({
		id: 'administration.code.mail.academic.class.enrollment.ended',
		defaultMessage: 'Enrolment ended',
		description: 'A kind of email Proctor sends, for `academic.class_enrollment_ended`.'
	}),
	mailKindAcademicClassTransferred: defineMessage({
		id: 'administration.code.mail.academic.class.transferred',
		defaultMessage: 'Class transfer',
		description: 'A kind of email Proctor sends, for `academic.class_transferred`.'
	}),
	mailKindAccessAcademicUnitRoleInvitation: defineMessage({
		id: 'administration.code.mail.access.academic.unit.role.invitation',
		defaultMessage: 'Invitation',
		description: 'A kind of email Proctor sends, for `access.academic_unit_role_invitation`.'
	}),
	mailKindAccessInstitutionRoleInvitation: defineMessage({
		id: 'administration.code.mail.access.institution.role.invitation',
		defaultMessage: 'Invitation',
		description: 'A kind of email Proctor sends, for `access.institution_role_invitation`.'
	}),
	mailKindAccessInvitationAccepted: defineMessage({
		id: 'administration.code.mail.access.invitation.accepted',
		defaultMessage: 'Invitation accepted',
		description: 'A kind of email Proctor sends, for `access.invitation_accepted`.'
	}),
	mailKindAccessInvitationRevoked: defineMessage({
		id: 'administration.code.mail.access.invitation.revoked',
		defaultMessage: 'Invitation withdrawn',
		description: 'A kind of email Proctor sends, for `access.invitation_revoked`.'
	}),
	mailKindAccessStudentClassInvitation: defineMessage({
		id: 'administration.code.mail.access.student.class.invitation',
		defaultMessage: 'Invitation',
		description: 'A kind of email Proctor sends, for `access.student_class_invitation`.'
	}),
	mailKindAccessTeacherAcademicUnitInvitation: defineMessage({
		id: 'administration.code.mail.access.teacher.academic.unit.invitation',
		defaultMessage: 'Invitation',
		description: 'A kind of email Proctor sends, for `access.teacher_academic_unit_invitation`.'
	}),
	mailKindAuthorizationInstitutionRoleAssigned: defineMessage({
		id: 'administration.code.mail.authorization.institution.role.assigned',
		defaultMessage: 'Role granted',
		description: 'A kind of email Proctor sends, for `authorization.institution_role_assigned`.'
	}),
	mailKindAuthorizationInstitutionRoleEnded: defineMessage({
		id: 'administration.code.mail.authorization.institution.role.ended',
		defaultMessage: 'Role ended',
		description: 'A kind of email Proctor sends, for `authorization.institution_role_ended`.'
	}),
	mailKindAuthorizationScopedRoleAssigned: defineMessage({
		id: 'administration.code.mail.authorization.scoped.role.assigned',
		defaultMessage: 'Role granted',
		description: 'A kind of email Proctor sends, for `authorization.scoped_role_assigned`.'
	}),
	mailKindAuthorizationScopedRoleEnded: defineMessage({
		id: 'administration.code.mail.authorization.scoped.role.ended',
		defaultMessage: 'Role ended',
		description: 'A kind of email Proctor sends, for `authorization.scoped_role_ended`.'
	}),
	mailKindExamManagerAdded: defineMessage({
		id: 'administration.code.mail.exam.manager.added',
		defaultMessage: 'Exam manager added',
		description: 'A kind of email Proctor sends, for `exam.manager_added`.'
	}),
	mailKindExamManagerRemoved: defineMessage({
		id: 'administration.code.mail.exam.manager.removed',
		defaultMessage: 'Exam manager removed',
		description: 'A kind of email Proctor sends, for `exam.manager_removed`.'
	}),
	mailKindExamOwnershipTransferredFromYou: defineMessage({
		id: 'administration.code.mail.exam.ownership.transferred.from.you',
		defaultMessage: 'Exam handed over',
		description: 'A kind of email Proctor sends, for `exam.ownership_transferred_from_you`.'
	}),
	mailKindExamOwnershipTransferredToYou: defineMessage({
		id: 'administration.code.mail.exam.ownership.transferred.to.you',
		defaultMessage: 'Exam handed over',
		description: 'A kind of email Proctor sends, for `exam.ownership_transferred_to_you`.'
	}),
	mailKindExamResultReleased: defineMessage({
		id: 'administration.code.mail.exam.result.released',
		defaultMessage: 'Result released',
		description: 'A kind of email Proctor sends, for `exam.result_released`.'
	}),
	mailKindExamRetentionScheduled: defineMessage({
		id: 'administration.code.mail.exam.retention.scheduled',
		defaultMessage: 'Records cleanup notice',
		description: 'A kind of email Proctor sends, for `exam.retention_scheduled`.'
	}),
	mailKindExamSittingAssignmentRemoved: defineMessage({
		id: 'administration.code.mail.exam.sitting.assignment.removed',
		defaultMessage: 'Sitting removed',
		description: 'A kind of email Proctor sends, for `exam.sitting_assignment_removed`.'
	}),
	mailKindExamSittingCanceled: defineMessage({
		id: 'administration.code.mail.exam.sitting.canceled',
		defaultMessage: 'Sitting cancelled',
		description: 'A kind of email Proctor sends, for `exam.sitting_canceled`.'
	}),
	mailKindExamSittingRescheduled: defineMessage({
		id: 'administration.code.mail.exam.sitting.rescheduled',
		defaultMessage: 'Sitting moved',
		description: 'A kind of email Proctor sends, for `exam.sitting_rescheduled`.'
	}),
	mailKindExamSittingScheduled: defineMessage({
		id: 'administration.code.mail.exam.sitting.scheduled',
		defaultMessage: 'Sitting scheduled',
		description: 'A kind of email Proctor sends, for `exam.sitting_scheduled`.'
	}),
	mailKindExamSubmissionAutomaticallySealed: defineMessage({
		id: 'administration.code.mail.exam.submission.automatically.sealed',
		defaultMessage: 'Submission sealed',
		description: 'A kind of email Proctor sends, for `exam.submission_automatically_sealed`.'
	}),
	mailKindExamSubmissionManagerEnded: defineMessage({
		id: 'administration.code.mail.exam.submission.manager.ended',
		defaultMessage: 'Submission ended',
		description: 'A kind of email Proctor sends, for `exam.submission_manager_ended`.'
	}),
	mailKindExamSubmissionReceived: defineMessage({
		id: 'administration.code.mail.exam.submission.received',
		defaultMessage: 'Submission received',
		description: 'A kind of email Proctor sends, for `exam.submission_received`.'
	}),
	mailKindIdentityAccountDisabled: defineMessage({
		id: 'administration.code.mail.identity.account.disabled',
		defaultMessage: 'Account disabled',
		description: 'A kind of email Proctor sends, for `identity.account_disabled`.'
	}),
	mailKindIdentityAccountEnabled: defineMessage({
		id: 'administration.code.mail.identity.account.enabled',
		defaultMessage: 'Account enabled',
		description: 'A kind of email Proctor sends, for `identity.account_enabled`.'
	}),
	mailKindIdentityEmailChangeVerifyNew: defineMessage({
		id: 'administration.code.mail.identity.email.change.verify.new',
		defaultMessage: 'Email change',
		description: 'A kind of email Proctor sends, for `identity.email_change_verify_new`.'
	}),
	mailKindIdentityEmailChangeWarningOld: defineMessage({
		id: 'administration.code.mail.identity.email.change.warning.old',
		defaultMessage: 'Email change notice',
		description: 'A kind of email Proctor sends, for `identity.email_change_warning_old`.'
	}),
	mailKindIdentityEmailVerifiedByAdmin: defineMessage({
		id: 'administration.code.mail.identity.email.verified.by.admin',
		defaultMessage: 'Email verified',
		description: 'A kind of email Proctor sends, for `identity.email_verified_by_admin`.'
	}),
	mailKindIdentityMfaDisabled: defineMessage({
		id: 'administration.code.mail.identity.mfa.disabled',
		defaultMessage: 'Two-step turned off',
		description: 'A kind of email Proctor sends, for `identity.mfa_disabled`.'
	}),
	mailKindIdentityMfaEnabled: defineMessage({
		id: 'administration.code.mail.identity.mfa.enabled',
		defaultMessage: 'Two-step turned on',
		description: 'A kind of email Proctor sends, for `identity.mfa_enabled`.'
	}),
	mailKindIdentityMfaRecoveryCodesRegenerated: defineMessage({
		id: 'administration.code.mail.identity.mfa.recovery.codes.regenerated',
		defaultMessage: 'New recovery codes',
		description: 'A kind of email Proctor sends, for `identity.mfa_recovery_codes_regenerated`.'
	}),
	mailKindIdentityMfaReset: defineMessage({
		id: 'administration.code.mail.identity.mfa.reset',
		defaultMessage: 'Two-step reset',
		description: 'A kind of email Proctor sends, for `identity.mfa_reset`.'
	}),
	mailKindIdentityPasswordChanged: defineMessage({
		id: 'administration.code.mail.identity.password.changed',
		defaultMessage: 'Password changed',
		description: 'A kind of email Proctor sends, for `identity.password_changed`.'
	}),
	mailKindIdentityPasswordReset: defineMessage({
		id: 'administration.code.mail.identity.password.reset',
		defaultMessage: 'Password reset',
		description: 'A kind of email Proctor sends, for `identity.password_reset`.'
	}),
	mailKindIdentityPersonalAccessTokenCreated: defineMessage({
		id: 'administration.code.mail.identity.personal.access.token.created',
		defaultMessage: 'Token created',
		description: 'A kind of email Proctor sends, for `identity.personal_access_token_created`.'
	}),
	mailKindIdentityPersonalAccessTokenDisabled: defineMessage({
		id: 'administration.code.mail.identity.personal.access.token.disabled',
		defaultMessage: 'Token turned off',
		description: 'A kind of email Proctor sends, for `identity.personal_access_token_disabled`.'
	}),
	mailKindIdentityPersonalAccessTokenEnabled: defineMessage({
		id: 'administration.code.mail.identity.personal.access.token.enabled',
		defaultMessage: 'Token turned on',
		description: 'A kind of email Proctor sends, for `identity.personal_access_token_enabled`.'
	}),
	mailKindIdentityPersonalAccessTokenRevoked: defineMessage({
		id: 'administration.code.mail.identity.personal.access.token.revoked',
		defaultMessage: 'Token revoked',
		description: 'A kind of email Proctor sends, for `identity.personal_access_token_revoked`.'
	}),
	mailKindIdentitySessionsRevokedByAdmin: defineMessage({
		id: 'administration.code.mail.identity.sessions.revoked.by.admin',
		defaultMessage: 'Signed out by an administrator',
		description: 'A kind of email Proctor sends, for `identity.sessions_revoked_by_admin`.'
	}),
	mailKindIdentityVerifyEmail: defineMessage({
		id: 'administration.code.mail.identity.verify.email',
		defaultMessage: 'Email verification',
		description: 'A kind of email Proctor sends, for `identity.verify_email`.'
	}),
	mailKindSystemMailTest: defineMessage({
		id: 'administration.code.mail.system.mail.test',
		defaultMessage: 'Test email',
		description: 'A kind of email Proctor sends, for `system.mail_test`.'
	})
});

type Keys<T> = keyof T & string;
const lookup = <T extends object>(entries: readonly (readonly [string, Keys<T>])[]) =>
	Object.freeze(Object.fromEntries(entries)) as Readonly<Record<string, Keys<T>>>;

/** The message for each code. */
export const problemCodes = lookup<typeof problemCodeMessages>([
	['academic_unit_member.conflict', 'problemAcademicUnitMemberConflict'],
	['academic_unit_member.invalid', 'problemAcademicUnitMemberInvalid'],
	['administration.unavailable', 'problemAdministrationUnavailable'],
	['affiliation.conflict', 'problemAffiliationConflict'],
	['affiliation.invalid', 'problemAffiliationInvalid'],
	['affiliation.student_has_active_enrollment', 'problemAffiliationStudentHasActiveEnrollment'],
	['audit.unavailable', 'problemAuditUnavailable'],
	['authentication.reauthentication_required', 'problemAuthenticationReauthenticationRequired'],
	['authentication.strong_required', 'problemAuthenticationStrongRequired'],
	['authentication.token_invalid', 'problemAuthenticationTokenInvalid'],
	['authorization.denied', 'problemAuthorizationDenied'],
	['authorization.request.invalid', 'problemAuthorizationRequestInvalid'],
	['authorization.unavailable', 'problemAuthorizationUnavailable'],
	['class.enrollment_conflict', 'problemClassEnrollmentConflict'],
	['class_member.invalid', 'problemClassMemberInvalid'],
	['class_member.student_affiliation_required', 'problemClassMemberStudentAffiliationRequired'],
	['database.unavailable', 'problemDatabaseUnavailable'],
	['dependency.unavailable', 'problemDependencyUnavailable'],
	['exam.export.expired', 'problemExamExportExpired'],
	['exam.export.unavailable', 'problemExamExportUnavailable'],
	['file.backend_unavailable', 'problemFileBackendUnavailable'],
	['idempotency.conflict', 'problemIdempotencyConflict'],
	['idempotency.in_progress', 'problemIdempotencyInProgress'],
	['invitation.class_period_conflict', 'problemInvitationClassPeriodConflict'],
	['invitation.conflict', 'problemInvitationConflict'],
	['invitation.invalid', 'problemInvitationInvalid'],
	['invitation.mail_unavailable', 'problemInvitationMailUnavailable'],
	['invitation.role_not_delegable', 'problemInvitationRoleNotDelegable'],
	['invitation.unavailable', 'problemInvitationUnavailable'],
	['job.canceled', 'problemJobCanceled'],
	['job.checkpoint.invalid', 'problemJobCheckpointInvalid'],
	['job.command.invalid', 'problemJobCommandInvalid'],
	['job.invariant_failed', 'problemJobInvariantFailed'],
	['mail.delivery.canceled', 'problemMailDeliveryCanceled'],
	['mail.delivery.conflict', 'problemMailDeliveryConflict'],
	['mail.delivery.expired', 'problemMailDeliveryExpired'],
	['mail.delivery.failed', 'problemMailDeliveryFailed'],
	['mail.delivery.not_found', 'problemMailDeliveryNotFound'],
	['mail.delivery.obsolete', 'problemMailDeliveryObsolete'],
	['mail.delivery.recipient_ineligible', 'problemMailDeliveryRecipientIneligible'],
	['mail.delivery.suppressed_disabled', 'problemMailDeliverySuppressedDisabled'],
	['mail.delivery.unavailable', 'problemMailDeliveryUnavailable'],
	['mail.message.invalid', 'problemMailMessageInvalid'],
	['mail.operator.retry', 'problemMailOperatorRetry'],
	['mail.payload.unavailable', 'problemMailPayloadUnavailable'],
	['mail.rekey.fenced', 'problemMailRekeyFenced'],
	['mail.rekey.incomplete', 'problemMailRekeyIncomplete'],
	['mail.rekey.invariant_failed', 'problemMailRekeyInvariantFailed'],
	['mail.rekey.payload_unavailable', 'problemMailRekeyPayloadUnavailable'],
	['mail.rekey.primary_mismatch', 'problemMailRekeyPrimaryMismatch'],
	['mail.sitting.bundle_unavailable', 'problemMailSittingBundleUnavailable'],
	['mail.sitting.invalid', 'problemMailSittingInvalid'],
	['mail.sitting.recipient_unavailable', 'problemMailSittingRecipientUnavailable'],
	['mail.sitting.unavailable', 'problemMailSittingUnavailable'],
	['mail.transport.acceptance_uncertain', 'problemMailTransportAcceptanceUncertain'],
	['mail.transport.permanent', 'problemMailTransportPermanent'],
	['mail.transport.temporary', 'problemMailTransportTemporary'],
	['mail.transport.unknown', 'problemMailTransportUnknown'],
	['mail.unavailable', 'problemMailUnavailable'],
	['mfa.rekey.fenced', 'problemMfaRekeyFenced'],
	['mfa.rekey.incomplete', 'problemMfaRekeyIncomplete'],
	['mfa.rekey.invariant_failed', 'problemMfaRekeyInvariantFailed'],
	['mfa.rekey.primary_mismatch', 'problemMfaRekeyPrimaryMismatch'],
	['mfa.rekey.secret_unavailable', 'problemMfaRekeySecretUnavailable'],
	['onboarding_batch.duplicate', 'problemOnboardingBatchDuplicate'],
	['onboarding_import.authorization_lost', 'problemOnboardingImportAuthorizationLost'],
	['onboarding_import.file_invalid', 'problemOnboardingImportFileInvalid'],
	['request.invalid', 'problemRequestInvalid'],
	['resource.not_found', 'problemResourceNotFound'],
	['retention.unavailable', 'problemRetentionUnavailable'],
	['role_binding.conflict', 'problemRoleBindingConflict'],
	['role_binding.invalid', 'problemRoleBindingInvalid'],
	['role_binding.last_system_admin', 'problemRoleBindingLastSystemAdmin'],
	['role_binding.system_admin_scope_invalid', 'problemRoleBindingSystemAdminScopeInvalid'],
	['session.not_found', 'problemSessionNotFound'],
	['student_progression.authorization_lost', 'problemStudentProgressionAuthorizationLost'],
	['student_progression.conflict', 'problemStudentProgressionConflict'],
	['student_progression.destination_conflict', 'problemStudentProgressionDestinationConflict'],
	['student_progression.destination_exists', 'problemStudentProgressionDestinationExists'],
	[
		'student_progression.effective_date_conflict',
		'problemStudentProgressionEffectiveDateConflict'
	],
	['student_progression.ineligible_target', 'problemStudentProgressionIneligibleTarget'],
	['student_progression.lineage_conflict', 'problemStudentProgressionLineageConflict'],
	['student_progression.roster_too_large', 'problemStudentProgressionRosterTooLarge'],
	['student_progression.target_conflict', 'problemStudentProgressionTargetConflict'],
	['user.conflict', 'problemUserConflict'],
	['user.invalid', 'problemUserInvalid'],
	['user.last_system_admin', 'problemUserLastSystemAdmin'],
	['user.not_found', 'problemUserNotFound']
]);

/** The message for each code. */
export const jobTypes = lookup<typeof jobTypeMessages>([
	['audit.attempt_sweep', 'jobTypeAuditAttemptSweep'],
	['command_outcome.cleanup', 'jobTypeCommandOutcomeCleanup'],
	['exam_export.build', 'jobTypeExamExportBuild'],
	['exam_export.cleanup', 'jobTypeExamExportCleanup'],
	['exam_sitting.lifecycle', 'jobTypeExamSittingLifecycle'],
	['exam_sitting.lifecycle_recovery', 'jobTypeExamSittingLifecycleRecovery'],
	['exam_sitting.sealing', 'jobTypeExamSittingSealing'],
	['file.purge_expired_content', 'jobTypeFilePurgeExpiredContent'],
	['invitation.maintenance', 'jobTypeInvitationMaintenance'],
	['job.cleanup', 'jobTypeJobCleanup'],
	['mail.cleanup', 'jobTypeMailCleanup'],
	['mail.deliver', 'jobTypeMailDeliver'],
	['mail.deliver_credential', 'jobTypeMailDeliverCredential'],
	['mail.expand_sitting', 'jobTypeMailExpandSitting'],
	['mail.rekey', 'jobTypeMailRekey'],
	['mfa.rekey', 'jobTypeMfaRekey'],
	['onboarding_import.execute', 'jobTypeOnboardingImportExecute'],
	['onboarding_import.parse', 'jobTypeOnboardingImportParse'],
	['profile_picture.generate_default', 'jobTypeProfilePictureGenerateDefault'],
	['profile_picture.reconcile_defaults', 'jobTypeProfilePictureReconcileDefaults'],
	['retention.expire', 'jobTypeRetentionExpire'],
	['retention.notices', 'jobTypeRetentionNotices'],
	['retention.purge', 'jobTypeRetentionPurge'],
	['retention.reconcile', 'jobTypeRetentionReconcile'],
	['session.purge_retired', 'jobTypeSessionPurgeRetired'],
	['student_progression.preview', 'jobTypeStudentProgressionPreview']
]);

/** The message for each code. */
export const jobStages = lookup<typeof jobStageMessages>([
	['completed', 'jobStageCompleted'],
	['executing', 'jobStageExecuting'],
	['expanding', 'jobStageExpanding'],
	['purging', 'jobStagePurging'],
	['reconciling', 'jobStageReconciling'],
	['reencrypting', 'jobStageReencrypting'],
	['resealing', 'jobStageResealing'],
	['sealing', 'jobStageSealing']
]);

/** The message for each code. */
export const mailTemplates = lookup<typeof mailTemplateMessages>([
	['academic.academic_unit_assigned', 'mailKindAcademicAcademicUnitAssigned'],
	['academic.academic_unit_assignment_ended', 'mailKindAcademicAcademicUnitAssignmentEnded'],
	['academic.class_enrolled', 'mailKindAcademicClassEnrolled'],
	['academic.class_enrollment_ended', 'mailKindAcademicClassEnrollmentEnded'],
	['academic.class_transferred', 'mailKindAcademicClassTransferred'],
	['access.academic_unit_role_invitation', 'mailKindAccessAcademicUnitRoleInvitation'],
	['access.institution_role_invitation', 'mailKindAccessInstitutionRoleInvitation'],
	['access.invitation_accepted', 'mailKindAccessInvitationAccepted'],
	['access.invitation_revoked', 'mailKindAccessInvitationRevoked'],
	['access.student_class_invitation', 'mailKindAccessStudentClassInvitation'],
	['access.teacher_academic_unit_invitation', 'mailKindAccessTeacherAcademicUnitInvitation'],
	['authorization.institution_role_assigned', 'mailKindAuthorizationInstitutionRoleAssigned'],
	['authorization.institution_role_ended', 'mailKindAuthorizationInstitutionRoleEnded'],
	['authorization.scoped_role_assigned', 'mailKindAuthorizationScopedRoleAssigned'],
	['authorization.scoped_role_ended', 'mailKindAuthorizationScopedRoleEnded'],
	['exam.manager_added', 'mailKindExamManagerAdded'],
	['exam.manager_removed', 'mailKindExamManagerRemoved'],
	['exam.ownership_transferred_from_you', 'mailKindExamOwnershipTransferredFromYou'],
	['exam.ownership_transferred_to_you', 'mailKindExamOwnershipTransferredToYou'],
	['exam.result_released', 'mailKindExamResultReleased'],
	['exam.retention_scheduled', 'mailKindExamRetentionScheduled'],
	['exam.sitting_assignment_removed', 'mailKindExamSittingAssignmentRemoved'],
	['exam.sitting_canceled', 'mailKindExamSittingCanceled'],
	['exam.sitting_rescheduled', 'mailKindExamSittingRescheduled'],
	['exam.sitting_scheduled', 'mailKindExamSittingScheduled'],
	['exam.submission_automatically_sealed', 'mailKindExamSubmissionAutomaticallySealed'],
	['exam.submission_manager_ended', 'mailKindExamSubmissionManagerEnded'],
	['exam.submission_received', 'mailKindExamSubmissionReceived'],
	['identity.account_disabled', 'mailKindIdentityAccountDisabled'],
	['identity.account_enabled', 'mailKindIdentityAccountEnabled'],
	['identity.email_change_verify_new', 'mailKindIdentityEmailChangeVerifyNew'],
	['identity.email_change_warning_old', 'mailKindIdentityEmailChangeWarningOld'],
	['identity.email_verified_by_admin', 'mailKindIdentityEmailVerifiedByAdmin'],
	['identity.mfa_disabled', 'mailKindIdentityMfaDisabled'],
	['identity.mfa_enabled', 'mailKindIdentityMfaEnabled'],
	['identity.mfa_recovery_codes_regenerated', 'mailKindIdentityMfaRecoveryCodesRegenerated'],
	['identity.mfa_reset', 'mailKindIdentityMfaReset'],
	['identity.password_changed', 'mailKindIdentityPasswordChanged'],
	['identity.password_reset', 'mailKindIdentityPasswordReset'],
	['identity.personal_access_token_created', 'mailKindIdentityPersonalAccessTokenCreated'],
	['identity.personal_access_token_disabled', 'mailKindIdentityPersonalAccessTokenDisabled'],
	['identity.personal_access_token_enabled', 'mailKindIdentityPersonalAccessTokenEnabled'],
	['identity.personal_access_token_revoked', 'mailKindIdentityPersonalAccessTokenRevoked'],
	['identity.sessions_revoked_by_admin', 'mailKindIdentitySessionsRevokedByAdmin'],
	['identity.verify_email', 'mailKindIdentityVerifyEmail'],
	['system.mail_test', 'mailKindSystemMailTest']
]);
