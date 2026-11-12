/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Roles and Access policy pages. */
export const rolesMessages = Object.freeze({
	rolesNew: defineMessage({
		id: 'administration.access.new',
		defaultMessage: 'New role',
		description: 'Creates a custom role.'
	}),
	rolesList: defineMessage({
		id: 'administration.access.list',
		defaultMessage: 'Roles',
		description: 'Heading of the list of roles.'
	}),
	rolesNone: defineMessage({
		id: 'administration.access.none',
		defaultMessage: 'No roles.',
		description: 'Shown when there are no roles.'
	}),
	rolesChoose: defineMessage({
		id: 'administration.access.choose',
		defaultMessage: 'Choose a role to see what it allows.',
		description: 'Shown before a role is chosen.'
	}),
	rolesKind: defineMessage({
		id: 'administration.access.kind',
		defaultMessage: 'Type',
		description: 'Role detail.'
	}),
	rolesBuiltIn: defineMessage({
		id: 'administration.access.built.in',
		defaultMessage: 'Built-in role',
		description: 'A role that comes with Proctor and cannot be changed.'
	}),
	rolesCustom: defineMessage({
		id: 'administration.access.custom',
		defaultMessage: 'Custom role',
		description: 'A role the institution made.'
	}),
	rolesName: defineMessage({
		id: 'administration.access.name',
		defaultMessage: 'Name',
		description: 'Role detail: its identifier.'
	}),
	rolesPermissionCount: defineMessage({
		id: 'administration.access.permission.count',
		defaultMessage: 'Allows',
		description: 'Role detail: how many permissions it has.'
	}),
	rolesPermissionTotal: defineMessage({
		id: 'administration.access.permission.total',
		defaultMessage: '{count} permissions',
		description: 'How many permissions a role has.'
	}),
	rolesPermissions: defineMessage({
		id: 'administration.access.permissions',
		defaultMessage: 'Permissions',
		description: 'Section with what a role allows.'
	}),
	rolesPermissionsDescription: defineMessage({
		id: 'administration.access.permissions.description',
		defaultMessage: 'What people with this role can do, by area.',
		description: 'Description of the permissions section.'
	}),
	rolesNoPermissions: defineMessage({
		id: 'administration.access.permissions.none',
		defaultMessage: 'This role allows nothing yet.',
		description: 'A role with no permissions.'
	}),
	rolesArea: defineMessage({
		id: 'administration.access.area',
		defaultMessage: 'Area',
		description: 'Permissions column: what the permission is about.'
	}),
	rolesAllowed: defineMessage({
		id: 'administration.access.allowed',
		defaultMessage: 'Allowed',
		description: 'A permission the role has.'
	}),
	rolesNotAllowed: defineMessage({
		id: 'administration.access.not.allowed',
		defaultMessage: 'Not allowed',
		description: 'A permission the role lacks.'
	}),
	rolesEdit: defineMessage({
		id: 'administration.access.edit',
		defaultMessage: 'Edit',
		description: 'Edits a custom role.'
	}),
	rolesDelete: defineMessage({
		id: 'administration.access.delete',
		defaultMessage: 'Delete role',
		description: 'Deletes a custom role after confirming.'
	}),
	rolesDeleteTitle: defineMessage({
		id: 'administration.access.delete.title',
		defaultMessage: 'Delete {name}?',
		description: 'Confirmation title before deleting a role.'
	}),
	rolesDeleteBody: defineMessage({
		id: 'administration.access.delete.body',
		defaultMessage: 'People who hold it lose what it allows. Built-in roles are not affected.',
		description: 'Confirmation body before deleting a role.'
	}),
	rolesDeleteConfirm: defineMessage({
		id: 'administration.access.delete.confirm',
		defaultMessage: 'Delete role',
		description: 'Confirms deleting a role.'
	}),
	rolesDeleted: defineMessage({
		id: 'administration.access.deleted',
		defaultMessage: '{name} is deleted',
		description: 'Toast after deleting a role.'
	}),
	rolesNewTitle: defineMessage({
		id: 'administration.access.new.title',
		defaultMessage: 'New role',
		description: 'Title of the dialog that creates a role.'
	}),
	rolesEditTitle: defineMessage({
		id: 'administration.access.edit.title',
		defaultMessage: 'Edit {name}',
		description: 'Title of the dialog that edits a role.'
	}),
	rolesNameHint: defineMessage({
		id: 'administration.access.name.hint',
		defaultMessage: 'A short identifier such as teaching_assistant. It can’t change later.',
		description: 'Hint under a role’s identifier.'
	}),
	rolesPermissionsField: defineMessage({
		id: 'administration.access.permissions.field',
		defaultMessage: 'Permissions',
		description: 'Field: the permissions a role allows.'
	}),
	rolesPermissionsHint: defineMessage({
		id: 'administration.access.permissions.hint',
		defaultMessage:
			'Only permissions an existing role has are listed. System administrator permissions can’t be given to a custom role.',
		description: 'Hint under the permissions field.'
	}),
	rolesSaved: defineMessage({
		id: 'administration.access.saved',
		defaultMessage: '{name} is saved',
		description: 'Toast after a role is saved.'
	}),
	rolesBuiltInNote: defineMessage({
		id: 'administration.access.built.in.note',
		defaultMessage:
			'Built-in roles can’t be changed. Make a custom role to adjust what people can do.',
		description: 'Shown for a built-in role.'
	}),
	policyApply: defineMessage({
		id: 'administration.access.apply',
		defaultMessage: 'Apply changes',
		description: 'Applies the access policy after checking it.'
	}),
	policyDiscard: defineMessage({
		id: 'administration.access.discard',
		defaultMessage: 'Discard changes',
		description: 'Puts the access policy back as it was.'
	}),
	policySignIn: defineMessage({
		id: 'administration.access.sign.in',
		defaultMessage: 'Sign-in',
		description: 'Section with how people sign in.'
	}),
	policyLocalLogin: defineMessage({
		id: 'administration.access.local.login',
		defaultMessage: 'Passwords',
		description: 'Setting: people may sign in with a password.'
	}),
	policyLocalLoginDescription: defineMessage({
		id: 'administration.access.local.login.description',
		defaultMessage: 'People with a password can sign in with it.',
		description: 'Description of the password setting.'
	}),
	policyRegistration: defineMessage({
		id: 'administration.access.registration',
		defaultMessage: 'Open registration',
		description: 'Setting: anyone may create an account.'
	}),
	policyRegistrationDescription: defineMessage({
		id: 'administration.access.registration.description',
		defaultMessage: 'Anyone can create an account without an invitation.',
		description: 'Description of the open registration setting.'
	}),
	policyInvitations: defineMessage({
		id: 'administration.access.invitations',
		defaultMessage: 'Invitations',
		description: 'Setting: invitations let people join.'
	}),
	policyInvitationsDescription: defineMessage({
		id: 'administration.access.invitations.description',
		defaultMessage: 'People can join by accepting an invitation.',
		description: 'Description of the invitation setting.'
	}),
	policyInvitationPassword: defineMessage({
		id: 'administration.access.invitation.password',
		defaultMessage: 'Passwords for invited people',
		description: 'Setting: invited people may set a password.'
	}),
	policyInvitationPasswordDescription: defineMessage({
		id: 'administration.access.invitation.password.description',
		defaultMessage: 'Someone who accepts an invitation can choose a password.',
		description: 'Description of the setting.'
	}),
	policyDesktop: defineMessage({
		id: 'administration.access.desktop',
		defaultMessage: 'Proctor Desktop sign-in',
		description: 'Setting: people may sign in to Proctor Desktop.'
	}),
	policyDesktopDescription: defineMessage({
		id: 'administration.access.desktop.description',
		defaultMessage:
			'People can sign in to this app. Turning it off signs no one out of a sitting in progress.',
		description: 'Description of the Desktop sign-in setting.'
	}),
	policyProviders: defineMessage({
		id: 'administration.access.providers',
		defaultMessage: 'Sign-in providers',
		description: 'Section with single sign-on providers.'
	}),
	policyProvidersEmpty: defineMessage({
		id: 'administration.access.providers.empty',
		defaultMessage: 'No single sign-on providers are set up on the server.',
		description: 'Shown when there are no providers.'
	}),
	policyLinkedOnly: defineMessage({
		id: 'administration.access.linked.only',
		defaultMessage: 'Existing accounts only',
		description: 'Provider admission: only accounts already linked.'
	}),
	policyInvitationRequired: defineMessage({
		id: 'administration.access.invitation.required',
		defaultMessage: 'With an invitation',
		description: 'Provider admission: new people need an invitation.'
	}),
	policyAutoProvision: defineMessage({
		id: 'administration.access.auto.provision',
		defaultMessage: 'Anyone from the provider',
		description: 'Provider admission: anyone the provider signs in gets an account.'
	}),
	policyAfterApply: defineMessage({
		id: 'administration.access.after.apply',
		defaultMessage: 'When you apply',
		description: 'Section with what applying also does.'
	}),
	policyRevoke: defineMessage({
		id: 'administration.access.revoke',
		defaultMessage: 'Sign everyone out who no longer qualifies',
		description: 'Option: end sessions that the new policy would not allow.'
	}),
	policyPreviewing: defineMessage({
		id: 'administration.access.previewing',
		defaultMessage: 'You’re changing the access policy. Nothing happens until you apply it.',
		description: 'Banner while the policy has unapplied changes.'
	}),
	policyBlocked: defineMessage({
		id: 'administration.access.blocked',
		defaultMessage: 'This change can’t be applied: {reasons}',
		description: 'Shown when the server’s check finds problems.'
	}),
	policyBlockerProvider: defineMessage({
		id: 'administration.access.blocker.provider',
		defaultMessage: '{provider} isn’t available',
		description: 'A provider that cannot be used.'
	}),
	policyBlockerAdmission: defineMessage({
		id: 'administration.access.blocker.admission',
		defaultMessage: '{provider} can’t admit people that way',
		description: 'A provider that does not support the chosen admission.'
	}),
	policyBlockerMail: defineMessage({
		id: 'administration.access.blocker.mail',
		defaultMessage: 'invitations need mail, which isn’t set up',
		description: 'Invitations cannot work without mail.'
	}),
	policyBlockerAdmin: defineMessage({
		id: 'administration.access.blocker.admin',
		defaultMessage: 'no system administrator would be able to sign in',
		description: 'The change would lock out every administrator.'
	}),
	policyApplied: defineMessage({
		id: 'administration.access.applied',
		defaultMessage: 'The access policy is applied',
		description: 'Toast after applying the policy.'
	}),
	policyChecking: defineMessage({
		id: 'administration.access.checking',
		defaultMessage: 'Checking the change…',
		description: 'Shown while the server checks the policy.'
	}),
	policyHistory: defineMessage({
		id: 'administration.access.history',
		defaultMessage: 'Changes',
		description: 'Section with the policy’s past changes.'
	}),
	policyHistoryEmpty: defineMessage({
		id: 'administration.access.history.empty',
		defaultMessage: 'The policy hasn’t changed yet.',
		description: 'Shown when the policy has no history.'
	}),
	policyHistoryRow: defineMessage({
		id: 'administration.access.history.row',
		defaultMessage: 'Revision {revision}',
		description: 'A past change of the policy.'
	}),
	policyHistoryDetail: defineMessage({
		id: 'administration.access.history.detail',
		defaultMessage: '{fields} · {when}',
		description: 'Detail of a past change.'
	}),
	policyDesktopSection: defineMessage({
		id: 'administration.access.desktop.section',
		defaultMessage: 'Proctor Desktop',
		description: 'Section with the Desktop compatibility policy.'
	}),
	policyAvailability: defineMessage({
		id: 'administration.access.availability',
		defaultMessage: 'Availability',
		description: 'Desktop compatibility detail.'
	}),
	policyAvailable: defineMessage({
		id: 'administration.access.available',
		defaultMessage: 'Available',
		description: 'Proctor Desktop can be used.'
	}),
	policyMaintenance: defineMessage({
		id: 'administration.access.maintenance',
		defaultMessage: 'Under maintenance',
		description: 'Proctor Desktop is paused for maintenance.'
	}),
	policyMinimum: defineMessage({
		id: 'administration.access.minimum',
		defaultMessage: 'Oldest version allowed',
		description: 'Desktop compatibility detail.'
	}),
	policyRevoked: defineMessage({
		id: 'administration.access.revoked.builds',
		defaultMessage: 'Blocked builds',
		description: 'Desktop compatibility detail.'
	}),
	policyNone: defineMessage({
		id: 'administration.access.policy.none',
		defaultMessage: 'None',
		description: 'No value.'
	}),
	policyMessage: defineMessage({
		id: 'administration.access.message',
		defaultMessage: 'Message',
		description: 'Desktop compatibility detail: shown to people during maintenance.'
	}),
	policyDesktopEdit: defineMessage({
		id: 'administration.access.desktop.edit',
		defaultMessage: 'Edit',
		description: 'Edits the Desktop compatibility policy.'
	}),
	policyDesktopEditTitle: defineMessage({
		id: 'administration.access.desktop.edit.title',
		defaultMessage: 'Proctor Desktop policy',
		description: 'Title of the Desktop compatibility dialog.'
	}),
	policyRevokedHint: defineMessage({
		id: 'administration.access.revoked.hint',
		defaultMessage: 'Build identifiers, one per line.',
		description: 'Hint under the blocked builds field.'
	}),
	policyDesktopSaved: defineMessage({
		id: 'administration.access.desktop.saved',
		defaultMessage: 'The Proctor Desktop policy is saved',
		description: 'Toast after saving the Desktop compatibility policy.'
	}),
	policyStaffMfa: defineMessage({
		id: 'administration.policy.staff.mfa',
		defaultMessage: 'Two-step required for staff',
		description:
			'Access policy switch: everyone who holds a role must use two-step verification.'
	}),
	policyStaffMfaDescription: defineMessage({
		id: 'administration.policy.staff.mfa.description',
		defaultMessage: 'Anyone who holds a role, anywhere, signs in with a second step.',
		description: 'Explains the staff two-step switch.'
	}),
	policyStaffMfaWaiting: defineMessage({
		id: 'administration.policy.staff.mfa.waiting',
		defaultMessage:
			'Two-step verification is off on this server, so this waits until it’s turned on.',
		description: 'Shown when the rule is on but the server can’t enforce it yet.'
	}),
	policySessionIdle: defineMessage({
		id: 'administration.policy.session.idle',
		defaultMessage: 'Session ends after inactivity',
		description: 'Access policy choice: how long a sign-in lasts without activity.'
	}),
	policySessionIdleDescription: defineMessage({
		id: 'administration.policy.session.idle.description',
		defaultMessage: 'How long someone can be away before signing in again.',
		description: 'Explains the idle session length.'
	}),
	policySessionAbsolute: defineMessage({
		id: 'administration.policy.session.absolute',
		defaultMessage: 'Longest session',
		description: 'Access policy choice: the most a sign-in lasts, active or not.'
	}),
	policySessionAbsoluteDescription: defineMessage({
		id: 'administration.policy.session.absolute.description',
		defaultMessage: 'After this, everyone signs in again, however active they are.',
		description: 'Explains the overall session length.'
	}),
	policySessionDefault: defineMessage({
		id: 'administration.policy.session.default',
		defaultMessage: 'Default · {length}',
		description: 'The deployment’s default session length, as in "Default · 12 hours".'
	}),
	policyMinutes: defineMessage({
		id: 'administration.policy.minutes',
		defaultMessage: '{count} minutes',
		description: 'A session length in minutes.'
	}),
	policyHour: defineMessage({
		id: 'administration.policy.hours',
		defaultMessage: '{count} hours',
		description: 'A session length in hours.'
	}),
	policyHourOne: defineMessage({
		id: 'administration.policy.hour.one',
		defaultMessage: '{count} hour',
		description: 'A session length of one hour.'
	}),
	policyDay: defineMessage({
		id: 'administration.policy.days',
		defaultMessage: '{count} days',
		description: 'A session length in days.'
	}),
	policyDayOne: defineMessage({
		id: 'administration.policy.day.one',
		defaultMessage: '{count} day',
		description: 'A session length of one day.'
	}),
	policyBlockerMfa: defineMessage({
		id: 'administration.policy.blocker.mfa',
		defaultMessage: 'two-step verification is off on this server',
		description:
			'Why the change can’t be applied: the server has two-step verification turned off.'
	}),
	policyBlockerOther: defineMessage({
		id: 'administration.policy.blocker.other',
		defaultMessage: 'the server refused it ({code})',
		description: 'Why the change can’t be applied, for a reason the desktop doesn’t know yet.'
	}),
	policyEffectTitle: defineMessage({
		id: 'administration.policy.effect.title',
		defaultMessage: 'Apply this access policy?',
		description: 'Confirms an access policy change that affects people.'
	}),
	policyEffectStaff: defineMessage({
		id: 'administration.policy.effect.staff',
		defaultMessage:
			'{count} staff must set up two-step verification before they can open Proctor.',
		description: 'What requiring two-step does to staff without it.'
	}),
	policyEffectSessions: defineMessage({
		id: 'administration.policy.effect.sessions',
		defaultMessage: '{count} staff sessions without a second step end.',
		description: 'What requiring two-step does to open sessions.'
	}),
	policyEffectShorter: defineMessage({
		id: 'administration.policy.effect.shorter',
		defaultMessage: 'Open sessions get the shorter length too.',
		description: 'What shortening a session length does.'
	}),
	policyEffectConfirm: defineMessage({
		id: 'administration.policy.effect.confirm',
		defaultMessage: 'Apply changes',
		description: 'Confirms the access policy change.'
	})
});
