/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { EffectiveExamSecurityPolicy } from './nativePolicy.js';

/** One release target's signed certification: which capabilities may enforce there. */
export interface CertificationDocument {
	readonly registry_digest: string;
	readonly matrix_id: string;
	readonly release_id: string;
	readonly target_tuple: string;
	readonly capabilities: readonly {
		readonly capability: string;
		readonly enforce_certified: boolean;
	}[];
}

/**
 * Where the running build's certification comes from. Development builds certify every
 * capability; a release reads its verified, signed document. How that document is produced and
 * signed is not decided yet, so a release without one certifies nothing.
 */
export type CertificationEvidence =
	| { readonly kind: 'development' }
	| { readonly kind: 'document'; readonly document: CertificationDocument }
	| { readonly kind: 'none' };

/**
 * The capabilities this policy needs to enforce on its target that the evidence does not certify.
 * Every capability an enforce rule names needs certification (a `flag_and_suspend` family only
 * compiles enforce rules); observe rules run anywhere. Empty means Start may proceed.
 */
export function uncertifiedCapabilities(
	policy: Pick<EffectiveExamSecurityPolicy, 'rules' | 'target_tuple' | 'registry_digest'>,
	evidence: CertificationEvidence
): readonly string[] {
	const needed = [
		...new Set(
			policy.rules.filter((rule) => rule.mode === 'enforce').map((rule) => rule.capability)
		)
	].sort();
	if (evidence.kind === 'development') return [];
	if (evidence.kind === 'none') return needed;
	const document = evidence.document;
	if (
		document.target_tuple !== policy.target_tuple ||
		bareDigest(document.registry_digest) !== bareDigest(policy.registry_digest)
	)
		return needed;
	const certified = new Set(
		document.capabilities
			.filter((entry) => entry.enforce_certified)
			.map((entry) => entry.capability)
	);
	return needed.filter((capability) => !certified.has(capability));
}

/** A SHA-256 digest without its optional `sha256:` prefix. */
function bareDigest(digest: string): string {
	return digest.startsWith('sha256:') ? digest.slice('sha256:'.length) : digest;
}
