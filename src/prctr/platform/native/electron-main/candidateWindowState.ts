/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * The CandidateWindow facts Electron main can see and reports to the native agent as host
 * events. The agent's wire shape for them is the generated `candidate_window` host event; these
 * are the enforcer's own shapes until the wiring maps one onto the other.
 */

export type PlatformFamily = 'macos' | 'windows' | 'linux';

export type CandidateWindowCertainty = 'complete' | 'partial' | 'unknown';
export type CandidateWindowPresence = 'present' | 'absent' | 'unknown';
export type CandidateWindowFocus = 'focused' | 'not_focused' | 'unknown';
export type CandidateWindowVisibility = 'visible' | 'not_visible' | 'unknown';
export type CandidateWindowPlacement =
	'normal' | 'minimized' | 'maximized' | 'fullscreen' | 'unknown';

export interface CandidateWindowBounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface CandidateWindowState {
	readonly certainty: CandidateWindowCertainty;
	readonly presence: CandidateWindowPresence;
	readonly focus: CandidateWindowFocus;
	readonly visibility: CandidateWindowVisibility;
	readonly placement: CandidateWindowPlacement;
	readonly bounds?: CandidateWindowBounds;
	readonly display_target_id?: string;
}

export type CandidateWindowHostEventKind = 'state_refresh' | 'state_transition' | 'close_attempt';

export interface CandidateWindowHostEvent {
	readonly kind: CandidateWindowHostEventKind;
	readonly window?: CandidateWindowState;
}

const oneOf =
	<T extends string>(...values: readonly T[]) =>
	(value: unknown): value is T =>
		typeof value === 'string' && (values as readonly string[]).includes(value);

const isCertainty = oneOf<CandidateWindowCertainty>('complete', 'partial', 'unknown');
const isPresence = oneOf<CandidateWindowPresence>('present', 'absent', 'unknown');
const isFocus = oneOf<CandidateWindowFocus>('focused', 'not_focused', 'unknown');
const isVisibility = oneOf<CandidateWindowVisibility>('visible', 'not_visible', 'unknown');
const isPlacement = oneOf<CandidateWindowPlacement>(
	'normal',
	'minimized',
	'maximized',
	'fullscreen',
	'unknown'
);

function isInteger(value: unknown, minimum: number, maximum: number): boolean {
	return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isBounds(value: unknown): value is CandidateWindowBounds {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const bounds = value as Record<string, unknown>;
	return (
		Object.keys(bounds).every((key) => ['x', 'y', 'width', 'height'].includes(key)) &&
		isInteger(bounds.x, -1_048_576, 1_048_576) &&
		isInteger(bounds.y, -1_048_576, 1_048_576) &&
		isInteger(bounds.width, 1, 262_144) &&
		isInteger(bounds.height, 1, 262_144)
	);
}

/**
 * A window state is coherent: an absent window has no focus, visibility, placement or bounds,
 * and a complete state knows everything about a present window, its display included.
 */
function isCoherent(state: CandidateWindowState): boolean {
	if (state.presence === 'absent')
		return (
			state.focus !== 'focused' &&
			state.visibility !== 'visible' &&
			state.placement === 'unknown' &&
			state.bounds === undefined &&
			state.display_target_id === undefined &&
			(state.certainty !== 'complete' ||
				(state.focus === 'not_focused' && state.visibility === 'not_visible'))
		);
	if (
		state.focus === 'focused' &&
		(state.presence !== 'present' || state.visibility !== 'visible')
	)
		return false;
	if (
		(state.visibility === 'visible' ||
			state.placement !== 'unknown' ||
			state.bounds !== undefined ||
			state.display_target_id !== undefined) &&
		state.presence !== 'present'
	)
		return false;
	return (
		state.certainty !== 'complete' ||
		(state.presence === 'present' &&
			state.focus !== 'unknown' &&
			state.visibility !== 'unknown' &&
			state.placement !== 'unknown' &&
			state.bounds !== undefined &&
			state.display_target_id !== undefined)
	);
}

const STATE_KEYS = [
	'certainty',
	'presence',
	'focus',
	'visibility',
	'placement',
	'bounds',
	'display_target_id'
];

export function isCandidateWindowState(value: unknown): value is CandidateWindowState {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const state = value as Record<string, unknown>;
	const valid =
		Object.keys(state).every((key) => STATE_KEYS.includes(key)) &&
		isCertainty(state.certainty) &&
		isPresence(state.presence) &&
		isFocus(state.focus) &&
		isVisibility(state.visibility) &&
		isPlacement(state.placement) &&
		(state.bounds === undefined || isBounds(state.bounds)) &&
		(state.display_target_id === undefined ||
			(typeof state.display_target_id === 'string' &&
				[...state.display_target_id].length >= 1 &&
				[...state.display_target_id].length <= 128));
	return valid && isCoherent(value as CandidateWindowState);
}
