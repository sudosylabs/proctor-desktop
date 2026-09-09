export const ACCOUNT_MENU_CHANNEL = 'prctr:authenticated:account-menu';
export const accountMenuActions = ['profile', 'sessions', 'settings', 'logout'] as const;
export type AccountMenuAction = (typeof accountMenuActions)[number];
export interface AccountMenuAnchor {
	readonly x: number;
	readonly y: number;
}
export interface AccountMenuClient {
	show(anchor: AccountMenuAnchor): Promise<AccountMenuAction | undefined>;
}
export function validateAccountMenuAnchor(value: unknown): AccountMenuAnchor {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new TypeError('Invalid account menu anchor');
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).length !== 2 ||
		!['x', 'y'].every(
			(key) =>
				typeof record[key] === 'number' &&
				Number.isFinite(record[key]) &&
				Math.abs(record[key] as number) <= 100_000
		)
	)
		throw new TypeError('Invalid account menu anchor');
	return { x: record.x as number, y: record.y as number };
}
export function validateAccountMenuAction(value: unknown): AccountMenuAction | undefined {
	if (value === undefined) return undefined;
	if (!accountMenuActions.includes(value as AccountMenuAction))
		throw new TypeError('Invalid account menu action');
	return value as AccountMenuAction;
}
