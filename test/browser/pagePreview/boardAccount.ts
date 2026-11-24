import type {
	AccountClient,
	AccountData,
	AccountIntent,
	AccountResponse
} from '../../../src/prctr/platform/account/common/accountProtocol.ts';
import { BOARD_NOW, HOUR, boardId } from './boardData.ts';

/*
 * The signed-in person as the Account boards draw them: Amara Okafor at Northbridge University,
 * their sessions and devices, access tokens and account history.
 */
const DAY = 24 * HOUR;

const SECTIONS: Readonly<Record<string, AccountData>> = {
	profile: {
		section: 'profile',
		profile: {
			username: 'aokafor',
			displayName: 'Amara Okafor',
			firstName: 'Amara',
			lastName: 'Okafor',
			email: 'a.okafor@northbridge.example',
			emailVerified: true,
			locale: 'en-GB',
			timezone: 'Europe/London',
			createdAt: Date.UTC(2023, 8, 4),
			photoKind: 'default'
		}
	},
	security: {
		section: 'security',
		security: {
			password: true,
			providers: [{ name: 'Northbridge single sign-on', type: 'oidc' }],
			mfa: {
				available: true,
				enabled: true,
				pending: false,
				recoveryRequired: false,
				recoveryCodesRemaining: 8,
				recoveryCodesTotal: 10,
				recoveryCodesGeneratedAt: Date.UTC(2026, 2, 2),
				method: 'authenticatorApp',
				enabledAt: Date.UTC(2026, 2, 2),
				passwordChangedAt: Date.UTC(2026, 6, 14)
			}
		}
	},
	sessions: {
		section: 'sessions',
		sessions: [
			['This Mac', 'desktop', 'macOS', true, BOARD_NOW - 60 * 1000],
			['Safari on iPhone', 'web', '', false, BOARD_NOW - 3 * HOUR],
			['Chrome on Windows', 'web', '', false, BOARD_NOW - 2 * DAY]
		].map(([name, client, platform, current, last], index) => ({
			id: boardId(1900 + index),
			current: current as boolean,
			name: name as string,
			client: client as string,
			platform: platform as string,
			method: 'password',
			authenticationStrength: 'mfa',
			createdAt: (last as number) - 5 * DAY,
			lastActivityAt: last as number,
			expiresAt: BOARD_NOW + 20 * DAY
		}))
	},
	desktops: {
		section: 'desktops',
		desktops: [
			{
				id: boardId(1950),
				current: true,
				name: 'This Mac',
				platform: 'macOS',
				release: '1.6.2',
				createdAt: Date.UTC(2026, 8, 1),
				lastUsedAt: BOARD_NOW - 60 * 1000,
				revoked: false
			}
		]
	},
	tokens: {
		section: 'tokens',
		tokens: [
			['Grades export script', ['records.read'], 90, 2],
			['Roster sync', ['users.read', 'classes.read'], 30, 0]
		].map(([description, scopes, days, used], index) => ({
			id: boardId(1960 + index),
			description: description as string,
			scopes: scopes as string[],
			expiresAt: BOARD_NOW + (days as number) * DAY,
			...((used as number) > 0 ? { lastUsedAt: BOARD_NOW - (used as number) * DAY } : {}),
			createdAt: BOARD_NOW - 40 * DAY
		}))
	},
	signIn: {
		section: 'signIn',
		signIn: {
			method: 'password',
			multiFactor: true,
			twoStepOffered: true,
			twoStepOn: true,
			canRaise: false
		}
	},
	notices: { section: 'notices', notices: [], more: false }
};

const HISTORY: AccountData = {
	section: 'history',
	entries: [
		['You signed in', 'session.created', BOARD_NOW - 60 * 1000, 'desktop'],
		['You changed your profile picture', 'profile.photo', BOARD_NOW - DAY, 'web'],
		[
			'You created the access token Grades export script',
			'token.created',
			BOARD_NOW - 3 * DAY,
			'web'
		],
		['You turned on two-step verification', 'mfa.enabled', Date.UTC(2026, 2, 2, 10), 'web']
	].map(([summary, event, at, client], index) => ({
		id: boardId(1980 + index),
		createdAt: at as number,
		event: event as string,
		failed: false,
		relation: 'subject' as const,
		actor: 'self' as never,
		summary: summary as string,
		client: client as string,
		ipAddress: `81.2.69.${160 + index}`
	})),
	runs: [],
	total: 4
};

/** Account answering every read the boards draw; a change succeeds without doing anything. */
export class BoardAccount implements AccountClient {
	async request(intent: AccountIntent): Promise<AccountResponse> {
		switch (intent.kind) {
			case 'read': {
				const data = SECTIONS[intent.section];
				return data === undefined
					? { kind: 'error', reason: 'unavailable' }
					: { kind: 'data', data };
			}
			case 'readHistory':
				return { kind: 'data', data: HISTORY };
			default:
				return { kind: 'error', reason: 'unavailable' };
		}
	}

	observe(intent: AccountIntent, listener: (response: AccountResponse) => void) {
		void this.request(intent).then(listener);
		return { dispose() {} };
	}
}
