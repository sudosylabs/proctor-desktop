import assert from 'node:assert';
import { test } from '../../../../base/common/upstream/testAdapter.ts';
import { decideBrowserNavigation, redactedBrowserLocation, validateBrowserPolicy, type BrowserPolicyInput } from '../../../../../src/prctr/platform/integratedBrowser/common/browserPolicy.ts';
import { validateIntegratedBrowserProjection } from '../../../../../src/prctr/platform/integratedBrowser/common/browserProtocol.ts';

const input: BrowserPolicyInput = { schemaVersion: 1, attemptId: 'attempt:one', participationGeneration: 7, revision: 'browser:1', ordinal: 1, digest: 'sha256:abcdefgh', rules: [
	{ id: 'docs', origin: 'https://docs.example.test', pathPrefix: '/reference', includeSubdomains: true, allowRedirects: true, blockedConsequence: 'activity' },
	{ id: 'institution-http', origin: 'http://legacy.institution.test:8080', allowRedirects: false, blockedConsequence: 'integrityEvidence', institutionHttpException: true }
] };
const validation = Object.freeze({ institutionOrigin: 'https://legacy.institution.test:8080' });

test('browser policy canonicalization matches exact origins, path boundaries and explicit subdomains', () => {
	const policy = validateBrowserPolicy(input, validation); const exact = decideBrowserNavigation(policy, 'https://docs.example.test/reference/api?q=secret#fragment'); assert.strictEqual(exact.allowed, true); if (exact.allowed) { assert.deepStrictEqual(exact.location, { scheme: 'https', host: 'docs.example.test', port: '', path: '/reference/api' }); assert.strictEqual(exact.navigationUrl.includes('q=secret'), true); assert.strictEqual(exact.navigationUrl.includes('#'), false); }
	assert.strictEqual(decideBrowserNavigation(policy, 'https://a.docs.example.test/reference').allowed, true); assert.strictEqual(decideBrowserNavigation(policy, 'https://evildocs.example.test/reference').allowed, false); assert.strictEqual(decideBrowserNavigation(policy, 'https://docs.example.test/references').allowed, false); assert.strictEqual(decideBrowserNavigation(policy, 'http://legacy.institution.test:8080/').allowed, true);
});

test('browser policy rejects ambiguous authoring and prohibited navigation forms', () => {
	assert.throws(() => validateBrowserPolicy({ ...input, rules: [{ ...input.rules[0]!, origin: 'https://user:pass@docs.example.test' }] }, validation), /credentials/u); assert.throws(() => validateBrowserPolicy({ ...input, rules: [{ ...input.rules[0]!, origin: 'https://xn--bcher-kva.example' }] }, validation), /IDN/u); assert.throws(() => validateBrowserPolicy({ ...input, rules: [{ ...input.rules[0]!, pathPrefix: '/a/../b' }] }, validation), /normalized/u); assert.throws(() => validateBrowserPolicy({ ...input, rules: [input.rules[0]!, { ...input.rules[0]!, id: 'again' }] }, validation), /ambiguous/u);
	assert.throws(() => validateBrowserPolicy({ ...input, unexpected: true }, validation), /exact supported schema/u); assert.throws(() => validateBrowserPolicy({ ...input, rules: [{ ...input.rules[0]!, includeSubdomains: 'yes' }] }, validation), /optional rule fields/u); assert.throws(() => validateBrowserPolicy(input), /Institution origin binding/u); assert.throws(() => validateBrowserPolicy(input, { institutionOrigin: 'https://other.example.test:8080' }), /outside the bound Institution/u);
	const policy = validateBrowserPolicy(input, validation); const javascript = decideBrowserNavigation(policy, 'javascript:alert(document.cookie)'); assert.strictEqual(javascript.allowed, false); assert.deepStrictEqual(javascript.location, { scheme: 'javascript', host: '', port: '', path: '/' }); assert.strictEqual(decideBrowserNavigation(policy, 'https://name:secret@docs.example.test/reference').allowed, false); assert.strictEqual(decideBrowserNavigation(policy, 'file:/portable/path').allowed, false);
});

test('redirect permission is checked against the source rule and activity locations strip sensitive URL parts', () => {
	const policy = validateBrowserPolicy(input, validation); assert.strictEqual(decideBrowserNavigation(policy, 'https://docs.example.test/reference', { redirectFromRuleId: 'institution-http' }).allowed, false); assert.strictEqual(decideBrowserNavigation(policy, 'http://legacy.institution.test:8080/', { redirectFromRuleId: 'docs' }).allowed, true); assert.deepStrictEqual(redactedBrowserLocation('https://docs.example.test/reference?q=token#secret'), { scheme: 'https', host: 'docs.example.test', port: '', path: '/reference' });
});

test('renderer browser projections use an exact bounded schema with consistent state capabilities', () => {
	const open = { state: 'open', policyRevision: 'browser:1', location: { scheme: 'https', host: 'docs.example.test', port: '', path: '/reference' }, matchedRuleId: 'docs', canOpen: false, canClose: true, canGoBack: true, canGoForward: false, canReload: true };
	assert.deepStrictEqual(validateIntegratedBrowserProjection(open), open);
	for (const invalid of [
		{ ...open, unexpected: 'leak' },
		{ ...open, location: { ...open.location, path: `/${'x'.repeat(2048)}` } },
		{ ...open, location: { ...open.location, host: 'bad..example.test' } },
		{ ...open, location: { ...open.location, host: 'Docs.example.test' } },
		{ ...open, location: { ...open.location, port: '443' } },
		{ ...open, location: { ...open.location, path: '/reference/../admin' } },
		{ ...open, location: { ...open.location, path: '/reference\\admin' } },
		{ ...open, state: 'closed' },
		{ ...open, state: 'blocked' },
		{ ...open, matchedRuleId: undefined },
		{ ...open, canReload: false }
	]) assert.throws(() => validateIntegratedBrowserProjection(invalid), /projection|location|host|state/u);
	assert.throws(() => validateIntegratedBrowserProjection({ ...open, state: new String('open') }), /projection/u);
	assert.deepStrictEqual(validateIntegratedBrowserProjection({ state: 'closed', policyRevision: 'browser:1', canOpen: false, canClose: false, canGoBack: false, canGoForward: false, canReload: false }), { state: 'closed', policyRevision: 'browser:1', canOpen: false, canClose: false, canGoBack: false, canGoForward: false, canReload: false });
	assert.throws(() => validateIntegratedBrowserProjection({ state: 'blocked', policyRevision: 'browser:1', canOpen: false, canClose: true, canGoBack: false, canGoForward: false, canReload: false, blockedReason: new String('paused') }), /reason/u);
	assert.deepStrictEqual(validateIntegratedBrowserProjection({ state: 'blocked', policyRevision: 'browser:1', canOpen: false, canClose: true, canGoBack: false, canGoForward: false, canReload: false, blockedReason: 'paused' }), { state: 'blocked', policyRevision: 'browser:1', canOpen: false, canClose: true, canGoBack: false, canGoForward: false, canReload: false, blockedReason: 'paused' });
	assert.throws(() => validateIntegratedBrowserProjection({ state: 'blocked', policyRevision: 'browser:1', canOpen: true, canClose: true, canGoBack: false, canGoForward: false, canReload: false, blockedReason: 'paused' }), /inconsistent/u);
});
