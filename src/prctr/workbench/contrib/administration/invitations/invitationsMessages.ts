/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Invitations page and the Invite people dialog. */
export const invitationsMessages = Object.freeze({
	inviteTitle: defineMessage({
		id: 'administration.invitations.invite.title',
		defaultMessage: 'Invite people',
		description: 'Title of the dialog that sends invitations.'
	}),
	inviteBody: defineMessage({
		id: 'administration.invitations.invite.body',
		defaultMessage:
			'Each person gets an email with a link that works once. Invitations expire if they’re not accepted.',
		description: 'Description of the invitation dialog.'
	}),
	inviteKind: defineMessage({
		id: 'administration.invitations.invite.kind',
		defaultMessage: 'Invite',
		description: 'Label of the choice of what people are invited to.'
	}),
	inviteStudents: defineMessage({
		id: 'administration.invitations.invite.kind.students',
		defaultMessage: 'Students to a class',
		description: 'Invite choice: students join a class.'
	}),
	inviteTeachers: defineMessage({
		id: 'administration.invitations.invite.kind.teachers',
		defaultMessage: 'Teachers to a unit',
		description: 'Invite choice: teachers join an academic unit.'
	}),
	inviteRole: defineMessage({
		id: 'administration.invitations.invite.kind.role',
		defaultMessage: 'People to a role',
		description: 'Invite choice: people get an institution-wide role.'
	}),
	inviteEmails: defineMessage({
		id: 'administration.invitations.invite.emails',
		defaultMessage: 'Email addresses',
		description: 'Label of the box of email addresses.'
	}),
	inviteEmailsHint: defineMessage({
		id: 'administration.invitations.invite.emails.hint',
		defaultMessage:
			'One per line or separated by commas, up to 200. To invite more, import a CSV file.',
		description: 'Hint under the box of email addresses.'
	}),
	inviteEmailsInvalid: defineMessage({
		id: 'administration.invitations.invite.emails.invalid',
		defaultMessage: 'These aren’t email addresses: {addresses}',
		description: 'Error naming the entries that are not email addresses.'
	}),
	inviteEmailsTooMany: defineMessage({
		id: 'administration.invitations.invite.emails.too.many',
		defaultMessage:
			'That’s {count} addresses. Invite up to 200 at a time, or import a CSV file.',
		description: 'Error when more than 200 addresses are given.'
	}),
	inviteEmailsRequired: defineMessage({
		id: 'administration.invitations.invite.emails.required',
		defaultMessage: 'Enter at least one email address.',
		description: 'Error when no address is given.'
	}),
	inviteUnit: defineMessage({
		id: 'administration.invitations.invite.unit',
		defaultMessage: 'Unit',
		description: 'Label of the academic unit choice.'
	}),
	inviteClass: defineMessage({
		id: 'administration.invitations.invite.class',
		defaultMessage: 'Class',
		description: 'Label of the class choice.'
	}),
	inviteRoleLabel: defineMessage({
		id: 'administration.invitations.invite.role.label',
		defaultMessage: 'Role',
		description: 'Label of the role choice.'
	}),
	inviteChoose: defineMessage({
		id: 'administration.invitations.invite.choose',
		defaultMessage: 'Choose…',
		description: 'Placeholder choice before one is made.'
	}),
	inviteNoClasses: defineMessage({
		id: 'administration.invitations.invite.no.classes',
		defaultMessage: 'This unit has no classes.',
		description: 'Shown when the chosen unit has no classes.'
	}),
	inviteLoading: defineMessage({
		id: 'administration.invitations.invite.loading',
		defaultMessage: 'Loading choices…',
		description: 'Shown while units, classes or roles load.'
	}),
	inviteMore: defineMessage({
		id: 'administration.invitations.invite.more',
		defaultMessage: 'Only the first 50 are listed.',
		description: 'Shown when there are more choices than listed.'
	}),
	inviteSendOne: defineMessage({
		id: 'administration.invitations.invite.send.one',
		defaultMessage: 'Send 1 invitation',
		description: 'Send button for one address.'
	}),
	inviteSendMany: defineMessage({
		id: 'administration.invitations.invite.send.many',
		defaultMessage: 'Send {count} invitations',
		description: 'Send button; count is how many addresses.'
	}),
	inviteSendNone: defineMessage({
		id: 'administration.invitations.invite.send.none',
		defaultMessage: 'Send invitations',
		description: 'Send button before any address is entered.'
	}),
	inviteSentOne: defineMessage({
		id: 'administration.invitations.invite.sent.one',
		defaultMessage: 'Invitation sent',
		description: 'Toast after one invitation is sent.'
	}),
	inviteSentMany: defineMessage({
		id: 'administration.invitations.invite.sent.many',
		defaultMessage: '{count} invitations sent',
		description: 'Toast after invitations are sent; count is how many.'
	}),
	inviteSentBody: defineMessage({
		id: 'administration.invitations.invite.sent.body',
		defaultMessage: 'They’re listed under Invitations until accepted.',
		description: 'Toast body after invitations are sent.'
	}),
	invitePartly: defineMessage({
		id: 'administration.invitations.invite.partly',
		defaultMessage: '{sent} sent. These couldn’t be sent: {addresses}',
		description: 'Shown in the dialog when some invitations could not be sent.'
	}),
	invitationsFind: defineMessage({
		id: 'administration.invitations.find',
		defaultMessage: 'Find by exact email',
		description:
			'Search field above the list of invitations; the server matches whole addresses.'
	}),
	invitationsStatus: defineMessage({
		id: 'administration.invitations.filter.status',
		defaultMessage: 'Status',
		description: 'Invitations filter by state.'
	}),
	invitationsKind: defineMessage({
		id: 'administration.invitations.filter.kind',
		defaultMessage: 'Kind',
		description: 'Invitations filter by what people are invited to.'
	}),
	invitationsAny: defineMessage({
		id: 'administration.invitations.filter.any',
		defaultMessage: 'Any status',
		description: 'Status filter choice that shows every invitation.'
	}),
	invitationsAnyKind: defineMessage({
		id: 'administration.invitations.filter.any.kind',
		defaultMessage: 'Any kind',
		description: 'Kind filter choice that shows every invitation.'
	}),
	invitationStatePending: defineMessage({
		id: 'administration.invitations.state.pending',
		defaultMessage: 'Pending',
		description: 'Invitation not yet accepted.'
	}),
	invitationStateAccepted: defineMessage({
		id: 'administration.invitations.state.accepted',
		defaultMessage: 'Accepted',
		description: 'Invitation accepted.'
	}),
	invitationStateRevoked: defineMessage({
		id: 'administration.invitations.state.revoked',
		defaultMessage: 'Revoked',
		description: 'Invitation revoked.'
	}),
	invitationStateExpired: defineMessage({
		id: 'administration.invitations.state.expired',
		defaultMessage: 'Expired',
		description: 'Invitation expired.'
	}),
	invitationStateSuperseded: defineMessage({
		id: 'administration.invitations.state.superseded',
		defaultMessage: 'Replaced',
		description: 'Invitation replaced by a newer one.'
	}),
	invitationBounced: defineMessage({
		id: 'administration.invitations.state.bounced',
		defaultMessage: 'Not delivered',
		description: 'The invitation email could not be delivered.'
	}),
	invitationKindStudent: defineMessage({
		id: 'administration.invitations.kind.student',
		defaultMessage: 'Student in a class',
		description: 'Invitation to join a class as a student.'
	}),
	invitationKindTeacher: defineMessage({
		id: 'administration.invitations.kind.teacher',
		defaultMessage: 'Teacher in a unit',
		description: 'Invitation to teach in an academic unit.'
	}),
	invitationKindUnitRole: defineMessage({
		id: 'administration.invitations.kind.unit.role',
		defaultMessage: 'Role in a unit',
		description: 'Invitation to a role in an academic unit.'
	}),
	invitationKindInstitutionRole: defineMessage({
		id: 'administration.invitations.kind.institution.role',
		defaultMessage: 'Role at the institution',
		description: 'Invitation to an institution-wide role.'
	}),
	invitationsTable: defineMessage({
		id: 'administration.invitations.table',
		defaultMessage: 'Invitations',
		description: 'Accessible name of the table of invitations.'
	}),
	invitationsColumnInvitee: defineMessage({
		id: 'administration.invitations.column.invitee',
		defaultMessage: 'Invitee',
		description: 'Invitations column with the email address.'
	}),
	invitationsColumnKind: defineMessage({
		id: 'administration.invitations.column.kind',
		defaultMessage: 'Invited as',
		description: 'Invitations column with what they are invited to.'
	}),
	invitationsColumnExpires: defineMessage({
		id: 'administration.invitations.column.expires',
		defaultMessage: 'Expires',
		description: 'Invitations column with the expiry date.'
	}),
	invitationsColumnStatus: defineMessage({
		id: 'administration.invitations.column.status',
		defaultMessage: 'Status',
		description: 'Invitations column with the state.'
	}),
	invitationsEmpty: defineMessage({
		id: 'administration.invitations.empty',
		defaultMessage: 'No invitations yet. Invite people to add them here.',
		description: 'Invitations list with none at all.'
	}),
	invitationsNoMatch: defineMessage({
		id: 'administration.invitations.empty.filtered',
		defaultMessage: 'No invitations match these filters.',
		description: 'Invitations list with no matches.'
	}),
	invitationResend: defineMessage({
		id: 'administration.invitations.action.resend',
		defaultMessage: 'Resend email',
		description: 'Row action that sends the invitation email again.'
	}),
	invitationResent: defineMessage({
		id: 'administration.invitations.resent',
		defaultMessage: 'The invitation email was sent again to {email}',
		description: 'Toast after resending an invitation.'
	}),
	invitationRevoke: defineMessage({
		id: 'administration.invitations.action.revoke',
		defaultMessage: 'Revoke…',
		description: 'Row action that revokes an invitation after confirming.'
	}),
	invitationRevokeTitle: defineMessage({
		id: 'administration.invitations.revoke.title',
		defaultMessage: 'Revoke the invitation to {email}?',
		description: 'Confirmation title before revoking an invitation.'
	}),
	invitationRevokeBody: defineMessage({
		id: 'administration.invitations.revoke.body',
		defaultMessage: 'The link in their email stops working. You can invite them again later.',
		description: 'Confirmation body before revoking an invitation.'
	}),
	invitationRevokeConfirm: defineMessage({
		id: 'administration.invitations.revoke.confirm',
		defaultMessage: 'Revoke invitation',
		description: 'Confirms revoking an invitation.'
	}),
	invitationRevoked: defineMessage({
		id: 'administration.invitations.revoked',
		defaultMessage: 'The invitation to {email} is revoked',
		description: 'Toast after revoking an invitation.'
	}),
	inviteRemove: defineMessage({
		id: 'administration.invitations.invite.remove',
		defaultMessage: 'Remove {address}',
		description: 'Accessible name of a chip’s × in a list of addresses or people.'
	}),
	inviteAddAddress: defineMessage({
		id: 'administration.invitations.invite.add.address',
		defaultMessage: 'Add an address',
		description: 'Placeholder of the field that takes email addresses.'
	}),
	inviteChipsHint: defineMessage({
		id: 'administration.invitations.invite.chips.hint',
		defaultMessage:
			'Press Enter, a comma or a space after each address, or paste a list. Up to 200; to invite more, import a CSV file.',
		description: 'Hint under the email addresses.'
	}),
	inviteAddressIncomplete: defineMessage({
		id: 'administration.invitations.invite.address.incomplete',
		defaultMessage: 'This address is incomplete',
		description: 'Why an address chip is red.'
	}),
	inviteAddressesFix: defineMessage({
		id: 'administration.invitations.invite.addresses.fix',
		defaultMessage: 'Remove or correct the addresses in red first.',
		description: 'Error when some addresses aren’t valid.'
	}),
	inviteFootnoteOne: defineMessage({
		id: 'administration.invitations.invite.footnote.one',
		defaultMessage: '1 address',
		description: 'Footnote: how many addresses the dialog sends to. One.'
	}),
	inviteFootnote: defineMessage({
		id: 'administration.invitations.invite.footnote',
		defaultMessage: '{count} addresses',
		description: 'Footnote: how many addresses the dialog sends to. Two or more.'
	}),
	inviteFootnoteFix: defineMessage({
		id: 'administration.invitations.invite.footnote.fix',
		defaultMessage: '{addresses} · {fix} to fix',
		description: 'Footnote when some addresses need fixing, as in "3 addresses · 1 to fix".'
	}),
	inviteExpires: defineMessage({
		id: 'administration.invitations.invite.expires',
		defaultMessage: 'Expires',
		description: 'Label of how long an invitation stays open.'
	}),
	inviteExpiresIn: defineMessage({
		id: 'administration.invitations.invite.expires.in',
		defaultMessage: 'In {days} days · {date}',
		description: 'One choice of how long an invitation stays open, as in "In 14 days · 22 Nov".'
	}),
	invitationsColumnBy: defineMessage({
		id: 'administration.invitations.column.by',
		defaultMessage: 'Invited by',
		description: 'Invitations column naming who sent the invitation.'
	})
});
