import { defineMessage } from '../../base/common/localization.js';

export const launchMessages = Object.freeze({
	title: defineMessage({
		id: 'launch.title',
		defaultMessage: 'Connect to your Institution',
		description: 'Task heading for the signed-out Proctor launch surface.'
	}),
	serverLabel: defineMessage({
		id: 'launch.server.label',
		defaultMessage: 'Institution server',
		description: 'Label for the server address input.'
	}),
	serverHint: defineMessage({
		id: 'launch.server.hint',
		defaultMessage: 'Enter the server address provided by your Institution.',
		description: 'Help for Institution server selection.'
	}),
	check: defineMessage({
		id: 'launch.check',
		defaultMessage: 'Continue',
		description: 'Submit the Institution server for readiness checks.'
	}),
	selectingServer: defineMessage({
		id: 'launch.selecting.server',
		defaultMessage: 'Choose your Institution server to continue.',
		description: 'Launch status before selecting a server.'
	}),
	invalidServer: defineMessage({
		id: 'launch.invalid.server',
		defaultMessage:
			'Enter a server address using HTTPS, without a path, query, or sign-in details.',
		description: 'Invalid server origin input.'
	}),
	checking: defineMessage({
		id: 'launch.checking',
		defaultMessage: 'Checking server availability and compatibility…',
		description: 'Readiness check in progress.'
	}),
	ready: defineMessage({
		id: 'launch.ready',
		defaultMessage: 'This server is ready for sign-in.',
		description: 'Server passed both public readiness checks.'
	}),
	identityChanged: defineMessage({
		id: 'launch.identity.changed',
		defaultMessage:
			'This server’s Institution identity changed. Confirm the address with your Institution before retrying.',
		description:
			'Block an authorization handoff when the fresh check identifies a different Institution or installation.'
	}),
	maintenance: defineMessage({
		id: 'launch.maintenance',
		defaultMessage:
			'This server is undergoing maintenance. Try again later or contact your Institution.',
		description: 'Server maintenance status.'
	}),
	unavailable: defineMessage({
		id: 'launch.unavailable',
		defaultMessage:
			'This server is temporarily unavailable. Try again later or contact your Institution.',
		description: 'Coarse server unavailable status.'
	}),
	unreachable: defineMessage({
		id: 'launch.unreachable',
		defaultMessage:
			'Proctor could not reach this server. Check the address and your connection, then retry.',
		description: 'Server request failed.'
	}),
	timedOut: defineMessage({
		id: 'launch.timed.out',
		defaultMessage: 'The server did not respond in time. Check your connection and retry.',
		description: 'Server request deadline elapsed.'
	}),
	invalidResponse: defineMessage({
		id: 'launch.invalid.response',
		defaultMessage:
			'This server returned an unexpected response. Check the address or contact your Institution.',
		description: 'Malformed public readiness response.'
	}),
	redirectBlocked: defineMessage({
		id: 'launch.redirect.blocked',
		defaultMessage:
			'This address redirects elsewhere. Enter the Institution’s server address directly.',
		description: 'Server redirects are not followed.'
	}),
	originMismatch: defineMessage({
		id: 'launch.origin.mismatch',
		defaultMessage:
			'The server identifies itself with a different address. Confirm the correct address with your Institution.',
		description: 'Canonical server origin mismatch.'
	}),
	updateRequired: defineMessage({
		id: 'launch.update.required',
		defaultMessage:
			'This Proctor build cannot sign in. Install an approved update from your Institution.',
		description: 'Server requires a different approved desktop build.'
	}),
	serverIncompatible: defineMessage({
		id: 'launch.server.incompatible',
		defaultMessage:
			'This Proctor build and server are not compatible. Contact your Institution for a supported version.',
		description: 'Server and desktop compatibility failure.'
	}),
	unsupportedTarget: defineMessage({
		id: 'launch.unsupported.target',
		defaultMessage:
			'This server does not support Proctor on this platform. Contact your Institution.',
		description: 'Unsupported desktop platform or architecture.'
	}),
	authorizationDisabled: defineMessage({
		id: 'launch.authorization.disabled',
		defaultMessage:
			'Desktop sign-in is not available on this server. Contact your Institution.',
		description: 'Server has disabled desktop authorization.'
	}),
	authorizationUnsupported: defineMessage({
		id: 'launch.authorization.unsupported',
		defaultMessage:
			'This Proctor build does not support the server’s sign-in protocol. Contact your Institution.',
		description: 'Desktop authorization protocol incompatibility.'
	}),
	authorizing: defineMessage({
		id: 'launch.authorizing',
		defaultMessage: 'Continue signing in in your system browser.',
		description: 'Privileged hosted authorization is in progress.'
	}),
	authorizationFailed: defineMessage({
		id: 'launch.authorization.failed',
		defaultMessage: 'Sign-in could not be completed. Retry to check this server again.',
		description: 'Safe hosted authorization failure.'
	}),
	signIn: defineMessage({
		id: 'launch.sign.in',
		defaultMessage: 'Sign in to {institution}',
		description: 'Start system-browser authentication for the verified Institution.'
	}),
	signInGeneric: defineMessage({
		id: 'launch.sign.in.generic',
		defaultMessage: 'Sign in',
		description: 'Unavailable sign-in action before server identity is known.'
	}),
	authUnavailable: defineMessage({
		id: 'launch.auth.unavailable',
		defaultMessage: 'Sign-in is not available in this build.',
		description:
			'Readiness is implemented but the hosted authentication owner is not connected.'
	}),
	changeServer: defineMessage({
		id: 'launch.change.server',
		defaultMessage: 'Change server',
		description: 'Discard the selected server and cancel pending work.'
	}),
	retry: defineMessage({
		id: 'launch.retry',
		defaultMessage: 'Retry',
		description: 'Manually repeat both public readiness checks.'
	}),
	retryAt: defineMessage({
		id: 'launch.retry.at',
		defaultMessage: 'The server suggests trying again after {time}.',
		description: 'Advisory server retry time, displayed in the user’s locale.'
	}),
	development: defineMessage({
		id: 'launch.development',
		defaultMessage: 'Development server · HTTP loopback connection',
		description: 'Visible warning for explicitly enabled development-only HTTP.'
	}),
	exit: defineMessage({
		id: 'launch.exit',
		defaultMessage: 'Exit Proctor',
		description: 'Exit the signed-out LaunchWindow.'
	}),
	failed: defineMessage({
		id: 'launch.failed',
		defaultMessage: 'The requested action could not be completed. Please try again.',
		description: 'Safe failure for a LaunchWindow action.'
	}),
	recovery: defineMessage({
		id: 'launch.recovery',
		defaultMessage: 'Proctor could not start the launch window safely.',
		description: 'Minimal LaunchWindow startup recovery message.'
	})
});
