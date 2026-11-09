/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Users page and the actions on one user that it shares with that user’s page. */
export const usersMessages = Object.freeze({
	usersImport: defineMessage({
		id: 'administration.users.action.import',
		defaultMessage: 'Import',
		description: 'Users page action that opens Imports.'
	}),
	usersInvite: defineMessage({
		id: 'administration.users.action.invite',
		defaultMessage: 'Invite people',
		description: 'Users page action that opens the invitation dialog.'
	}),
	usersFind: defineMessage({
		id: 'administration.users.find',
		defaultMessage: 'Find by name, email or username',
		description: 'Search field above the list of users.'
	}),
	usersStatus: defineMessage({
		id: 'administration.users.filter.status',
		defaultMessage: 'Status',
		description: 'Filter over the list of users by whether accounts are disabled.'
	}),
	usersStatusActive: defineMessage({
		id: 'administration.users.filter.status.active',
		defaultMessage: 'Active',
		description: 'Users filter choice: only accounts that can sign in.'
	}),
	usersStatusAny: defineMessage({
		id: 'administration.users.filter.status.any',
		defaultMessage: 'Any',
		description: 'Users filter choice: active and disabled accounts.'
	}),
	usersTable: defineMessage({
		id: 'administration.users.table',
		defaultMessage: 'Users',
		description: 'Accessible name of the table of users.'
	}),
	usersColumnPerson: defineMessage({
		id: 'administration.users.column.person',
		defaultMessage: 'Person',
		description: 'Users table column with the name and email.'
	}),
	usersColumnUsername: defineMessage({
		id: 'administration.users.column.username',
		defaultMessage: 'Username',
		description: 'Users table column.'
	}),
	usersColumnLastActive: defineMessage({
		id: 'administration.users.column.last.active',
		defaultMessage: 'Last active',
		description: 'Users table column with when they were last active.'
	}),
	usersColumnStatus: defineMessage({
		id: 'administration.users.column.status',
		defaultMessage: 'Status',
		description: 'Users table column with Active or Disabled.'
	}),
	usersNeverActive: defineMessage({
		id: 'administration.users.never.active',
		defaultMessage: 'Never',
		description: 'A user who has never been active.'
	}),
	userActive: defineMessage({
		id: 'administration.users.status.active',
		defaultMessage: 'Active',
		description: 'Status of an account that can sign in.'
	}),
	userDisabled: defineMessage({
		id: 'administration.users.status.disabled',
		defaultMessage: 'Disabled',
		description: 'Status of an account that cannot sign in.'
	}),
	usersEmpty: defineMessage({
		id: 'administration.users.empty',
		defaultMessage: 'No one has an account yet.',
		description: 'Users list with no accounts.'
	}),
	usersNoMatch: defineMessage({
		id: 'administration.users.empty.filtered',
		defaultMessage: 'No one matches. Try another name or include disabled accounts.',
		description: 'Users list with no matches for the filters.'
	}),
	userOpen: defineMessage({
		id: 'administration.users.action.open',
		defaultMessage: 'Open',
		description: 'Row action that opens a user’s page.'
	}),
	userDisable: defineMessage({
		id: 'administration.users.action.disable',
		defaultMessage: 'Disable account…',
		description: 'Row action that disables a user’s account after confirming.'
	}),
	userEnable: defineMessage({
		id: 'administration.users.action.enable',
		defaultMessage: 'Enable account',
		description: 'Row action that lets a disabled user sign in again.'
	}),
	userSignOutEverywhere: defineMessage({
		id: 'administration.users.action.sign.out',
		defaultMessage: 'Sign out everywhere…',
		description: 'Row action that ends all of a user’s sessions after confirming.'
	}),
	userDisableTitle: defineMessage({
		id: 'administration.users.disable.title',
		defaultMessage: 'Disable {name}’s account?',
		description: 'Confirmation title before disabling an account; name is the person.'
	}),
	userDisableBody: defineMessage({
		id: 'administration.users.disable.body',
		defaultMessage:
			'They’re signed out everywhere at once and can’t sign in until the account is enabled again. Their submissions, results and history are kept.',
		description: 'Confirmation body before disabling an account.'
	}),
	userDisableConfirm: defineMessage({
		id: 'administration.users.disable.confirm',
		defaultMessage: 'Disable account',
		description: 'Confirms disabling an account.'
	}),
	userDisabledToast: defineMessage({
		id: 'administration.users.disabled.toast',
		defaultMessage: '{name}’s account is disabled',
		description: 'Toast after an account is disabled.'
	}),
	userEnabledToast: defineMessage({
		id: 'administration.users.enabled.toast',
		defaultMessage: '{name} can sign in again',
		description: 'Toast after an account is enabled.'
	}),
	userSignOutTitle: defineMessage({
		id: 'administration.users.sign.out.title',
		defaultMessage: 'Sign {name} out everywhere?',
		description: 'Confirmation title before ending all of a user’s sessions.'
	}),
	userSignOutBody: defineMessage({
		id: 'administration.users.sign.out.body',
		defaultMessage:
			'Every session on every device ends now. They can sign in again straight away.',
		description: 'Confirmation body before ending all of a user’s sessions.'
	}),
	userSignOutConfirm: defineMessage({
		id: 'administration.users.sign.out.confirm',
		defaultMessage: 'Sign out everywhere',
		description: 'Confirms ending all of a user’s sessions.'
	}),
	userSignedOutToast: defineMessage({
		id: 'administration.users.signed.out.toast',
		defaultMessage: '{name} is signed out everywhere',
		description: 'Toast after all of a user’s sessions end.'
	})
});
