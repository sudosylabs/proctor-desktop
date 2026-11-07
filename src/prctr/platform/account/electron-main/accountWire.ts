import {
	accountRecord as record,
	accountId,
	accountInstant,
	accountList,
	accountPage,
	validateAccountResponse,
	type AccountData,
	type AccountBinding,
	type AccountResponse,
	type AccountToken
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
		sessions: accountPage(raw).map((value) => {
			const s = record(value);
			if (accountId(s.user_id) !== binding.principalId)
				throw new TypeError('Account binding mismatch');
			return {
				id: s.id,
				current: s.id === binding.sessionId,
				name: s.device_name ?? '',
				client: s.client_type,
				method: s.authentication_method,
				createdAt: accountInstant(s.created_at),
				lastActivityAt: accountInstant(s.last_activity_at),
				expiresAt: accountInstant(s.expires_at)
			};
		})
	});
}
export function readAccountDesktops(raw: unknown, currentRegistrationId: string): AccountData {
	return checked({
		section: 'desktops',
		desktops: accountPage(raw).map((value) => {
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
				createdAt: accountInstant(d.created_at),
				lastUsedAt: accountInstant(d.last_used_at),
				revoked: d.status === 'revoked'
			};
		})
	});
}
function tokenProjection(raw: unknown, binding: AccountBinding): Record<string, unknown> {
	const t = record(raw);
	if (accountId(t.user_id) !== binding.principalId)
		throw new TypeError('Account binding mismatch');
	const projection: Record<string, unknown> = {
		id: t.id,
		description: t.description,
		scopes: t.scopes,
		academicUnitId: t.academic_unit_id,
		expiresAt: accountInstant(t.expires_at),
		lastUsedAt: accountInstant(t.last_used_at),
		disabledAt: accountInstant(t.disabled_at),
		revokedAt: accountInstant(t.revoked_at),
		createdAt: accountInstant(t.created_at)
	};
	for (const key of Object.keys(projection))
		if (projection[key] === undefined) delete projection[key];
	return projection;
}
export function readAccountTokens(raw: unknown, binding: AccountBinding): AccountData {
	return checked({
		section: 'tokens',
		tokens: accountPage(raw).map((value) => tokenProjection(value, binding))
	});
}
/** Parses one token returned by disable/enable and binds it to the requested record. */
export function readAccountToken(raw: unknown, binding: AccountBinding, id: string): AccountToken {
	const data = checked({ section: 'tokens', tokens: [tokenProjection(raw, binding)] });
	if (data.section !== 'tokens' || data.tokens[0]?.id !== id)
		throw new TypeError('Account token mismatch');
	return data.tokens[0];
}
/** The credential crosses only this one reply; callers must not cache, log or store it. */
export function readAccountTokenCreation(raw: unknown, binding: AccountBinding): AccountResponse {
	const c = record(raw);
	if (Object.keys(c).sort().join() !== 'credential,token')
		throw new TypeError('Invalid token creation');
	const result = validateAccountResponse({
		kind: 'tokenCreated',
		token: tokenProjection(c.token, binding),
		credential: c.credential
	});
	if (result.kind !== 'tokenCreated') throw new TypeError('Invalid token creation');
	return result;
}
export function readAccountNotices(raw: unknown): AccountData {
	const page = record(raw);
	if (
		page.next_cursor !== undefined &&
		(typeof page.next_cursor !== 'string' || page.next_cursor.length > 256)
	)
		throw new TypeError('Invalid notice cursor');
	return checked({
		section: 'notices',
		notices: accountList(page.items, 200).map((value) => {
			const n = record(value);
			return {
				retirementId: n.retirement_id,
				examId: n.exam_id,
				examSittingId: n.exam_sitting_id,
				submissionId: n.submission_id,
				category: n.category,
				state: n.state,
				createdAt: accountInstant(n.created_at),
				retireAfter: accountInstant(n.retire_after),
				deliveryState: n.delivery_state,
				canceledAt: accountInstant(n.canceled_at)
			};
		}),
		more: typeof page.next_cursor === 'string' && page.next_cursor.length > 0
	});
}
function checked(value: unknown): AccountData {
	const result = validateAccountResponse({ kind: 'data', data: value });
	if (result.kind !== 'data') throw new TypeError('Invalid account projection');
	return result.data;
}
