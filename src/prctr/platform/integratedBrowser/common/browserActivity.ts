/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	validateBrowserActivityLocation,
	type BrowserActivityLocation,
	type BrowserBlockedConsequence
} from './browserPolicy.js';

export type BrowserActivityKind =
	| 'blockedTopLevelNavigation'
	| 'browserClosed'
	| 'browserOpened'
	| 'topLevelNavigation'
	| 'topLevelRedirect';
export interface BrowserActivityScope {
	readonly attemptId: string;
	readonly participationGeneration: number;
	readonly policyRevision: string;
	readonly policyDigest: string;
}
export type BrowserBlockReason =
	| 'scheme_not_allowed'
	| 'origin_not_allowed'
	| 'path_not_allowed'
	| 'redirect_not_allowed'
	| 'invalid_url';
export interface BrowserActivityRecord {
	readonly sourceInstanceId: string;
	readonly sequence: number;
	readonly participationGeneration: number;
	readonly kind: BrowserActivityKind;
	readonly clientOccurredAtMs: number;
	readonly location?: BrowserActivityLocation;
	readonly matchedRuleId?: string;
	readonly blockedConsequence?: BrowserBlockedConsequence;
	readonly blockReason?: BrowserBlockReason;
	readonly redirectFromSequence?: number;
}
export interface BrowserActivityGap {
	readonly from: number;
	readonly to: number;
	readonly reason: 'corruptStore' | 'lostKey' | 'overflow';
}
export interface BrowserActivityState {
	readonly schemaVersion: 1;
	readonly scope: BrowserActivityScope;
	readonly sourceInstanceId: string;
	readonly highestAcknowledged: number;
	readonly lastSequence: number;
	readonly records: readonly BrowserActivityRecord[];
	readonly gaps: readonly BrowserActivityGap[];
	readonly sealed: boolean;
}
export interface BrowserActivitySeal {
	readonly sourceInstanceId: string;
	readonly participationGeneration: number;
	readonly highestAcknowledged: number;
	readonly finalSequence: number;
	readonly gaps: readonly BrowserActivityGap[];
	readonly sealed: true;
}
export type ProtectedBrowserActivityLoad =
	| { readonly kind: 'available'; readonly state?: BrowserActivityState }
	| { readonly kind: 'corruptStore' | 'lostKey' };
export type ProtectedBrowserActivityMutation =
	| { readonly kind: 'appendRecord'; readonly record: BrowserActivityRecord }
	| { readonly kind: 'appendGap'; readonly gap: BrowserActivityGap }
	| {
			readonly kind: 'acknowledge';
			readonly highestContiguousSequence: number;
			readonly requestedGaps: readonly number[];
	  }
	| { readonly kind: 'seal'; readonly finalSequence: number };
export interface ProtectedBrowserActivityPort {
	load(scope: BrowserActivityScope): Promise<ProtectedBrowserActivityLoad>;
	replace(state: BrowserActivityState): Promise<void>;
	/** Atomically validates and applies the ordered mutations, initializing an absent source at sequence zero before the first mutation. */
	apply(
		scope: BrowserActivityScope,
		sourceInstanceId: string,
		mutations: readonly ProtectedBrowserActivityMutation[]
	): Promise<void>;
}
export interface BrowserActivityDeliveryAck {
	readonly sourceInstanceId: string;
	readonly highestContiguousSequence: number;
	readonly requestedGaps: readonly number[];
}
export interface BrowserActivityDeliveryPort {
	deliver(
		scope: BrowserActivityScope,
		sourceInstanceId: string,
		records: readonly BrowserActivityRecord[],
		priorAcknowledgement: number
	): Promise<BrowserActivityDeliveryAck>;
}
export interface BrowserActivityIdentity {
	nextSourceInstanceId(): string;
}
export interface BrowserActivityClock {
	now(): number;
}

export function validateBrowserActivityRecord(value: unknown): BrowserActivityRecord {
	if (!isRecord(value) || !isActivityKind(value.kind))
		throw new TypeError('Browser Activity kind is invalid');
	const lifecycle = value.kind === 'browserOpened' || value.kind === 'browserClosed';
	const blocked = value.kind === 'blockedTopLevelNavigation';
	const successfulNavigation =
		value.kind === 'topLevelNavigation' || value.kind === 'topLevelRedirect';
	const keys = [
		'sourceInstanceId',
		'sequence',
		'participationGeneration',
		'kind',
		'clientOccurredAtMs'
	];
	if (!lifecycle) keys.push('location');
	if (value.matchedRuleId !== undefined) keys.push('matchedRuleId');
	if (blocked) keys.push('blockedConsequence');
	if (value.blockReason !== undefined) keys.push('blockReason');
	if (value.redirectFromSequence !== undefined) keys.push('redirectFromSequence');
	if (
		!hasExactKeys(value, keys) ||
		!boundedIdentifier(value.sourceInstanceId) ||
		!Number.isSafeInteger(value.sequence) ||
		(value.sequence as number) <= 0 ||
		!Number.isSafeInteger(value.participationGeneration) ||
		(value.participationGeneration as number) <= 0 ||
		!Number.isSafeInteger(value.clientOccurredAtMs) ||
		(value.clientOccurredAtMs as number) < 0
	)
		throw new TypeError('Browser Activity record identity is invalid');
	if (
		lifecycle &&
		(value.location !== undefined ||
			value.matchedRuleId !== undefined ||
			value.blockedConsequence !== undefined)
	)
		throw new TypeError('Browser lifecycle activity cannot carry navigation details');
	const location = lifecycle
		? undefined
		: validateBrowserActivityLocation(value.location, successfulNavigation);
	if (value.matchedRuleId !== undefined && !boundedIdentifier(value.matchedRuleId))
		throw new TypeError('Browser Activity rule identity is invalid');
	if (successfulNavigation && value.matchedRuleId === undefined)
		throw new TypeError('Successful Browser Activity requires the matched Browser Policy rule');
	if (blocked && !isBlockedConsequence(value.blockedConsequence))
		throw new TypeError('Blocked Browser Activity requires a valid consequence');
	if (
		value.blockReason !== undefined &&
		(!blocked ||
			![
				'scheme_not_allowed',
				'origin_not_allowed',
				'path_not_allowed',
				'redirect_not_allowed',
				'invalid_url'
			].includes(String(value.blockReason)))
	)
		throw new TypeError('Browser block reason is invalid');
	if (
		value.redirectFromSequence !== undefined &&
		((!blocked && value.kind !== 'topLevelRedirect') ||
			!Number.isSafeInteger(value.redirectFromSequence) ||
			Number(value.redirectFromSequence) < 1 ||
			Number(value.redirectFromSequence) >= Number(value.sequence))
	)
		throw new TypeError('Browser redirect predecessor is invalid');
	return Object.freeze({
		...(value.blockReason === undefined
			? {}
			: { blockReason: value.blockReason as BrowserBlockReason }),
		...(value.redirectFromSequence === undefined
			? {}
			: { redirectFromSequence: value.redirectFromSequence as number }),
		sourceInstanceId: value.sourceInstanceId as string,
		sequence: value.sequence as number,
		participationGeneration: value.participationGeneration as number,
		kind: value.kind,
		clientOccurredAtMs: value.clientOccurredAtMs as number,
		...(location === undefined ? {} : { location }),
		...(value.matchedRuleId === undefined
			? {}
			: { matchedRuleId: value.matchedRuleId as string }),
		...(blocked
			? { blockedConsequence: value.blockedConsequence as BrowserBlockedConsequence }
			: {})
	});
}

function boundedIdentifier(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}
function isActivityKind(value: unknown): value is BrowserActivityKind {
	return (
		typeof value === 'string' &&
		[
			'blockedTopLevelNavigation',
			'browserClosed',
			'browserOpened',
			'topLevelNavigation',
			'topLevelRedirect'
		].includes(value)
	);
}
function isBlockedConsequence(value: unknown): value is BrowserBlockedConsequence {
	return value === 'activity' || value === 'integrityEvidence';
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}
