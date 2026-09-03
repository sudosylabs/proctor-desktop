import type { CancellationToken } from '../../../base/common/cancellation.js';
import type { LaunchIdentityProjection, LaunchState } from '../common/launchIdentity.js';

/** Supplied by the trusted release/composition owner, never by renderer input. */
export interface DesktopReleaseTarget {
	readonly release: string;
	readonly buildId: string;
	readonly platform: string;
	readonly architecture: string;
	readonly realtimeProtocol: number;
	readonly authorizationProtocol: number;
}

export type PublicRequestFailure =
	'unreachable' | 'timedOut' | 'invalidResponse' | 'redirectBlocked';
export type PublicReadinessResponse =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly reason: PublicRequestFailure };
export interface ServerReadinessProbe {
	readonly system: PublicReadinessResponse;
	readonly discovery: PublicReadinessResponse;
}
export interface ServerReadinessTransport {
	probe(
		origin: string,
		target: DesktopReleaseTarget,
		token: CancellationToken
	): Promise<ServerReadinessProbe>;
}

export interface VerifiedServerIdentity {
	readonly origin: string;
	readonly institutionId: string;
	readonly installationId: string;
	readonly institutionName: string;
	readonly developmentOrigin: boolean;
}

export interface ReadinessEvaluation {
	readonly state: LaunchState;
	readonly identity?: VerifiedServerIdentity;
	readonly institutionName?: string;
	readonly administratorMessage?: string;
	readonly retryAt?: number;
	readonly compatibilityReason?: LaunchIdentityProjection['compatibilityReason'];
}

export function normalizeServerOrigin(address: string, allowDevelopmentLoopback: boolean): string {
	const trimmed = address.trim();
	if (!trimmed || trimmed.length > 2048 || /[\s\\\u0000-\u001f\u007f]/u.test(trimmed))
		throw new TypeError('Invalid server address');
	const url = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`);
	const development =
		allowDevelopmentLoopback && url.protocol === 'http:' && isLoopback(url.hostname);
	if (
		(url.protocol !== 'https:' && !development) ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash ||
		url.origin === 'null'
	) {
		throw new TypeError('Server address must be a secure origin');
	}
	return url.origin;
}

export function validateDesktopReleaseTarget(target: DesktopReleaseTarget): DesktopReleaseTarget {
	if (
		!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(target.release) ||
		target.release.length > 64 ||
		!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(target.buildId) ||
		!/^[a-z0-9][a-z0-9_-]{0,31}$/u.test(target.platform) ||
		!/^[a-z0-9][a-z0-9_-]{0,31}$/u.test(target.architecture) ||
		!Number.isSafeInteger(target.realtimeProtocol) ||
		target.realtimeProtocol < 1 ||
		!Number.isSafeInteger(target.authorizationProtocol) ||
		target.authorizationProtocol < 1
	) {
		throw new TypeError('Invalid trusted Desktop release target');
	}
	return Object.freeze({ ...target });
}

/** Consume the two existing server contracts; do not reproduce the build-catalog decision locally. */
export function evaluateServerReadiness(
	origin: string,
	target: DesktopReleaseTarget,
	probe: ServerReadinessProbe,
	now: number
): ReadinessEvaluation {
	if (!probe.discovery.ok) return { state: probe.discovery.reason };
	let discovery: Record<string, unknown>;
	let identity: VerifiedServerIdentity | undefined;
	try {
		discovery = record(probe.discovery.value);
		if (discovery.discovery_version !== 1) return { state: 'serverIncompatible' };
		const canonical = text(discovery.canonical_origin, 2048);
		if (normalizeServerOrigin(canonical, origin.startsWith('http:')) !== origin)
			return { state: 'originMismatch' };
		if (discovery.initialized === false) return { state: 'unavailable' };
		if (discovery.initialized !== true) return { state: 'invalidResponse' };
		const institution = record(discovery.institution);
		const institutionId = identifier(institution.id);
		const installationId = identifier(discovery.installation_id);
		const institutionName = text(institution.display_name || institution.name, 512);
		identity = Object.freeze({
			origin,
			institutionId,
			installationId,
			institutionName,
			developmentOrigin: origin.startsWith('http:')
		});
	} catch {
		return { state: 'invalidResponse' };
	}
	const presentation = { institutionName: identity.institutionName };
	if (!probe.system.ok) return { ...presentation, state: probe.system.reason };
	try {
		const system = record(probe.system.value);
		if (system.schema_version !== 1) return { ...presentation, state: 'serverIncompatible' };
		const serverTime = timestamp(system.server_time);
		const administratorMessage =
			system.administrator_message === undefined
				? undefined
				: text(system.administrator_message, 2048, true);
		const retryTime = system.retry_at === undefined ? undefined : timestamp(system.retry_at);
		const retryAt =
			retryTime !== undefined && retryTime > serverTime
				? Math.trunc(now + retryTime - serverTime)
				: undefined;
		if (
			retryAt !== undefined &&
			(!Number.isSafeInteger(retryAt) || retryAt < 0 || retryAt > 8.64e15)
		)
			return { ...presentation, state: 'invalidResponse' };
		const details = {
			...presentation,
			...(administratorMessage ? { administratorMessage } : {}),
			...(retryAt === undefined ? {} : { retryAt })
		};
		if (system.availability === 'maintenance') return { ...details, state: 'maintenance' };
		if (system.availability === 'temporarily_unavailable')
			return { ...details, state: 'unavailable' };
		if (system.availability !== 'ready') return { ...details, state: 'serverIncompatible' };
		const compatibilityReason = compatibilityReasonFromWire(system.compatibility_reason);
		switch (system.compatibility) {
			case 'update_required':
				return { ...details, state: 'updateRequired', compatibilityReason };
			case 'server_incompatible':
				return { ...details, state: 'serverIncompatible', compatibilityReason };
			case 'unsupported_target':
				return { ...details, state: 'unsupportedTarget' };
			case 'compatible':
				break;
			default:
				return { ...details, state: 'serverIncompatible', compatibilityReason: 'unknown' };
		}
		const authorization = record(discovery.desktop_authorization);
		if (
			authorization.protocol !== 'proctor-desktop-authorization' ||
			!Number.isSafeInteger(authorization.minimum_version) ||
			!Number.isSafeInteger(authorization.maximum_version) ||
			(authorization.minimum_version as number) < 1 ||
			(authorization.minimum_version as number) > target.authorizationProtocol ||
			(authorization.maximum_version as number) < target.authorizationProtocol
		) {
			return { ...details, state: 'authorizationUnsupported' };
		}
		const capabilities = record(discovery.capabilities);
		if (capabilities.desktop_authorization === false)
			return { ...details, state: 'authorizationDisabled' };
		if (capabilities.desktop_authorization !== true)
			return { ...details, state: 'invalidResponse' };
		return { ...details, state: 'ready', identity };
	} catch {
		return { ...presentation, state: 'invalidResponse' };
	}
}

function compatibilityReasonFromWire(
	value: unknown
): NonNullable<LaunchIdentityProjection['compatibilityReason']> {
	switch (value) {
		case 'release_too_old':
			return 'releaseTooOld';
		case 'release_too_new':
			return 'releaseTooNew';
		case 'realtime_protocol_too_old':
			return 'realtimeTooOld';
		case 'realtime_protocol_too_new':
			return 'realtimeTooNew';
		case 'build_revoked':
			return 'buildRevoked';
		case 'build_unrecognized':
			return 'buildUnrecognized';
		default:
			return 'unknown';
	}
}
function isLoopback(host: string): boolean {
	return host === '127.0.0.1' || host === '[::1]' || host === 'localhost';
}
function record(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('Invalid readiness response');
	return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, allowEmpty = false): string {
	if (
		typeof value !== 'string' ||
		(!allowEmpty && !value.trim()) ||
		value.length > maximum ||
		/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)
	)
		throw new TypeError('Invalid public text');
	return value;
}
function identifier(value: unknown): string {
	const result = text(value, 128);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(result))
		throw new TypeError('Invalid public identity');
	return result;
}
function timestamp(value: unknown): number {
	const result = Date.parse(text(value, 64));
	if (!Number.isFinite(result)) throw new TypeError('Invalid server timestamp');
	return result;
}
