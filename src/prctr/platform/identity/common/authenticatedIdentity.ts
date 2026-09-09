/** Sanitized account context. Navigation availability never grants an operation. */
export interface AuthenticatedIdentity {
	readonly principalId: string;
	readonly sessionId: string;
	readonly institutionOrigin: string;
	readonly institutionName: string;
	readonly displayName: string;
	readonly availableProductAreas: readonly (
		'account' | 'settings' | 'student_activity' | 'exam_management' | 'administration'
	)[];
	readonly noCurrentAffiliation: boolean;
	readonly noAssignedAccess: boolean;
}
export function validateAuthenticatedIdentity(value: unknown): AuthenticatedIdentity {
	if (!value || typeof value !== 'object') throw new TypeError('Invalid authenticated identity');
	const item = value as Record<string, unknown>;
	for (const field of ['principalId', 'sessionId'])
		if (typeof item[field] !== 'string' || !/^[a-z0-9]{26}$/.test(item[field]))
			throw new TypeError('Invalid authenticated binding');
	for (const field of ['institutionOrigin', 'institutionName', 'displayName'])
		if (typeof item[field] !== 'string' || item[field].length > 2048)
			throw new TypeError('Invalid authenticated identity');
	if (
		typeof item.noCurrentAffiliation !== 'boolean' ||
		typeof item.noAssignedAccess !== 'boolean' ||
		!Array.isArray(item.availableProductAreas) ||
		item.availableProductAreas.length > 5 ||
		item.availableProductAreas.some(
			(v) =>
				![
					'account',
					'settings',
					'student_activity',
					'exam_management',
					'administration'
				].includes(v as string)
		)
	)
		throw new TypeError('Invalid authenticated context');
	return Object.freeze({
		principalId: item.principalId as string,
		sessionId: item.sessionId as string,
		institutionOrigin: item.institutionOrigin as string,
		institutionName: item.institutionName as string,
		displayName: item.displayName as string,
		availableProductAreas: Object.freeze([
			...new Set(item.availableProductAreas)
		]) as AuthenticatedIdentity['availableProductAreas'],
		noCurrentAffiliation: item.noCurrentAffiliation,
		noAssignedAccess: item.noAssignedAccess
	});
}
