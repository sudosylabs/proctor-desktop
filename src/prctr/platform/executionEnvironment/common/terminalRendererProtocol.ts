/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	REMOTE_TERMINAL_LIMITS,
	validateTerminalDimensions,
	validateTerminalInput,
	type TerminalDimensions
} from './terminalProtocol.js';

export interface TerminalRendererProjection {
	readonly phase: 'closed' | 'closing' | 'exited' | 'failed' | 'opening' | 'paused' | 'ready';
	readonly availability: 'disabled' | 'enabled' | 'unavailable';
	readonly selector?: string;
	readonly canOpen: boolean;
	readonly canInput: boolean;
	readonly canResize: boolean;
	readonly canClose: boolean;
	readonly failureReason?:
		| 'environmentUnavailable'
		| 'outboundOverflow'
		| 'outputGap'
		| 'outputOverflow'
		| 'projectionFailed'
		| 'serverRejected'
		| 'staleGeneration'
		| 'transportLost'
		| 'workspaceUnacknowledged';
	readonly exitCode?: number;
}
export interface TerminalRendererOutput {
	readonly selector: string;
	readonly sequence: number;
	readonly data: Uint8Array;
}
export type TerminalRendererIntent =
	| {
			readonly kind: 'terminal.open';
			readonly dimensions: TerminalDimensions;
			readonly requireCurrentWorkspace: boolean;
	  }
	| { readonly kind: 'terminal.input'; readonly selector: string; readonly data: Uint8Array }
	| {
			readonly kind: 'terminal.resize';
			readonly selector: string;
			readonly dimensions: TerminalDimensions;
	  }
	| { readonly kind: 'terminal.ackOutput'; readonly selector: string; readonly sequence: number }
	| { readonly kind: 'terminal.close'; readonly selector: string };

export function validateTerminalRendererIntent(value: unknown): TerminalRendererIntent {
	if (!isRecord(value) || typeof value.kind !== 'string')
		throw new TypeError('Terminal intent is invalid');
	if (
		value.kind === 'terminal.open' &&
		Object.keys(value).length === 3 &&
		typeof value.requireCurrentWorkspace === 'boolean'
	)
		return Object.freeze({
			kind: value.kind,
			dimensions: validateDimensions(value.dimensions),
			requireCurrentWorkspace: value.requireCurrentWorkspace
		});
	if (value.kind === 'terminal.input' && Object.keys(value).length === 3)
		return Object.freeze({
			kind: value.kind,
			selector: validateSelector(value.selector),
			data: validateTerminalInput(value.data as Uint8Array)
		});
	if (value.kind === 'terminal.resize' && Object.keys(value).length === 3)
		return Object.freeze({
			kind: value.kind,
			selector: validateSelector(value.selector),
			dimensions: validateDimensions(value.dimensions)
		});
	if (
		value.kind === 'terminal.ackOutput' &&
		Object.keys(value).length === 3 &&
		Number.isSafeInteger(value.sequence) &&
		(value.sequence as number) > 0
	)
		return Object.freeze({
			kind: value.kind,
			selector: validateSelector(value.selector),
			sequence: value.sequence as number
		});
	if (value.kind === 'terminal.close' && Object.keys(value).length === 2)
		return Object.freeze({ kind: value.kind, selector: validateSelector(value.selector) });
	throw new TypeError('Terminal intent is not allowed');
}
export function validateTerminalRendererProjection(value: unknown): TerminalRendererProjection {
	if (
		!isRecord(value) ||
		!isOneOf(value.phase, [
			'closed',
			'closing',
			'exited',
			'failed',
			'opening',
			'paused',
			'ready'
		] as const) ||
		!isOneOf(value.availability, ['disabled', 'enabled', 'unavailable'] as const) ||
		typeof value.canOpen !== 'boolean' ||
		typeof value.canInput !== 'boolean' ||
		typeof value.canResize !== 'boolean' ||
		typeof value.canClose !== 'boolean'
	)
		throw new TypeError('Terminal projection is invalid');
	const allowed = new Set([
		'phase',
		'availability',
		'selector',
		'canOpen',
		'canInput',
		'canResize',
		'canClose',
		'failureReason',
		'exitCode'
	]);
	if (Object.keys(value).some((key) => !allowed.has(key)))
		throw new TypeError('Terminal projection contains privileged fields');
	const selector = value.selector === undefined ? undefined : validateSelector(value.selector);
	const phase = value.phase;
	const bound = selector !== undefined;
	const interactive = phase === 'ready';
	const paused = phase === 'paused';
	const closing = phase === 'closing';
	if (
		((interactive ||
			paused ||
			closing ||
			value.canInput ||
			value.canResize ||
			value.canClose) &&
			!bound) ||
		(value.canOpen && bound) ||
		value.canInput !== interactive ||
		value.canResize !== interactive ||
		value.canClose !== (interactive || paused) ||
		((phase === 'opening' || interactive || value.canInput || value.canResize) &&
			value.availability !== 'enabled') ||
		(value.canOpen &&
			(!['closed', 'exited', 'failed'].includes(phase) || value.availability !== 'enabled'))
	)
		throw new TypeError('Terminal projection selector does not match its capabilities');
	if (
		(phase === 'failed') !== (value.failureReason !== undefined) ||
		(value.failureReason !== undefined &&
			!isOneOf(value.failureReason, [
				'environmentUnavailable',
				'outboundOverflow',
				'outputGap',
				'outputOverflow',
				'projectionFailed',
				'serverRejected',
				'staleGeneration',
				'transportLost',
				'workspaceUnacknowledged'
			] as const))
	)
		throw new TypeError('Terminal failure reason is invalid');
	const exitCode = value.exitCode;
	if (
		(exitCode !== undefined && phase !== 'exited') ||
		(exitCode !== undefined && !isExitCode(exitCode))
	)
		throw new TypeError('Terminal exit code is invalid');
	return Object.freeze({
		phase,
		availability: value.availability,
		...(selector === undefined ? {} : { selector }),
		canOpen: value.canOpen,
		canInput: value.canInput,
		canResize: value.canResize,
		canClose: value.canClose,
		...(value.failureReason === undefined ? {} : { failureReason: value.failureReason }),
		...(exitCode === undefined ? {} : { exitCode })
	});
}
export function validateTerminalRendererOutput(value: unknown): TerminalRendererOutput {
	if (
		!isRecord(value) ||
		Object.keys(value).some(
			(key) => key !== 'selector' && key !== 'sequence' && key !== 'data'
		) ||
		Object.keys(value).length !== 3 ||
		!Number.isSafeInteger(value.sequence) ||
		(value.sequence as number) <= 0 ||
		!(value.data instanceof Uint8Array) ||
		value.data.byteLength === 0 ||
		value.data.byteLength > REMOTE_TERMINAL_LIMITS.outputFrameBytes
	)
		throw new TypeError('Terminal output event is invalid');
	return Object.freeze({
		selector: validateSelector(value.selector),
		sequence: value.sequence as number,
		data: new Uint8Array(value.data)
	});
}
function validateDimensions(value: unknown): TerminalDimensions {
	if (
		!isRecord(value) ||
		Object.keys(value).length !== 2 ||
		!Object.hasOwn(value, 'columns') ||
		!Object.hasOwn(value, 'rows')
	)
		throw new TypeError('Terminal dimensions are invalid');
	return validateTerminalDimensions({
		columns: value.columns as number,
		rows: value.rows as number
	});
}
function validateSelector(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))
		throw new TypeError('Terminal selector is invalid');
	return value;
}
function isExitCode(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 255;
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isOneOf<const T extends readonly string[]>(
	value: unknown,
	choices: T
): value is T[number] {
	return typeof value === 'string' && choices.includes(value as T[number]);
}
