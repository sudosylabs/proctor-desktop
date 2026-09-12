import type { ObservableApiCapability } from '../../serverApi/common/apiObservation.js';
/** Session-bound read capability. Routing context is never action authorization. */
export const EXAM_ACTIVITY_CHANNEL = 'prctr:authenticated:exam-activity';
export const productAreas = [
	'account',
	'settings',
	'student_activity',
	'exam_management',
	'administration'
] as const;
export type ProductArea = (typeof productAreas)[number];
export const activityStates = [
	'upcoming',
	'available',
	'in_progress',
	'submitted',
	'results_available',
	'past'
] as const;
export const accessStates = [
	'not_open',
	'joinable',
	'resumable',
	'sitting_paused',
	'await_reallow',
	'blocked_by_other_attempt',
	'not_eligible',
	'submitted',
	'result_available',
	'ended'
] as const;
export interface ProductContext {
	readonly areas: readonly ProductArea[];
	readonly noAffiliation: boolean;
	readonly noAccess: boolean;
	readonly scopes: readonly {
		readonly name: string;
		readonly kind: 'institution' | 'academic_unit';
	}[];
	readonly moreScopes: boolean;
}
export interface ExamActivity {
	readonly sittingId: string;
	readonly title: string;
	readonly academicUnit: string;
	readonly className: string;
	readonly startsAt: string;
	readonly endsAt: string;
	readonly activity: (typeof activityStates)[number];
	readonly access: (typeof accessStates)[number];
	readonly actions: readonly ('enter' | 'resume' | 'view_result')[];
	readonly attemptId: string | null;
	readonly submittedAt: string | null;
}
export type ExamActivityIntent =
	| { readonly kind: 'context' }
	| { readonly kind: 'activity'; readonly cursor?: string }
	| { readonly kind: 'result'; readonly attemptId: string };
export type ExamActivityResponse =
	| { readonly kind: 'context'; readonly context: ProductContext }
	| {
			readonly kind: 'activity';
			readonly serverTime: string;
			readonly items: readonly ExamActivity[];
			readonly nextCursor?: string;
	  }
	| {
			readonly kind: 'result';
			readonly attemptId: string;
			readonly releasedAt: string;
			readonly remarks: string;
	  }
	| {
			readonly kind: 'error';
			readonly reason:
				'unavailable' | 'restricted' | 'sessionEnded' | 'notFound' | 'invalidCursor';
	  };
export interface ExamActivityClient extends ObservableApiCapability<
	ExamActivityIntent,
	ExamActivityResponse
> {
	request(intent: ExamActivityIntent): Promise<ExamActivityResponse>;
}

export function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new TypeError('Expected an object');
	return value as Record<string, unknown>;
}
export function text(value: unknown, max = 2048): string {
	if (
		typeof value !== 'string' ||
		value.length > max ||
		/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
	)
		throw new TypeError('Invalid text');
	return value;
}
export function id(value: unknown): string {
	if (typeof value !== 'string' || !/^[ybndrfg8ejkmcpqxot1uwisza345h769]{26}$/u.test(value))
		throw new TypeError('Invalid ID');
	return value;
}
export function date(value: unknown): string {
	const result = text(value, 64);
	if (!/^\d{4}-\d\d-\d\dT/u.test(result) || !Number.isFinite(Date.parse(result)))
		throw new TypeError('Invalid date');
	return result;
}
export function member<const T extends string>(value: unknown, values: readonly T[]): T {
	if (!values.includes(value as T)) throw new TypeError('Invalid enum');
	return value as T;
}
export function list<T>(value: unknown, max: number, parse: (entry: unknown) => T): readonly T[] {
	if (!Array.isArray(value) || value.length > max) throw new TypeError('Invalid collection');
	return Object.freeze(value.map(parse));
}
function bool(value: unknown): boolean {
	if (typeof value !== 'boolean') throw new TypeError('Invalid boolean');
	return value;
}
export function validateExamActivityIntent(value: unknown): ExamActivityIntent {
	const v = object(value);
	const kind = member(v.kind, ['context', 'activity', 'result']);
	const keys =
		kind === 'context'
			? ['kind']
			: kind === 'activity'
				? ['kind', 'cursor']
				: ['kind', 'attemptId'];
	if (Object.keys(v).some((key) => !keys.includes(key)))
		throw new TypeError('Unexpected intent field');
	if (kind === 'context') return { kind };
	if (kind === 'result') return { kind, attemptId: id(v.attemptId) };
	const cursor = v.cursor === undefined ? undefined : text(v.cursor);
	if (cursor === '') throw new TypeError('Empty cursor');
	return { kind, ...(cursor === undefined ? {} : { cursor }) };
}
export function validateExamActivityResponse(value: unknown): ExamActivityResponse {
	const v = object(value);
	switch (v.kind) {
		case 'context': {
			const c = object(v.context);
			return {
				kind: 'context',
				context: Object.freeze({
					areas: list(c.areas, 5, (area) => member(area, productAreas)),
					noAffiliation: bool(c.noAffiliation),
					noAccess: bool(c.noAccess),
					scopes: list(c.scopes, 20, (value) => {
						const s = object(value);
						return Object.freeze({
							name: text(s.name),
							kind: member(s.kind, ['institution', 'academic_unit'])
						});
					}),
					moreScopes: bool(c.moreScopes)
				})
			};
		}
		case 'activity':
			return {
				kind: 'activity',
				serverTime: date(v.serverTime),
				items: list(v.items, 20, (value) => {
					const e = object(value);
					const actions = list(e.actions, 1, (action) =>
						member(action, ['enter', 'resume', 'view_result'])
					);
					const attemptId = e.attemptId === null ? null : id(e.attemptId);
					if (actions.some((action) => action !== 'enter') && !attemptId)
						throw new TypeError('Missing attempt');
					return Object.freeze({
						sittingId: id(e.sittingId),
						title: text(e.title, 200),
						academicUnit: text(e.academicUnit),
						className: text(e.className),
						startsAt: date(e.startsAt),
						endsAt: date(e.endsAt),
						activity: member(e.activity, activityStates),
						access: member(e.access, accessStates),
						actions,
						attemptId,
						submittedAt: e.submittedAt === null ? null : date(e.submittedAt)
					});
				}),
				...(v.nextCursor === undefined ? {} : { nextCursor: text(v.nextCursor) })
			};
		case 'result':
			return {
				kind: 'result',
				attemptId: id(v.attemptId),
				releasedAt: date(v.releasedAt),
				remarks: text(v.remarks, 8192)
			};
		case 'error':
			return {
				kind: 'error',
				reason: member(v.reason, [
					'unavailable',
					'restricted',
					'sessionEnded',
					'notFound',
					'invalidCursor'
				])
			};
		default:
			throw new TypeError('Unexpected response');
	}
}
