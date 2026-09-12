/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	canonicalContractBytes,
	canonicalContractDigest
} from '../../../../platform/serverApi/node/canonicalContract.js';
import type { components } from '../../../../platform/serverApi/common/serverApi.generated.js';
import { validateApiValue } from '../../../../platform/serverApi/node/apiContract.js';
import {
	validateBrowserPolicy,
	type BrowserPolicy
} from '../../../../platform/integratedBrowser/common/browserPolicy.js';
import {
	validateBrowserActivityRecord,
	type BrowserActivityRecord,
	type BrowserActivityScope
} from '../../../../platform/integratedBrowser/common/browserActivity.js';

export type BrowserWireRecord = components['schemas']['BrowserDeliveryRecord'];
export type BrowserSourceStatus = components['schemas']['BrowserSourceStatus'];
export type BrowserReceipt = components['schemas']['BrowserEventReceipt'];
export type BrowserWirePolicy = components['schemas']['CandidateBrowserPolicy'];
export type BrowserStartTransition =
	| { readonly kind: 'initial' }
	| { readonly kind: 'policy_correction'; readonly predecessor_source_session_id: string }
	| {
			readonly kind: 'runtime_reset';
			readonly predecessor_source_session_id: string;
			readonly reason: 'coordinator_restarted' | 'spool_unavailable' | 'source_corrupt';
	  };
export interface BrowserSourceBinding extends BrowserActivityScope {
	readonly participationId: string;
	readonly sourceInstanceId: string;
}

/** Server DTOs enter the privileged owner here, never through a renderer projection. */
export function readBrowserSchema<K extends keyof components['schemas']>(
	name: K,
	value: unknown
): components['schemas'][K] {
	validateApiValue({ $ref: `#/components/schemas/${name}` }, value, true);
	return value as components['schemas'][K];
}

export function mapServerBrowserPolicy(
	value: unknown,
	scope: Pick<BrowserActivityScope, 'attemptId' | 'participationGeneration'>,
	institutionOrigin: string
): {
	readonly policy?: BrowserPolicy;
	readonly startRuleId?: string;
	readonly disclosure: components['schemas']['BrowserActivityDisclosure'];
} {
	const wire = readBrowserSchema('CandidateBrowserPolicy', value);
	const { enabled, rules, start_rule_id } = wire;
	const canonical = {
		enabled,
		...(rules === undefined ? {} : { rules }),
		...(start_rule_id === undefined ? {} : { start_rule_id })
	};
	if (canonicalBrowserDigest(canonical) !== wire.policy_digest)
		throw new TypeError('Browser Policy digest is invalid');
	if (!enabled) return Object.freeze({ disclosure: wire.browser_activity_disclosure });
	if (!rules || !start_rule_id || !rules.some((rule) => rule.rule_id === start_rule_id))
		throw new TypeError('Browser start rule is unavailable');
	const policy = validateBrowserPolicy(
		{
			schemaVersion: 1,
			attemptId: scope.attemptId,
			participationGeneration: scope.participationGeneration,
			revision: wire.policy_revision_id,
			ordinal: wire.policy_revision_number,
			digest: wire.policy_digest,
			rules: rules.map((rule) => ({
				id: rule.rule_id,
				origin: rule.origin,
				pathPrefix: rule.path_prefix,
				includeSubdomains: rule.host_match === 'exact_and_subdomains',
				allowRedirects: rule.allow_redirects,
				blockedConsequence:
					rule.blocked_navigation_outcome === 'record' ? 'activity' : 'integrityEvidence',
				institutionHttpException: rule.institution_http_exception
			}))
		},
		{ institutionOrigin }
	);
	return Object.freeze({
		policy,
		startRuleId: start_rule_id,
		disclosure: wire.browser_activity_disclosure
	});
}

export function browserRecordToWire(
	raw: BrowserActivityRecord,
	scope: BrowserSourceBinding
): BrowserWireRecord {
	const record = validateBrowserActivityRecord(raw);
	if (
		record.sourceInstanceId !== scope.sourceInstanceId ||
		record.participationGeneration !== scope.participationGeneration
	)
		throw new TypeError('Browser record source is invalid');
	const base = {
		sequence: record.sequence,
		policy_revision_id: scope.policyRevision,
		client_occurred_at: new Date(record.clientOccurredAtMs).toISOString()
	};
	let result: BrowserWireRecord;
	if (record.kind === 'browserOpened' || record.kind === 'browserClosed')
		result = {
			...base,
			kind: record.kind === 'browserOpened' ? 'browser_opened' : 'browser_closed'
		};
	else {
		if (!record.location) throw new TypeError('Browser record location is missing');
		const { scheme, host, path, port } = record.location;
		const location = { scheme, host, path, ...(port ? { port } : {}) };
		if (record.kind === 'topLevelNavigation')
			result = {
				...base,
				kind: 'top_level_navigation',
				location,
				matched_rule_id: record.matchedRuleId!
			};
		else if (record.kind === 'topLevelRedirect') {
			if (!record.redirectFromSequence)
				throw new TypeError('Browser redirect provenance is missing');
			result = {
				...base,
				kind: 'top_level_redirect',
				location,
				matched_rule_id: record.matchedRuleId!,
				redirect_from_sequence: record.redirectFromSequence
			};
		} else {
			if (!record.blockReason) throw new TypeError('Browser block reason is missing');
			const minimized =
				record.blockReason === 'invalid_url'
					? { scheme: '', host: '', path: '' }
					: record.blockReason === 'scheme_not_allowed'
						? { scheme, host: '', path: '' }
						: location;
			result = {
				...base,
				kind: 'blocked_top_level_navigation',
				location: minimized,
				block_reason: record.blockReason,
				...(record.matchedRuleId &&
				!['invalid_url', 'scheme_not_allowed'].includes(record.blockReason)
					? { matched_rule_id: record.matchedRuleId }
					: {}),
				...(record.redirectFromSequence
					? { redirect_from_sequence: record.redirectFromSequence }
					: {})
			};
		}
	}
	return readBrowserSchema('BrowserDeliveryRecord', result);
}

/** Shared server-agreement encoder; snapshots include at most 4 MiB detail plus 64 KiB control. */
export function canonicalBrowserBytes(value: unknown): Uint8Array {
	return canonicalContractBytes(value, 4 * 1024 * 1024 + 64 * 1024);
}
export function canonicalBrowserDigest(value: unknown): string {
	return canonicalContractDigest(value, 4 * 1024 * 1024 + 64 * 1024);
}
