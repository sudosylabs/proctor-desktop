/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export type BrowserBlockedConsequence = 'activity' | 'integrityEvidence';
export interface BrowserPolicyRuleInput { readonly id: string; readonly origin: string; readonly pathPrefix?: string; readonly includeSubdomains?: boolean; readonly allowRedirects: boolean; readonly blockedConsequence: BrowserBlockedConsequence; readonly institutionHttpException?: boolean }
export interface BrowserPolicyInput { readonly schemaVersion: 1; readonly attemptId: string; readonly participationGeneration: number; readonly revision: string; readonly ordinal: number; readonly digest: string; readonly rules: readonly BrowserPolicyRuleInput[] }
export interface BrowserPolicyRule { readonly id: string; readonly scheme: 'http' | 'https'; readonly host: string; readonly port: string; readonly origin: string; readonly pathPrefix: string; readonly includeSubdomains: boolean; readonly allowRedirects: boolean; readonly blockedConsequence: BrowserBlockedConsequence; readonly institutionHttpException: boolean }
export interface BrowserPolicy { readonly schemaVersion: 1; readonly attemptId: string; readonly participationGeneration: number; readonly revision: string; readonly ordinal: number; readonly digest: string; readonly rules: readonly BrowserPolicyRule[] }
export interface BrowserPolicyValidationOptions { readonly institutionOrigin?: string }
export interface BrowserActivityLocation { readonly scheme: string; readonly host: string; readonly port: string; readonly path: string }
export type BrowserNavigationDecision =
	| { readonly allowed: true; readonly navigationUrl: string; readonly location: BrowserActivityLocation; readonly rule: BrowserPolicyRule }
	| { readonly allowed: false; readonly location: BrowserActivityLocation; readonly reason: 'credentials' | 'fragmentSelector' | 'invalidUrl' | 'path' | 'port' | 'redirectDenied' | 'scheme' | 'unlistedOrigin'; readonly consequence: BrowserBlockedConsequence; readonly matchedRuleId?: string };

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const digestPattern = /^[a-z0-9]+:[A-Za-z0-9_-]{8,256}$/iu;

export function validateBrowserPolicy(input: unknown, options: BrowserPolicyValidationOptions = {}): BrowserPolicy {
	if (!isRecord(input) || !hasExactKeys(input, ['schemaVersion', 'attemptId', 'participationGeneration', 'revision', 'ordinal', 'digest', 'rules'])) throw new TypeError('Browser Policy must use the exact supported schema');
	if (input.schemaVersion !== 1 || typeof input.attemptId !== 'string' || !identifierPattern.test(input.attemptId) || typeof input.revision !== 'string' || !identifierPattern.test(input.revision) || typeof input.digest !== 'string' || !digestPattern.test(input.digest)) throw new TypeError('Browser Policy identity is invalid');
	if (!Number.isSafeInteger(input.participationGeneration) || (input.participationGeneration as number) <= 0 || !Number.isSafeInteger(input.ordinal) || (input.ordinal as number) <= 0) throw new TypeError('Browser Policy generation is invalid');
	if (!Array.isArray(input.rules) || input.rules.length === 0 || input.rules.length > 128) throw new TypeError('Browser Policy must contain 1 to 128 rules');
	const ids = new Set<string>(); const signatures = new Set<string>(); const rules: BrowserPolicyRule[] = [];
	for (const inputRule of input.rules) {
		if (!isRecord(inputRule) || !hasRequiredAndOptionalKeys(inputRule, ['id', 'origin', 'allowRedirects', 'blockedConsequence'], ['pathPrefix', 'includeSubdomains', 'institutionHttpException'])) throw new TypeError('Browser Policy rule must use the exact supported schema');
		if (typeof inputRule.id !== 'string' || !identifierPattern.test(inputRule.id) || ids.has(inputRule.id)) throw new TypeError('Browser Policy rule ID is invalid or duplicated'); ids.add(inputRule.id);
		if (typeof inputRule.allowRedirects !== 'boolean' || (inputRule.blockedConsequence !== 'activity' && inputRule.blockedConsequence !== 'integrityEvidence')) throw new TypeError('Browser Policy rule behavior is invalid');
		if ('pathPrefix' in inputRule && typeof inputRule.pathPrefix !== 'string' || 'includeSubdomains' in inputRule && typeof inputRule.includeSubdomains !== 'boolean' || 'institutionHttpException' in inputRule && typeof inputRule.institutionHttpException !== 'boolean') throw new TypeError('Browser Policy optional rule fields are invalid');
		if (typeof inputRule.origin !== 'string') throw new TypeError('Browser Policy origin is invalid');
		const institutionHttpException = inputRule.institutionHttpException === true; const origin = canonicalOrigin(inputRule.origin, institutionHttpException); const pathPrefix = canonicalPolicyPath(typeof inputRule.pathPrefix === 'string' ? inputRule.pathPrefix : '/');
		if (institutionHttpException && origin.scheme !== 'http') throw new TypeError('Browser Policy HTTP exception must identify an HTTP origin');
		if (origin.scheme === 'http') assertInstitutionHttpOrigin(origin, options.institutionOrigin);
		const includeSubdomains = inputRule.includeSubdomains === true; const signature = `${origin.scheme}|${origin.host}|${origin.port}|${pathPrefix}|${includeSubdomains}`; if (signatures.has(signature)) throw new TypeError('Browser Policy contains an ambiguous duplicate rule'); signatures.add(signature);
		rules.push(Object.freeze({ id: inputRule.id, scheme: origin.scheme, host: origin.host, port: origin.port, origin: origin.origin, pathPrefix, includeSubdomains, allowRedirects: inputRule.allowRedirects, blockedConsequence: inputRule.blockedConsequence, institutionHttpException }));
	}
	return Object.freeze({ schemaVersion: 1, attemptId: input.attemptId, participationGeneration: input.participationGeneration as number, revision: input.revision, ordinal: input.ordinal as number, digest: input.digest, rules: Object.freeze(rules) });
}

export function decideBrowserNavigation(policy: BrowserPolicy, rawUrl: string, options: { readonly redirectFromRuleId?: string; readonly rejectFragment?: boolean } = {}): BrowserNavigationDecision {
	const parsed = parseNavigationUrl(rawUrl); if (parsed.kind === 'blocked') return parsed.decision;
	if (options.rejectFragment === true && parsed.url.hash !== '') return blocked(parsed.location, 'fragmentSelector');
	const originRules = policy.rules.filter(candidate => originMatches(candidate, parsed.url)); const rule = originRules.find(candidate => pathMatches(candidate.pathPrefix, parsed.location.path));
	if (rule === undefined) return blocked(parsed.location, originRules.length === 0 ? 'unlistedOrigin' : 'path', originRules[0]);
	if (parsed.url.protocol === 'http:' && !rule.institutionHttpException) return blocked(parsed.location, 'scheme', rule);
	if (options.redirectFromRuleId !== undefined) { const source = policy.rules.find(candidate => candidate.id === options.redirectFromRuleId); if (source === undefined || !source.allowRedirects) return blocked(parsed.location, 'redirectDenied', source); }
	parsed.url.username = ''; parsed.url.password = ''; parsed.url.hash = '';
	return Object.freeze({ allowed: true, navigationUrl: parsed.url.toString(), location: parsed.location, rule });
}

export function redactedBrowserLocation(rawUrl: string): BrowserActivityLocation {
	const parsed = parseNavigationUrl(rawUrl); return parsed.kind === 'allowed' ? parsed.location : parsed.decision.location;
}

export function validateBrowserActivityLocation(value: unknown, requireWebOrigin = false): BrowserActivityLocation {
	if (!isRecord(value) || !hasExactKeys(value, ['scheme', 'host', 'port', 'path']) || typeof value.scheme !== 'string' || typeof value.host !== 'string' || typeof value.port !== 'string' || typeof value.path !== 'string' || !/^[a-z][a-z0-9+.-]{0,31}$/u.test(value.scheme) || value.path.length === 0 || value.path.length > 2048 || !value.path.startsWith('/') || value.path.includes('?') || value.path.includes('#') || /[\u0000-\u001f\u007f]/u.test(value.path)) throw new TypeError('Browser Activity location is invalid');
	if (value.host !== '') validateHost(value.host); if (value.host === '' && value.port !== '') throw new TypeError('Browser Activity location port requires a host'); validatePort(value.port);
	if (requireWebOrigin && ((value.scheme !== 'http' && value.scheme !== 'https') || value.host === '')) throw new TypeError('Successful Browser Activity requires an HTTP(S) origin');
	if ((value.scheme === 'http' || value.scheme === 'https') && value.host !== '') {
		let canonical: URL; try { canonical = new URL(`${value.scheme}://${value.host}${value.port === '' ? '' : `:${value.port}`}${value.path}`); } catch { throw new TypeError('Browser Activity web location is not canonical'); }
		if (canonical.protocol !== `${value.scheme}:` || canonical.hostname !== value.host || canonical.port !== value.port || canonical.pathname !== value.path || canonical.search !== '' || canonical.hash !== '') throw new TypeError('Browser Activity web location is not canonical');
	}
	return Object.freeze({ scheme: value.scheme, host: value.host, port: value.port, path: value.path });
}

function canonicalOrigin(raw: string, httpException: boolean): Pick<BrowserPolicyRule, 'host' | 'origin' | 'port' | 'scheme'> {
	if (raw.length > 2048 || /[^\x20-\x7e]/u.test(raw)) throw new TypeError('Browser Policy origin must be bounded ASCII');
	let url: URL; try { url = new URL(raw); } catch { throw new TypeError('Browser Policy origin is invalid'); }
	if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') throw new TypeError('Browser Policy origin must not contain credentials, path, query, or fragment');
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && httpException)) throw new TypeError('Browser Policy origin must use HTTPS unless its HTTP exception is explicit');
	validateHost(url.hostname); validatePort(url.port); const scheme = url.protocol.slice(0, -1) as 'http' | 'https'; return Object.freeze({ scheme, host: url.hostname.toLowerCase(), port: url.port, origin: url.origin });
}

function assertInstitutionHttpOrigin(origin: Pick<BrowserPolicyRule, 'host' | 'port' | 'scheme'>, institutionOrigin: string | undefined): void {
	if (institutionOrigin === undefined) throw new TypeError('Browser Policy HTTP exception requires an Institution origin binding');
	let institution: URL; try { institution = new URL(institutionOrigin); } catch { throw new TypeError('Institution origin binding is invalid'); }
	if (institution.protocol !== 'https:' || institution.username !== '' || institution.password !== '' || institution.pathname !== '/' || institution.search !== '' || institution.hash !== '') throw new TypeError('Institution origin binding must be an exact HTTPS origin');
	validateHost(institution.hostname); validatePort(institution.port);
	if (origin.scheme !== 'http' || origin.host !== institution.hostname.toLowerCase() || origin.port !== institution.port) throw new TypeError('Browser Policy HTTP exception is outside the bound Institution origin');
}

function canonicalPolicyPath(raw: string): string {
	if (raw.length === 0 || raw.length > 2048 || !raw.startsWith('/') || raw.includes('?') || raw.includes('#') || raw.includes('\\') || /%2f|%5c/iu.test(raw)) throw new TypeError('Browser Policy path prefix is invalid');
	let url: URL; try { url = new URL(raw, 'https://policy.invalid'); } catch { throw new TypeError('Browser Policy path prefix is invalid'); }
	if (url.pathname !== raw || url.pathname.split('/').some(segment => segment === '.' || segment === '..')) throw new TypeError('Browser Policy path prefix must already be normalized');
	return raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function parseNavigationUrl(raw: string): { readonly kind: 'allowed'; readonly url: URL; readonly location: BrowserActivityLocation } | { readonly kind: 'blocked'; readonly decision: Extract<BrowserNavigationDecision, { allowed: false }> } {
	if (typeof raw !== 'string' || raw.length === 0 || raw.length > 8192 || /[\u0000-\u001f\u007f]/u.test(raw)) return { kind: 'blocked', decision: blocked(Object.freeze({ scheme: 'invalid', host: '', port: '', path: '/' }), 'invalidUrl') };
	let url: URL; try { url = new URL(raw); } catch { return { kind: 'blocked', decision: blocked(Object.freeze({ scheme: safeScheme(raw), host: '', port: '', path: '/' }), 'invalidUrl') }; }
	const scheme = url.protocol.slice(0, -1).toLowerCase(); if (url.username !== '' || url.password !== '') { const authority = safeAuthority(url.hostname, url.port); return { kind: 'blocked', decision: blocked(Object.freeze({ scheme, ...authority, path: safePath(url.pathname) }), 'credentials') }; }
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return { kind: 'blocked', decision: blocked(Object.freeze({ scheme, host: '', port: '', path: '/' }), 'scheme') };
	try { validateHost(url.hostname); validatePort(url.port); } catch { return { kind: 'blocked', decision: blocked(Object.freeze({ scheme, host: safeHost(url.hostname), port: '', path: safePath(url.pathname) }), 'port') }; }
	const path = safePath(url.pathname); return { kind: 'allowed', url, location: Object.freeze({ scheme, host: url.hostname.toLowerCase(), port: url.port, path }) };
}

function validateHost(host: string): void { if (host.length === 0 || host.length > 253 || host.endsWith('.') || host.includes('..') || host.split('.').some(label => label.length === 0 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label) || label.toLowerCase().startsWith('xn--'))) throw new TypeError('Browser host is invalid or uses unsupported IDN form'); }
function validatePort(port: string): void { if (port !== '' && (!/^\d{1,5}$/u.test(port) || Number(port) < 1 || Number(port) > 65535)) throw new TypeError('Browser port is invalid'); }
function originMatches(rule: BrowserPolicyRule, url: URL): boolean { const host = url.hostname.toLowerCase(); return rule.scheme === url.protocol.slice(0, -1) && rule.port === url.port && (host === rule.host || (rule.includeSubdomains && host.endsWith(`.${rule.host}`))); }
function pathMatches(prefix: string, path: string): boolean { return prefix === '/' || path === prefix || path.startsWith(`${prefix}/`); }
function blocked(location: BrowserActivityLocation, reason: Extract<BrowserNavigationDecision, { allowed: false }>['reason'], rule?: BrowserPolicyRule): Extract<BrowserNavigationDecision, { allowed: false }> { return Object.freeze({ allowed: false, location, reason, consequence: rule?.blockedConsequence ?? 'activity', ...(rule === undefined ? {} : { matchedRuleId: rule.id }) }); }
function safeScheme(raw: string): string { const match = /^([A-Za-z][A-Za-z0-9+.-]{0,31}):/u.exec(raw); return match?.[1]?.toLowerCase() ?? 'invalid'; }
function safeHost(host: string): string { try { validateHost(host); return host.toLowerCase(); } catch { return ''; } }
function safePort(port: string): string { try { validatePort(port); return port; } catch { return ''; } }
function safeAuthority(host: string, port: string): Pick<BrowserActivityLocation, 'host' | 'port'> { const safe = safeHost(host); return Object.freeze({ host: safe, port: safe === '' ? '' : safePort(port) }); }
function safePath(path: string): string { if (path.length === 0) return '/'; const value = path.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 2048); return value.startsWith('/') ? value : '/'; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function hasRequiredAndOptionalKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean { const allowed = new Set([...required, ...optional]); return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.has(key)); }
