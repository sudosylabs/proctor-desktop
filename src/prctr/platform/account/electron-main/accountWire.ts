import {
	accountRecord as record,
	accountId,
	accountList,
	validateAccountResponse,
	type AccountData,
	type AccountBinding
} from '../common/accountProtocol.js';

export function readAccountProfile(raw: unknown, binding: AccountBinding): AccountData {
	const p = record(raw);
	if (accountId(p.id) !== binding.principalId) throw new TypeError('Account binding mismatch');
	return checked({
		section: 'profile',
		profile: {
			username: p.username,
			displayName: p.display_name,
			firstName: p.first_name,
			lastName: p.last_name,
			email: p.email,
			emailVerified: p.email_verified,
			locale: p.locale,
			timezone: p.timezone
		}
	});
}
export function readAccountSecurity(methods: unknown, mfa: unknown): AccountData {
	const s = record(methods);
	const m = mfa === undefined ? undefined : record(mfa);
	return checked({
		section: 'security',
		security: {
			password: s.password,
			providers: accountList(s.providers, 64).map((value) => {
				const p = record(value);
				return { name: p.display_name, type: p.type };
			}),
			mfa:
				m === undefined
					? undefined
					: {
							available: m.service_enabled,
							enabled: m.enabled,
							pending: m.pending,
							recoveryRequired: m.mfa_recovery_required,
							recoveryCodesRemaining: m.recovery_codes_remaining
						}
		}
	});
}
export function readAccountSessions(raw: unknown, binding: AccountBinding): AccountData {
	return checked({
		section: 'sessions',
		sessions: accountList(raw).map((value) => {
			const s = record(value);
			if (accountId(s.user_id) !== binding.principalId)
				throw new TypeError('Account binding mismatch');
			return {
				id: s.id,
				current: s.id === binding.sessionId,
				name: s.device_name ?? '',
				client: s.client_type,
				method: s.authentication_method,
				createdAt: s.create_at,
				lastActivityAt: s.last_activity_at,
				expiresAt: s.expires_at
			};
		})
	});
}
export function readAccountDesktops(raw: unknown, currentRegistrationId: string): AccountData {
	return checked({
		section: 'desktops',
		desktops: accountList(raw).map((value) => {
			const d = record(value);
			if (
				d.current !== (d.id === currentRegistrationId) ||
				!['active', 'revoked'].includes(d.status as string)
			)
				throw new TypeError('Invalid Desktop registration');
			return {
				id: d.id,
				current: d.current,
				name: d.display_name,
				platform: d.platform,
				release: d.desktop_release,
				createdAt: d.created_at,
				lastUsedAt: d.last_used_at,
				revoked: d.status === 'revoked'
			};
		})
	});
}
function checked(value: unknown): AccountData {
	const result = validateAccountResponse({ kind: 'data', data: value });
	if (result.kind !== 'data') throw new TypeError('Invalid account projection');
	return result.data;
}
