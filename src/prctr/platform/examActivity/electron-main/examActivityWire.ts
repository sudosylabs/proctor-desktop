import {
	object,
	id,
	validateExamActivityResponse,
	type ExamActivityIntent,
	type ExamActivityResponse
} from '../common/examActivityProtocol.js';

/** Select only candidate-visible fields; never forward raw server objects to the renderer. */
export function readExamActivityWire(
	intent: ExamActivityIntent,
	value: unknown,
	principalId: string,
	registrationId: string
): ExamActivityResponse {
	const v = object(value);
	if (intent.kind === 'context') {
		if (
			id(object(v.user).id) !== principalId ||
			v.current_desktop_registration_id !== registrationId
		)
			throw new TypeError('Context binding mismatch');
		return validateExamActivityResponse({
			kind: 'context',
			context: {
				areas: v.available_product_areas,
				noAffiliation: v.no_current_affiliation,
				noAccess: v.no_assigned_access,
				moreScopes: v.management_scopes_has_more,
				scopes: Array.isArray(v.management_scopes)
					? v.management_scopes.map((value) => {
							const s = object(value);
							return { name: s.display_name, kind: s.scope_type };
						})
					: undefined
			}
		});
	}
	if (intent.kind === 'result') {
		if (v.exam_attempt_id !== intent.attemptId) throw new TypeError('Result binding mismatch');
		return validateExamActivityResponse({
			kind: 'result',
			attemptId: v.exam_attempt_id,
			releasedAt: v.released_at,
			remarks: v.student_remarks_markdown
		});
	}
	return validateExamActivityResponse({
		kind: 'activity',
		serverTime: v.server_time,
		nextCursor: v.next_cursor,
		items: Array.isArray(v.items)
			? v.items.map((value) => {
					const e = object(value);
					return {
						sittingId: e.exam_sitting_id,
						title: e.title,
						academicUnit: object(e.academic_unit).display_name,
						className: object(e.class).display_name,
						startsAt: e.scheduled_start_at,
						endsAt: e.scheduled_end_at,
						activity: e.activity_state,
						access: e.access_state,
						actions: e.allowed_actions,
						attemptId: e.attempt === null ? null : object(e.attempt).id,
						submittedAt:
							e.submission === null ? null : object(e.submission).submitted_at
					};
				})
			: undefined
	});
}
