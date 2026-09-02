/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { validateBrowserActivityLocation, type BrowserActivityLocation } from './browserPolicy.js';

export interface IntegratedBrowserProjection { readonly state: 'blocked' | 'closed' | 'opening' | 'open'; readonly policyRevision: string; readonly location?: BrowserActivityLocation; readonly matchedRuleId?: string; readonly canOpen: boolean; readonly canClose: boolean; readonly canGoBack: boolean; readonly canGoForward: boolean; readonly canReload: boolean; readonly blockedReason?: 'attemptInactive' | 'coordinatorFailure' | 'evidenceUnavailable' | 'participationStale' | 'paused' | 'policyUnavailable' | 'postureInvalid' | 'suspended' }
export interface IntegratedBrowserSurfaceBounds { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface IntegratedBrowserSurface { readonly visible: boolean; readonly focus: boolean; readonly bounds: IntegratedBrowserSurfaceBounds }
export type IntegratedBrowserIntent =
	| { readonly kind: 'browser.open'; readonly startRuleId: string }
	| { readonly kind: 'browser.navigate'; readonly url: string }
	| { readonly kind: 'browser.back' | 'browser.close' | 'browser.forward' | 'browser.reload' };

export function validateIntegratedBrowserIntent(value: unknown): IntegratedBrowserIntent {
	if (!isRecord(value) || typeof value.kind !== 'string') throw new TypeError('Integrated browser intent is invalid');
	if (value.kind === 'browser.open' && Object.keys(value).length === 2 && isIdentifier(value.startRuleId)) return Object.freeze({ kind: value.kind, startRuleId: value.startRuleId });
	if (value.kind === 'browser.navigate' && Object.keys(value).length === 2 && typeof value.url === 'string' && value.url.length > 0 && value.url.length <= 8192) return Object.freeze({ kind: value.kind, url: value.url });
	if ((value.kind === 'browser.back' || value.kind === 'browser.close' || value.kind === 'browser.forward' || value.kind === 'browser.reload') && Object.keys(value).length === 1) return Object.freeze({ kind: value.kind });
	throw new TypeError('Integrated browser intent is not allowed');
}

export function validateIntegratedBrowserProjection(value: unknown): IntegratedBrowserProjection {
	if (!isRecord(value) || !hasRequiredAndOptionalKeys(value, ['state', 'policyRevision', 'canOpen', 'canClose', 'canGoBack', 'canGoForward', 'canReload'], ['location', 'matchedRuleId', 'blockedReason']) || !isOneOf(value.state, ['blocked', 'closed', 'opening', 'open'] as const) || !isIdentifier(value.policyRevision) || typeof value.canOpen !== 'boolean' || typeof value.canClose !== 'boolean' || typeof value.canGoBack !== 'boolean' || typeof value.canGoForward !== 'boolean' || typeof value.canReload !== 'boolean') throw new TypeError('Integrated browser projection is invalid');
	const location = value.location === undefined ? undefined : validateBrowserActivityLocation(value.location, true); if (value.matchedRuleId !== undefined && !isIdentifier(value.matchedRuleId)) throw new TypeError('Integrated browser rule identity is invalid');
	if (value.blockedReason !== undefined && !isOneOf(value.blockedReason, ['attemptInactive', 'coordinatorFailure', 'evidenceUnavailable', 'participationStale', 'paused', 'policyUnavailable', 'postureInvalid', 'suspended'] as const)) throw new TypeError('Integrated browser blocked reason is invalid');
	const state = value.state; const blocked = state === 'blocked'; const interactive = state === 'open';
	if (blocked !== (value.blockedReason !== undefined) || (!interactive && (value.canGoBack || value.canGoForward || value.canReload)) || (interactive && (!value.canReload || value.canOpen || !value.canClose)) || (state === 'opening' && (value.canOpen || !value.canClose)) || (state === 'closed' && value.canClose) || (blocked && value.canOpen) || (location === undefined) !== (value.matchedRuleId === undefined)) throw new TypeError('Integrated browser projection state is inconsistent');
	return Object.freeze({ state, policyRevision: value.policyRevision, canOpen: value.canOpen, canClose: value.canClose, canGoBack: value.canGoBack, canGoForward: value.canGoForward, canReload: value.canReload, ...(location === undefined ? {} : { location }), ...(value.matchedRuleId === undefined ? {} : { matchedRuleId: value.matchedRuleId }), ...(value.blockedReason === undefined ? {} : { blockedReason: value.blockedReason }) });
}

export function validateIntegratedBrowserSurface(value: unknown): IntegratedBrowserSurface {
	if (!isRecord(value) || !hasExactKeys(value, ['visible', 'focus', 'bounds']) || typeof value.visible !== 'boolean' || typeof value.focus !== 'boolean' || !isRecord(value.bounds) || !hasExactKeys(value.bounds, ['x', 'y', 'width', 'height'])) throw new TypeError('Integrated browser surface is invalid');
	const bounds = value.bounds;
	if (!isCoordinate(bounds.x) || !isCoordinate(bounds.y) || !isExtent(bounds.width) || !isExtent(bounds.height) || value.focus && !value.visible) throw new TypeError('Integrated browser surface bounds are invalid');
	return Object.freeze({ visible: value.visible, focus: value.focus, bounds: Object.freeze({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }) });
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value); return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function hasRequiredAndOptionalKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean { const allowed = new Set([...required, ...optional]); return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.has(key)); }
function isCoordinate(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= -1_000_000 && (value as number) <= 1_000_000; }
function isExtent(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isIdentifier(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value); }
function isOneOf<const T extends readonly string[]>(value: unknown, choices: T): value is T[number] { return typeof value === 'string' && choices.includes(value as T[number]); }
