import type { ApiInput } from '../../serverApi/common/serverApi.js';
import {
	projectionRecord as record,
	projectionId as accountId,
	projectionInstant as accountInstant,
	projectionList as accountList,
	projectionPage as accountPage,
	type SessionBinding
} from '../../serverApi/common/projection.js';
import {
	validateAccountResponse,
	type AccountData,
	ACCOUNT_HISTORY_PAGE_SIZE,
	type AccountHistoryQuery,
	type AccountResponse,
	type AccountToken
} from '../common/accountProtocol.js';

export function readAccountProfile(raw: unknown, binding: SessionBinding): AccountData {
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
			timezone: p.timezone,
			createdAt: accountInstant(p.created_at),
			photoKind: p.profile_picture_kind
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
							recoveryCodesRemaining: m.recovery_codes_remaining,
							recoveryCodesTotal: m.recovery_codes_total,
							recoveryCodesGeneratedAt: accountInstant(m.recovery_codes_generated_at),
							method:
								m.method === undefined
									? undefined
									: m.method === 'authenticator_app'
										? 'authenticatorApp'
										: m.method,
							enabledAt: accountInstant(m.enabled_at),
							passwordChangedAt: accountInstant(m.password_changed_at)
						}
		}
	});
}
export function readAccountSessions(raw: unknown, binding: SessionBinding): AccountData {
	return checked({
		section: 'sessions',
		sessions: accountPage(raw).map((value) => {
			const s = record(value);
			if (accountId(s.user_id) !== binding.principalId)
				throw new TypeError('Account binding mismatch');
			// The server marks the Session that asked; it must be the one this window is bound to.
			if (s.current !== (s.id === binding.sessionId))
				throw new TypeError('Account binding mismatch');
			const session: Record<string, unknown> = {
				id: s.id,
				current: s.current,
				name: s.device_name ?? '',
				client: s.client_type,
				platform: s.desktop_platform ?? '',
				method: s.authentication_method,
				authenticationStrength: s.authentication_strength,
				mfaCompletedAt: accountInstant(s.mfa_completed_at),
				desktopRegistrationId: s.desktop_registration_id,
				desktopRegistrationName: s.desktop_registration_display_name,
				createdAt: accountInstant(s.created_at),
				lastActivityAt: accountInstant(s.last_activity_at),
				expiresAt: accountInstant(s.expires_at)
			};
			for (const key of Object.keys(session))
				if (session[key] === undefined) delete session[key];
			return session;
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
function tokenProjection(raw: unknown, binding: SessionBinding): Record<string, unknown> {
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
export function readAccountTokens(raw: unknown, binding: SessionBinding): AccountData {
	return checked({
		section: 'tokens',
		tokens: accountPage(raw).map((value) => tokenProjection(value, binding))
	});
}
/** Parses one token returned by disable/enable and binds it to the requested record. */
export function readAccountToken(raw: unknown, binding: SessionBinding, id: string): AccountToken {
	const data = checked({ section: 'tokens', tokens: [tokenProjection(raw, binding)] });
	if (data.section !== 'tokens' || data.tokens[0]?.id !== id)
		throw new TypeError('Account token mismatch');
	return data.tokens[0];
}
/** The credential crosses only this one reply; callers must not cache, log or store it. */
export function readAccountTokenCreation(raw: unknown, binding: SessionBinding): AccountResponse {
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
				examTitle: n.exam_title,
				examSittingId: n.exam_sitting_id,
				sittingStartAt: accountInstant(n.sitting_start_at),
				sittingEndAt: accountInstant(n.sitting_end_at),
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
export function readAccountGrantableScopes(raw: unknown): AccountData {
	const g = record(raw);
	return checked({
		section: 'grantableScopes',
		grantable: {
			scopes: accountList(g.scopes, 128).map((value) => {
				const c = record(value);
				return {
					name: c.name,
					title: c.title,
					description: c.description,
					institutionWide: c.institution_wide,
					academicUnitIds: c.academic_unit_ids
				};
			}),
			academicUnits: accountList(g.academic_units, 50).map((value) => {
				const u = record(value);
				return { id: u.id, name: u.display_name };
			}),
			moreAcademicUnits: g.academic_units_has_more
		}
	});
}
export function readAccountHistory(raw: unknown): AccountData {
	const page = record(raw);
	return checked({
		section: 'history',
		entries: accountList(page.items, 200).map((value) => {
			const e = record(value);
			if (e.status !== 'success' && e.status !== 'fail')
				throw new TypeError('Invalid history outcome');
			const entry: Record<string, unknown> = {
				id: e.id,
				createdAt: accountInstant(e.created_at),
				event: e.event,
				failed: e.status === 'fail',
				relation: e.relation,
				actor: record(e.actor).kind,
				summary: e.summary,
				client: e.client_type,
				ipAddress: e.ip_address,
				userAgent: e.user_agent
			};
			for (const key of Object.keys(entry)) if (entry[key] === undefined) delete entry[key];
			return entry;
		}),
		...(page.next_cursor === undefined ? {} : { cursor: page.next_cursor }),
		...(page.total === undefined
			? {}
			: { total: page.total, totalIsLowerBound: page.total_is_lower_bound === true })
	});
}
/** The history path for one query: the server's own filter names, encoded. */
type AuditEventName = NonNullable<
	NonNullable<ApiInput<'listCurrentUserAuditEvents'>['query']>['event']
>[number];
/** The `listCurrentUserAuditEvents` query for one history page, in the server's filter names. */
export function accountHistoryQuery(
	query: AccountHistoryQuery
): NonNullable<ApiInput<'listCurrentUserAuditEvents'>['query']> {
	return {
		limit: query.limit ?? ACCOUNT_HISTORY_PAGE_SIZE,
		...(query.createdAfter === undefined
			? {}
			: { created_after: new Date(query.createdAfter).toISOString() }),
		...(query.createdBefore === undefined
			? {}
			: { created_before: new Date(query.createdBefore).toISOString() }),
		...(query.events?.length ? { event: query.events as readonly AuditEventName[] } : {}),
		...(query.status === undefined ? {} : { status: query.status }),
		...(query.relation === undefined ? {} : { relation: query.relation }),
		...(query.order === undefined ? {} : { order: query.order }),
		...(query.cursor === undefined ? {} : { cursor: query.cursor })
	};
}
export function readRevokedSessionCount(raw: unknown): AccountResponse {
	const r = record(raw);
	if (Object.keys(r).join() !== 'revoked_session_count')
		throw new TypeError('Invalid session revocation');
	return validateAccountResponse({ kind: 'sessionsEnded', count: r.revoked_session_count });
}
function checked(value: unknown): AccountData {
	const result = validateAccountResponse({ kind: 'data', data: value });
	if (result.kind !== 'data') throw new TypeError('Invalid account projection');
	return result.data;
}
