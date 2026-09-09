/** Credential-free terminal identity facts retained across the window replacement. */
export interface DesktopSessionOutcome {
	readonly sequence: number;
	readonly origin: string;
	readonly institutionName: string;
	readonly authentication: 'ending' | 'signedOut';
	readonly sessionValidity: 'verificationRequired' | 'revoked';
	readonly credentialReadiness: 'locked' | 'unavailable';
	readonly reason: 'refreshFailed' | 'signOut';
	readonly localCleanup: 'notRequested' | 'pending' | 'cleared' | 'failed';
	readonly remoteRevocation: 'notRequested' | 'pending' | 'confirmed' | 'unconfirmed';
}
export function validateDesktopSessionOutcome(value: unknown): DesktopSessionOutcome {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new TypeError('Invalid Session outcome');
	const item = value as Record<string, unknown>;
	if (!Number.isSafeInteger(item.sequence) || Number(item.sequence) < 1)
		throw new TypeError('Invalid Session outcome sequence');
	for (const field of ['origin', 'institutionName'])
		if (
			typeof item[field] !== 'string' ||
			!item[field].length ||
			item[field].length > 2048 ||
			/[\u0000-\u001f\u007f]/u.test(item[field])
		)
			throw new TypeError('Invalid Session outcome identity');
	if (
		!['ending', 'signedOut'].includes(item.authentication as string) ||
		!['verificationRequired', 'revoked'].includes(item.sessionValidity as string) ||
		!['locked', 'unavailable'].includes(item.credentialReadiness as string) ||
		!['refreshFailed', 'signOut'].includes(item.reason as string) ||
		!['notRequested', 'pending', 'cleared', 'failed'].includes(item.localCleanup as string) ||
		!['notRequested', 'pending', 'confirmed', 'unconfirmed'].includes(
			item.remoteRevocation as string
		)
	)
		throw new TypeError('Invalid Session outcome state');
	if (
		item.reason === 'refreshFailed'
			? item.authentication !== 'signedOut' ||
				item.sessionValidity !== 'verificationRequired' ||
				item.localCleanup !== 'notRequested' ||
				item.remoteRevocation !== 'notRequested'
			: item.authentication === 'ending'
				? item.localCleanup !== 'pending' || item.remoteRevocation !== 'pending'
				: !['cleared', 'failed'].includes(item.localCleanup as string) ||
					!['confirmed', 'unconfirmed'].includes(item.remoteRevocation as string)
	)
		throw new TypeError('Inconsistent Session outcome');
	if ((item.sessionValidity === 'revoked') !== (item.remoteRevocation === 'confirmed'))
		throw new TypeError('Unproven Session revocation');
	return Object.freeze({
		sequence: Number(item.sequence),
		origin: item.origin as string,
		institutionName: item.institutionName as string,
		authentication: item.authentication,
		sessionValidity: item.sessionValidity,
		credentialReadiness: item.credentialReadiness,
		reason: item.reason,
		localCleanup: item.localCleanup,
		remoteRevocation: item.remoteRevocation
	}) as DesktopSessionOutcome;
}
