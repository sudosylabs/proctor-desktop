/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Account Access tokens page and its dialogs. */
export const tokensMessages = Object.freeze({
	revokeTokenEllipsis: defineMessage({
		id: 'account.tokens.revoke.menu',
		defaultMessage: 'Revoke',
		description: 'Row menu entry that opens the confirmation to revoke a token.'
	}),
	tokenDisabledStatus: defineMessage({
		id: 'account.tokens.status.disabled',
		defaultMessage: 'Disabled',
		description: 'Status word: the token is turned off.'
	}),
	tokenExpiredStatus: defineMessage({
		id: 'account.tokens.status.expired',
		defaultMessage: 'Expired',
		description: 'Status word: the token has expired.'
	}),
	tokenRevokedStatus: defineMessage({
		id: 'account.tokens.status.revoked',
		defaultMessage: 'Revoked',
		description: 'Status word: the token was revoked.'
	}),
	newToken: defineMessage({
		id: 'account.tokens.new',
		defaultMessage: 'New token',
		description: 'Create an access token.'
	}),
	activeTokens: defineMessage({
		id: 'account.tokens.active',
		defaultMessage: 'Active',
		description: 'Heading of active tokens.'
	}),
	activeTokensDescription: defineMessage({
		id: 'account.tokens.active.description',
		defaultMessage: 'Each token can do only what it lists, and stops working when it expires.',
		description: 'Describes active tokens.'
	}),
	noActiveTokens: defineMessage({
		id: 'account.tokens.active.empty',
		defaultMessage: 'No active tokens',
		description: 'Title of the empty Active section while disabled or expired tokens exist.'
	}),
	noActiveTokensBody: defineMessage({
		id: 'account.tokens.active.empty.body',
		defaultMessage:
			'Your other tokens are disabled or expired, so no script can use your account right now. Enable one below, or create a new one.',
		description: 'Body of the empty Active section while disabled or expired tokens exist.'
	}),
	yourTokens: defineMessage({
		id: 'account.tokens.section.all',
		defaultMessage: 'Your tokens',
		description: 'The one tokens section shown when the person has no tokens.'
	}),
	noTokensTitle: defineMessage({
		id: 'account.tokens.none.title',
		defaultMessage: 'No access tokens yet',
		description: 'Empty state title on the Access tokens page.'
	}),
	noTokensBody: defineMessage({
		id: 'account.tokens.none.body',
		defaultMessage:
			'A token lets a script, such as a grade export, use Proctor with only the permissions you choose.',
		description: 'Empty state explanation on the Access tokens page.'
	}),
	inactiveTokens: defineMessage({
		id: 'account.tokens.inactive',
		defaultMessage: 'Disabled or expired',
		description: 'Heading of disabled, expired and revoked tokens.'
	}),
	inactiveTokensDescription: defineMessage({
		id: 'account.tokens.inactive.description',
		defaultMessage:
			'A disabled token can be turned back on until it expires. Expired and revoked tokens stay listed for your records.',
		description: 'Describes inactive tokens.'
	}),
	tokenUnitTag: defineMessage({
		id: 'account.tokens.unit.tag',
		defaultMessage: 'One academic unit only',
		description: 'The token is limited to one Academic Unit whose name is unknown.'
	}),
	tokenUnitNamedTag: defineMessage({
		id: 'account.tokens.unit.named.tag',
		defaultMessage: '{unit} only',
		description: 'The token is limited to the named Academic Unit.'
	}),
	tokenExpires: defineMessage({
		id: 'account.tokens.expires',
		defaultMessage: 'expires {date}',
		description:
			'When a token expires, after another detail, as in "Disabled 10 Oct · expires 30 Dec".'
	}),
	tokenExpiresFirst: defineMessage({
		id: 'account.tokens.expires.first',
		defaultMessage: 'Expires {date}',
		description: 'When an active token expires, at the start of its details.'
	}),
	tokenExpired: defineMessage({
		id: 'account.tokens.expired',
		defaultMessage: 'Expired {date}',
		description: 'When a token expired, at the start of its details.'
	}),
	tokenRevokedOn: defineMessage({
		id: 'account.tokens.revoked.on',
		defaultMessage: 'Revoked {date}',
		description: 'When a token was revoked, at the start of its details.'
	}),
	tokenDisabledOn: defineMessage({
		id: 'account.tokens.disabled.on',
		defaultMessage: 'Disabled {date}',
		description: 'When a token was disabled, at the start of its details.'
	}),
	tokenUsed: defineMessage({
		id: 'account.tokens.used',
		defaultMessage: 'used {when}',
		description: 'When a token was last used.'
	}),
	tokenNeverUsed: defineMessage({
		id: 'account.tokens.never.used',
		defaultMessage: 'never used',
		description: 'The token has not been used.'
	}),
	disableToken: defineMessage({
		id: 'account.tokens.disable',
		defaultMessage: 'Disable',
		description: 'Temporarily disable a token.'
	}),
	enableToken: defineMessage({
		id: 'account.tokens.enable',
		defaultMessage: 'Enable',
		description: 'Turn a disabled token back on.'
	}),
	revokeToken: defineMessage({
		id: 'account.tokens.revoke',
		defaultMessage: 'Revoke',
		description: 'Permanently revoke a token.'
	}),
	confirmRevokeTitle: defineMessage({
		id: 'account.tokens.revoke.title',
		defaultMessage: 'Revoke {name}?',
		description: 'Title of the revoke confirmation.'
	}),
	confirmRevokeBody: defineMessage({
		id: 'account.tokens.revoke.body',
		defaultMessage:
			'Anything using this token stops working straight away. A revoked token can’t be turned back on.',
		description: 'Consequences of revoking a token.'
	}),
	confirmRevokeAction: defineMessage({
		id: 'account.tokens.revoke.action',
		defaultMessage: 'Revoke token',
		description: 'Confirm revoking a token.'
	}),
	tokenDisabled: defineMessage({
		id: 'account.tokens.disabled',
		defaultMessage: 'Token disabled.',
		description: 'A token was disabled.'
	}),
	tokenEnabled: defineMessage({
		id: 'account.tokens.enabled',
		defaultMessage: 'Token enabled.',
		description: 'A token was enabled.'
	}),
	tokenRevoked: defineMessage({
		id: 'account.tokens.revoked',
		defaultMessage: 'Token revoked.',
		description: 'A token was revoked.'
	}),
	newTokenTitle: defineMessage({
		id: 'account.tokens.dialog.title',
		defaultMessage: 'New access token',
		description: 'Title of the new token dialog.'
	}),
	newTokenDescription: defineMessage({
		id: 'account.tokens.dialog.description',
		defaultMessage:
			'The script gets only what you tick, and never more than you can do yourself.',
		description: 'Explains token limits.'
	}),
	tokenName: defineMessage({
		id: 'account.tokens.name',
		defaultMessage: 'Name',
		description: 'Token name field label.'
	}),
	tokenNameHint: defineMessage({
		id: 'account.tokens.name.hint',
		defaultMessage: 'What uses it, so you recognise it later.',
		description: 'Token name field description.'
	}),
	tokenScopes: defineMessage({
		id: 'account.tokens.scopes',
		defaultMessage: 'What it can do',
		description: 'Token scope choices.'
	}),
	tokenScopesLoading: defineMessage({
		id: 'account.tokens.scopes.loading',
		defaultMessage: 'Finding what you can give a token…',
		description: 'The grantable token scopes are being read.'
	}),
	tokenScopesNone: defineMessage({
		id: 'account.tokens.scopes.none',
		defaultMessage: 'There is nothing you can give a token yet.',
		description: 'The person may grant no token scope.'
	}),
	tokenLimit: defineMessage({
		id: 'account.tokens.limit',
		defaultMessage: 'Limit to',
		description: 'Choice of the Academic Unit a token is limited to.'
	}),
	tokenLimitNone: defineMessage({
		id: 'account.tokens.limit.none',
		defaultMessage: 'Whole institution',
		description: 'The token is not limited to an Academic Unit.'
	}),
	tokenLimitMore: defineMessage({
		id: 'account.tokens.limit.more',
		defaultMessage: 'Some academic units are not listed.',
		description: 'More grantable Academic Units exist than the list shows.'
	}),
	tokenExpiry: defineMessage({
		id: 'account.tokens.expiry',
		defaultMessage: 'Expires',
		description: 'Token expiry choice.'
	}),
	tokenExpiryOption: defineMessage({
		id: 'account.tokens.expiry.option',
		defaultMessage: 'In {days} days, {date}',
		description: 'One expiry choice.'
	}),
	createToken: defineMessage({
		id: 'account.tokens.create',
		defaultMessage: 'Create token',
		description: 'Create the token.'
	}),
	tokenCreating: defineMessage({
		id: 'account.tokens.creating',
		defaultMessage: 'Creating token…',
		description: 'The token is being created.'
	}),
	tokenCreatedTitle: defineMessage({
		id: 'account.tokens.created.title',
		defaultMessage: 'Copy your token now',
		description: 'Title of the one-time credential dialog.'
	}),
	tokenCreatedBody: defineMessage({
		id: 'account.tokens.created.body',
		defaultMessage:
			'This is the only time Proctor shows it. Keep it somewhere safe, such as a password manager. Anyone with it can act as you within its limits.',
		description: 'Explains the one-time credential.'
	}),
	tokenCredentialLabel: defineMessage({
		id: 'account.tokens.credential.label',
		defaultMessage: 'Your new token',
		description: 'Accessible name of the credential text.'
	}),
	copy: defineMessage({
		id: 'account.tokens.copy',
		defaultMessage: 'Copy',
		description: 'Copy the credential.'
	}),
	copiedButton: defineMessage({
		id: 'account.tokens.copied.button',
		defaultMessage: 'Copied',
		description: "A Copy button's label for a moment after it copied."
	}),
	copied: defineMessage({
		id: 'account.tokens.copied',
		defaultMessage: 'Copied to the clipboard.',
		description: 'Announced to screen readers when the credential was copied.'
	}),
	copyFailed: defineMessage({
		id: 'account.tokens.copy.failed',
		defaultMessage: 'Couldn’t copy. Select the token and copy it yourself.',
		description: 'Copying the credential failed.'
	}),
	done: defineMessage({
		id: 'account.tokens.done',
		defaultMessage: 'Done',
		description: 'Close the credential dialog.'
	}),
	tokenCreated: defineMessage({
		id: 'account.tokens.created',
		defaultMessage: 'Token created.',
		description: 'A token was created.'
	}),
	tokenScopeCountOne: defineMessage({
		id: 'account.tokens.scope.count.one',
		defaultMessage: '1 permission',
		description: 'Beside the new-token buttons: how many permissions are ticked. One.'
	}),
	tokenScopeCount: defineMessage({
		id: 'account.tokens.scope.count',
		defaultMessage: '{count} permissions',
		description: 'Beside the new-token buttons: how many permissions are ticked. Two or more.'
	})
});
