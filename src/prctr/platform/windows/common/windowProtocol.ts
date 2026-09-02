export type ProductWindowKind = 'launch' | 'authenticated' | 'candidate';

interface DescriptorBase {
	readonly protocolVersion: 1;
	readonly kind: ProductWindowKind;
	readonly windowId: string;
	readonly institutionOrigin?: string;
}

export interface LaunchWindowDescriptor extends DescriptorBase {
	readonly kind: 'launch';
	readonly institutionOrigin?: string;
}

export interface AuthenticatedWindowDescriptor extends DescriptorBase {
	readonly kind: 'authenticated';
	readonly institutionOrigin: string;
	readonly principalId: string;
	readonly sessionId: string;
	readonly initialDestination: string;
}

export interface CandidateWindowDescriptor extends DescriptorBase {
	readonly kind: 'candidate';
	readonly institutionOrigin: string;
	readonly principalId: string;
	readonly sessionId: string;
	readonly attemptId: string;
	readonly attemptConfigurationRevision: string;
	readonly attemptConfigurationDigest: string;
}

export type ProductWindowDescriptor =
	LaunchWindowDescriptor | AuthenticatedWindowDescriptor | CandidateWindowDescriptor;

export type ProductWindowIntent =
	| { readonly kind: 'launch.changeServer' }
	| { readonly kind: 'launch.signIn' }
	| { readonly kind: 'launch.exit' }
	| { readonly kind: 'authenticated.signOut' }
	| { readonly kind: 'authenticated.joinAttempt'; readonly attemptId: string }
	| { readonly kind: 'authenticated.close' }
	| { readonly kind: 'candidate.requestDeparture' };

export function validateWindowDescriptor(value: unknown): ProductWindowDescriptor {
	if (
		!isRecord(value) ||
		value.protocolVersion !== 1 ||
		!isIdentifier(value.windowId) ||
		!isWindowKind(value.kind)
	)
		throw new TypeError('Invalid product window descriptor');
	if (value.kind === 'launch') {
		if (value.institutionOrigin !== undefined) validateOrigin(value.institutionOrigin);
		return Object.freeze({
			protocolVersion: 1,
			kind: 'launch',
			windowId: value.windowId,
			...(value.institutionOrigin === undefined
				? {}
				: { institutionOrigin: validateOrigin(value.institutionOrigin) })
		});
	}
	const common = {
		protocolVersion: 1 as const,
		kind: value.kind,
		windowId: value.windowId,
		institutionOrigin: validateOrigin(value.institutionOrigin),
		principalId: requireIdentifier(value.principalId),
		sessionId: requireIdentifier(value.sessionId)
	};
	if (value.kind === 'authenticated')
		return Object.freeze({
			...common,
			kind: 'authenticated',
			initialDestination: requireIdentifier(value.initialDestination)
		});
	return Object.freeze({
		...common,
		kind: 'candidate',
		attemptId: requireIdentifier(value.attemptId),
		attemptConfigurationRevision: requireIdentifier(value.attemptConfigurationRevision),
		attemptConfigurationDigest: requireDigest(value.attemptConfigurationDigest)
	});
}

export function validateWindowIntent(
	expected: ProductWindowKind,
	value: unknown
): ProductWindowIntent {
	if (!isRecord(value) || typeof value.kind !== 'string')
		throw new TypeError('Invalid product window intent');
	switch (value.kind) {
		case 'launch.changeServer':
		case 'launch.signIn':
		case 'launch.exit':
			if (expected !== 'launch' || Object.keys(value).length !== 1) break;
			return Object.freeze({ kind: value.kind });
		case 'authenticated.signOut':
		case 'authenticated.close':
			if (expected !== 'authenticated' || Object.keys(value).length !== 1) break;
			return Object.freeze({ kind: value.kind });
		case 'authenticated.joinAttempt':
			if (expected !== 'authenticated' || Object.keys(value).length !== 2) break;
			return Object.freeze({
				kind: value.kind,
				attemptId: requireIdentifier(value.attemptId)
			});
		case 'candidate.requestDeparture':
			if (expected !== 'candidate' || Object.keys(value).length !== 1) break;
			return Object.freeze({ kind: value.kind });
	}
	throw new TypeError(`Intent is not allowed for ${expected} window`);
}

function isWindowKind(value: unknown): value is ProductWindowKind {
	return value === 'launch' || value === 'authenticated' || value === 'candidate';
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isIdentifier(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
function requireIdentifier(value: unknown): string {
	if (!isIdentifier(value)) throw new TypeError('Invalid bounded identifier');
	return value;
}
function requireDigest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-z0-9]+:[A-Za-z0-9_-]{8,256}$/i.test(value))
		throw new TypeError('Invalid digest');
	return value;
}
function validateOrigin(value: unknown): string {
	if (typeof value !== 'string' || value.length > 2048)
		throw new TypeError('Invalid Institution origin');
	const URLConstructor = (
		globalThis as unknown as {
			readonly URL: new (input: string) => {
				readonly protocol: string;
				readonly username: string;
				readonly password: string;
				readonly pathname: string;
				readonly search: string;
				readonly hash: string;
				readonly origin: string;
			};
		}
	).URL;
	const url = new URLConstructor(value);
	if (
		url.protocol !== 'https:' ||
		url.username !== '' ||
		url.password !== '' ||
		url.pathname !== '/' ||
		url.search !== '' ||
		url.hash !== ''
	)
		throw new TypeError('Institution origin must be an HTTPS origin');
	return url.origin;
}
