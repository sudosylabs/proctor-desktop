/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CandidateWindowHostEvent } from './candidateWindowState.js';

/**
 * The native agent's host events for the CandidateWindow and the print gate, from what Electron
 * main observes. The agent's capabilities define the shapes (`candidate_window.rs`,
 * `printing.rs`); nothing here interprets them.
 */
export type CandidateHostEvent =
	| { readonly attach: { readonly window: string } }
	| {
			readonly state: {
				readonly presence: 'present' | 'absent';
				readonly focus: 'focused' | 'not_focused' | 'unknown';
				readonly visibility: 'visible' | 'hidden' | 'unknown';
				readonly placement: 'maximized' | 'normal' | 'minimized' | 'fullscreen' | 'unknown';
			};
	  }
	| { readonly close_attempted: Record<string, never> }
	| { readonly detach: Record<string, never> };

export const PRINT_BLOCKED: { readonly print_blocked: Record<string, never> } = {
	print_blocked: {}
};
export const DETACH: CandidateHostEvent = { detach: {} };

/**
 * The attach event from a window's media source ID (`window:<id>:<n>`), whose ID is the
 * CoreGraphics window number on macOS and the window handle on Windows — the identity the agent
 * reads the window by. `undefined` when the ID is not of that form.
 */
export function attachEvent(mediaSourceId: string): CandidateHostEvent | undefined {
	const match = /^window:(\d{1,20}):\d+$/.exec(mediaSourceId);
	return match?.[1] === undefined ? undefined : { attach: { window: match[1] } };
}

/**
 * The agent's event for one enforcer event. An unknown presence is reported absent, so the
 * window rule fails closed; `undefined` when the event carries no window state.
 */
export function hostEvent(event: CandidateWindowHostEvent): CandidateHostEvent | undefined {
	if (event.kind === 'close_attempt') return { close_attempted: {} };
	const window = event.window;
	if (window === undefined) return undefined;
	return {
		state: {
			presence: window.presence === 'present' ? 'present' : 'absent',
			focus: window.focus,
			visibility: window.visibility === 'not_visible' ? 'hidden' : window.visibility,
			placement: window.placement
		}
	};
}
