/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { BrowserBlockReason, BrowserActivityKind, BrowserActivityRecord, BrowserActivityScope, BrowserActivitySeal } from '../../../../platform/integratedBrowser/common/browserActivity.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import type { BrowserEnforcementDelegate, PrivilegedBrowserEngine } from '../../../../platform/integratedBrowser/common/browserEnforcement.js';
import { decideBrowserNavigation, validateBrowserPolicy, type BrowserActivityLocation, type BrowserBlockedConsequence, type BrowserNavigationDecision, type BrowserPolicy } from '../../../../platform/integratedBrowser/common/browserPolicy.js';
import { validateIntegratedBrowserIntent, type IntegratedBrowserIntent, type IntegratedBrowserProjection } from '../../../../platform/integratedBrowser/common/browserProtocol.js';

export interface IntegratedBrowserGate { readonly attemptState: 'active' | 'ready' | 'submitted' | 'suspended'; readonly participationGeneration: number; readonly paused: boolean; readonly posture: 'checking' | 'compliant' | 'contained' | 'degraded' | 'failed' | 'stopped' | 'uninitialized'; readonly coordinatorAvailable: boolean }
export interface BrowserActivitySink { readonly scope: BrowserActivityScope; append(kind: BrowserActivityKind, details?: { readonly location?: BrowserActivityLocation; readonly matchedRuleId?: string; readonly blockedConsequence?: BrowserBlockedConsequence; readonly blockReason?: BrowserBlockReason; readonly redirectFromSequence?: number }): BrowserActivityRecord | undefined; seal(): BrowserActivitySeal; flush(): Promise<void>; dispose(): void }
export interface BrowserActivitySinkFactory { create(policy: BrowserPolicy): Promise<BrowserActivitySink> }
export class IntegratedBrowserCoordinator implements BrowserEnforcementDelegate {
	readonly #engine: PrivilegedBrowserEngine; readonly #activityFactory: BrowserActivitySinkFactory; readonly #institutionOrigin: string; readonly #listeners = new Set<(projection: IntegratedBrowserProjection) => void>();
	#lastSuccessfulSequence: number | undefined; #ledger: BrowserActivitySink; #policy: BrowserPolicy; #gate: IntegratedBrowserGate; #state: IntegratedBrowserProjection; #lifecycle: 'idle' | 'opening' | 'open' | 'closing' | 'closed' = 'idle'; #opened = false; #closed = false; #closeRecorded = false; #engineClosed = false; #ledgerSealed = false; #ledgerNeedsContinuation = false; #policyUnavailable = false; #policyTransitioning = false; #pendingPolicyTransitions = 0; #lifecycleSerial: Promise<void> = Promise.resolve(); #closePromise: Promise<void> | undefined; #closeRetryable = false; #disposePromise: Promise<void> | undefined; #disposing = false; #disposed = false;
	constructor(policy: BrowserPolicy, gate: IntegratedBrowserGate, engine: PrivilegedBrowserEngine, ledger: BrowserActivitySink, activityFactory: BrowserActivitySinkFactory, institutionOrigin: string) { assertActivityScope(ledger, policy); this.#policy = policy; this.#gate = Object.freeze({ ...gate }); this.#engine = engine; this.#ledger = ledger; this.#activityFactory = activityFactory; this.#institutionOrigin = institutionOrigin; this.#state = this.#deriveProjection(); this.#applyGate(); }
	observe(): IntegratedBrowserProjection { return this.#state; }
	onDidChange(listener: (projection: IntegratedBrowserProjection) => void): { dispose(): void } { this.#listeners.add(listener); return { dispose: () => this.#listeners.delete(listener) }; }
	async handleIntent(raw: unknown): Promise<void> { this.#assertLive(); const intent = validateIntegratedBrowserIntent(raw); if (intent.kind !== 'browser.close') this.#requireIntentGate(); switch (intent.kind) { case 'browser.open': await this.#open(intent); break; case 'browser.navigate': await this.#runOpenCommand(() => this.#navigate(intent.url)); break; case 'browser.back': await this.#runOpenCommand(() => this.#engine.back()); break; case 'browser.forward': await this.#runOpenCommand(() => this.#engine.forward()); break; case 'browser.reload': await this.#runOpenCommand(() => this.#engine.reload()); break; case 'browser.close': await this.closeBrowser(); break; } this.#publish(); }
	async updateGate(gate: IntegratedBrowserGate): Promise<void> { this.#assertLive(); if (gate.participationGeneration < this.#gate.participationGeneration) return; this.#gate = Object.freeze({ ...gate }); this.#applyGate(); if (gate.attemptState === 'suspended' || gate.attemptState === 'submitted') await this.closeBrowser(); else this.#publish(); }
	replacePolicy(rawPolicy: unknown): Promise<void> {
		this.#assertLive();
		const policy = validateBrowserPolicy(rawPolicy, { institutionOrigin: this.#institutionOrigin });
		this.#pendingPolicyTransitions++; this.#policyTransitioning = true; this.#applyGate(); this.#publish();
		const operation = this.#enqueueLifecycle(() => this.#performPolicyReplacement(policy));
		return operation.finally(() => { this.#pendingPolicyTransitions--; this.#policyTransitioning = this.#pendingPolicyTransitions > 0; this.#applyGate(); this.#publish(); });
	}
	async #performPolicyReplacement(policy: BrowserPolicy): Promise<void> {
		if (this.#isClosingOrClosed() || this.#closePromise !== undefined || policy.attemptId !== this.#policy.attemptId || policy.participationGeneration !== this.#policy.participationGeneration || policy.ordinal <= this.#policy.ordinal || policy.revision === this.#policy.revision || policy.digest === this.#policy.digest) throw new TypeError('Browser Policy correction is stale, ambiguous, or outside this participation');
		let next: BrowserActivitySink | undefined;
		try {
			if (!this.#ledgerSealed) { this.#ledger.seal(); this.#ledgerSealed = true; this.#ledgerNeedsContinuation = this.#opened; }
			await this.#ledger.flush();
			next = await this.#activityFactory.create(policy); assertActivityScope(next, policy);
			if (this.#isClosingOrClosed() || this.#closePromise !== undefined || this.#closed) { next.seal(); await next.flush(); throw new Error('Browser Policy correction raced browser closure'); }
			if (this.#opened) next.append('browserOpened');
			const prior = this.#ledger; this.#ledger = next; next = undefined; this.#ledgerSealed = false; this.#ledgerNeedsContinuation = false; this.#closeRecorded = false; this.#policy = policy; this.#lastSuccessfulSequence = undefined; prior.dispose();
			const location = this.#state.location;
			this.#policyUnavailable = location !== undefined && !decideBrowserNavigation(policy, `${location.scheme}://${location.host}${location.port === '' ? '' : `:${location.port}`}${location.path}`).allowed;
		} catch (error) {
			next?.dispose(); this.#policyUnavailable = true; throw error;
		}
	}
	checkTopLevel(url: string, kind: 'navigation' | 'redirect', redirectFromRuleId?: string): BrowserNavigationDecision { const blockedReason = this.#blockedReason(); if (!this.#acceptsEngineActivity() || blockedReason !== undefined) return Object.freeze({ allowed: false, location: Object.freeze({ scheme: 'blocked', host: '', port: '', path: '/' }), reason: 'unlistedOrigin', consequence: 'activity' }); const decision = decideBrowserNavigation(this.#policy, url, kind === 'redirect' ? { redirectFromRuleId } : {}); if (!decision.allowed) this.#recordBlocked(decision, kind === 'redirect' ? this.#lastSuccessfulSequence : undefined); return decision; }
	commitTopLevel(url: string, kind: 'navigation' | 'redirect'): void { if (!this.#acceptsEngineActivity() || this.#blockedReason() !== undefined) return; const decision = decideBrowserNavigation(this.#policy, url); if (!decision.allowed) { this.#recordBlocked(decision); this.#engine.setInputBlocked(true); return; } const prior = this.#lastSuccessfulSequence; const record = this.#ledger.append(kind === 'redirect' ? 'topLevelRedirect' : 'topLevelNavigation', { location: decision.location, matchedRuleId: decision.rule.id, ...(kind === 'redirect' && prior !== undefined ? { redirectFromSequence: prior } : {}) }); this.#lastSuccessfulSequence = record?.sequence; this.#state = Object.freeze({ ...this.#deriveProjection(), location: decision.location, matchedRuleId: decision.rule.id }); this.#emit(); }
	checkSubresource(url: string): boolean { return this.#acceptsEngineActivity() && this.#blockedReason() === undefined && decideBrowserNavigation(this.#policy, url).allowed; }
	blockPopup(url: string): void { if (!this.#acceptsEngineActivity() || this.#blockedReason() !== undefined) return; const decision = decideBrowserNavigation(this.#policy, url); this.#recordBlocked(decision.allowed ? Object.freeze({ allowed: false, location: decision.location, reason: 'unlistedOrigin', consequence: decision.rule.blockedConsequence, matchedRuleId: decision.rule.id }) : decision); }
	async closeBrowser(): Promise<void> {
		if (this.#closed) return;
		if (this.#closePromise !== undefined) return this.#closePromise;
		this.#lifecycle = 'closing'; this.#closeRetryable = false; this.#applyGate(); this.#publish();
		this.#closePromise = this.#enqueueLifecycle(() => this.#performClose());
		try { await this.#closePromise; }
		catch (error) { if (!this.#closed) this.#closeRetryable = true; throw error; }
		finally { if (!this.#closed) { this.#closePromise = undefined; this.#publish(); } }
	}
	async #performClose(): Promise<void> {
		this.#engine.setInputBlocked(true);
		let evidenceError: unknown;
		try { await this.#ensureWritableCloseLedger(); if (this.#opened && !this.#closeRecorded) { this.#ledger.append('browserClosed'); this.#closeRecorded = true; } }
		catch (error) { evidenceError = error; }
		if (!this.#engineClosed) { await this.#engine.close(); this.#engineClosed = true; this.#publish(); }
		if (evidenceError !== undefined) throw evidenceError;
		if (!this.#ledgerSealed) { this.#ledger.seal(); this.#ledgerSealed = true; }
		await this.#ledger.flush(); this.#closed = true; this.#lifecycle = 'closed'; this.#publish();
	}
	async #ensureWritableCloseLedger(): Promise<void> { if (!this.#opened || !this.#ledgerNeedsContinuation) return; await this.#ledger.flush(); const next = await this.#activityFactory.create(this.#policy); try { assertActivityScope(next, this.#policy); next.append('browserOpened'); } catch (error) { next.dispose(); throw error; } const prior = this.#ledger; this.#ledger = next; this.#ledgerSealed = false; this.#ledgerNeedsContinuation = false; this.#closeRecorded = false; prior.dispose(); }
	async #open(intent: Extract<IntegratedBrowserIntent, { kind: 'browser.open' }>): Promise<void> {
		if (this.#lifecycle !== 'idle') throw new Error('Integrated browser source cannot be reopened');
		const rule = this.#policy.rules.find(candidate => candidate.id === intent.startRuleId); if (rule === undefined) throw new Error('Browser start rule is unavailable');
		const url = `${rule.origin}${rule.pathPrefix === '/' ? '/' : rule.pathPrefix}`; this.#lifecycle = 'opening'; this.#applyGate(); this.#publish();
		try {
			this.#ledger.append('browserOpened'); this.#opened = true;
			await this.#enqueueLifecycle(() => this.#engine.open(url));
			if (this.#lifecycle === 'opening') this.#lifecycle = 'open';
		} catch (error) {
			if (!this.#isClosingOrClosed()) { this.#lifecycle = 'closing'; this.#applyGate(); this.#publish(); }
			try { await this.closeBrowser(); } catch (closeError) { throw new AggregateError([error, closeError], 'Integrated browser open and cleanup failed'); }
			throw error;
		}
	}
	async #runOpenCommand(operation: () => Promise<void>): Promise<void> { await this.#enqueueLifecycle(async () => { this.#assertLive(); this.#requireIntentGate(); this.#requireOpenLifecycle(); await operation(); }); }
	#enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> { const queued = this.#lifecycleSerial.then(operation); this.#lifecycleSerial = queued.then(() => {}, () => {}); return queued; }
	async #navigate(url: string): Promise<void> { if (!this.#opened || this.#closed) throw new Error('Integrated browser is not open'); const decision = this.checkTopLevel(url, 'navigation'); if (!decision.allowed) return; await this.#engine.navigate(decision.navigationUrl); }
	#recordBlocked(decision: Extract<BrowserNavigationDecision, { allowed: false }>, redirectFromSequence?: number): void { this.#ledger.append('blockedTopLevelNavigation', { location: decision.location, ...(decision.matchedRuleId === undefined ? {} : { matchedRuleId: decision.matchedRuleId }), blockedConsequence: decision.consequence, blockReason: browserBlockReason(decision.reason), ...(redirectFromSequence === undefined ? {} : { redirectFromSequence }) }); }
	#requireIntentGate(): void { const reason = this.#blockedReason(); if (reason !== undefined) throw new Error(`Integrated browser is blocked: ${reason}`); }
	#requireOpenLifecycle(): void { if (this.#lifecycle !== 'open') throw new Error(`Integrated browser is not open: ${this.#lifecycle}`); }
	#isClosingOrClosed(): boolean { return this.#lifecycle === 'closing' || this.#lifecycle === 'closed'; }
	#acceptsEngineActivity(): boolean { return this.#lifecycle === 'opening' || this.#lifecycle === 'open'; }
	#applyGate(): void { this.#engine.setInputBlocked(!this.#acceptsEngineActivity() || this.#blockedReason() !== undefined); }
	#blockedReason(): IntegratedBrowserProjection['blockedReason'] | undefined { if (this.#lifecycle === 'closing' && !this.#closed) return 'evidenceUnavailable'; if (!this.#gate.coordinatorAvailable) return 'coordinatorFailure'; if (this.#gate.participationGeneration !== this.#policy.participationGeneration) return 'participationStale'; if (this.#gate.attemptState === 'suspended') return 'suspended'; if (this.#gate.attemptState !== 'active') return 'attemptInactive'; if (this.#gate.paused) return 'paused'; if (this.#gate.posture !== 'compliant' && this.#gate.posture !== 'degraded') return 'postureInvalid'; if (this.#policyTransitioning || this.#policyUnavailable) return 'policyUnavailable'; return undefined; }
	#historyCapabilities(): Pick<IntegratedBrowserProjection, 'canGoBack' | 'canGoForward' | 'canReload'> { const history = this.#engine.historyState(); const interactive = this.#lifecycle === 'open' && this.#blockedReason() === undefined; return { canGoBack: interactive && history.canGoBack, canGoForward: interactive && history.canGoForward, canReload: interactive }; }
	#deriveProjection(): IntegratedBrowserProjection { const reason = this.#blockedReason(); const state = reason !== undefined ? 'blocked' : this.#lifecycle === 'opening' ? 'opening' : this.#lifecycle === 'open' ? 'open' : 'closed'; const canOpen = this.#lifecycle === 'idle' && reason === undefined; const canClose = ((this.#lifecycle === 'opening' || this.#lifecycle === 'open') || (this.#lifecycle === 'closing' && this.#closeRetryable && !this.#disposing)) && !this.#closed; return Object.freeze({ state, policyRevision: this.#policy.revision, ...(this.#state?.location === undefined ? {} : { location: this.#state.location }), ...(this.#state?.matchedRuleId === undefined ? {} : { matchedRuleId: this.#state.matchedRuleId }), canOpen, canClose, ...this.#historyCapabilities(), ...(reason === undefined ? {} : { blockedReason: reason }) }); }
	#publish(): void { this.#state = this.#deriveProjection(); this.#emit(); }
	#emit(): void { for (const listener of [...this.#listeners]) { try { listener(this.#state); } catch (error) { onUnexpectedError(error); } } }
	#assertLive(): void { if (this.#disposing || this.#disposed) throw new Error('IntegratedBrowserCoordinator is disposing or disposed'); }
	async dispose(): Promise<void> {
		if (this.#disposed) return; if (this.#disposePromise !== undefined) return this.#disposePromise;
		this.#disposing = true; if (!this.#closed) { this.#lifecycle = 'closing'; this.#applyGate(); this.#publish(); }
		this.#disposePromise = (async () => { await this.closeBrowser(); this.#disposed = true; this.#listeners.clear(); this.#ledger.dispose(); })();
		try { await this.#disposePromise; } catch (error) { this.#disposePromise = undefined; throw error; }
	}
}
function assertActivityScope(sink: BrowserActivitySink, policy: BrowserPolicy): void { const scope = sink.scope; if (scope.attemptId !== policy.attemptId || scope.participationGeneration !== policy.participationGeneration || scope.policyRevision !== policy.revision || scope.policyDigest !== policy.digest) throw new TypeError('Browser Activity sink is outside the active Browser Policy scope'); }

function browserBlockReason(reason: Extract<BrowserNavigationDecision, { allowed: false }>['reason']): BrowserBlockReason {
	switch (reason) { case 'scheme': return 'scheme_not_allowed'; case 'unlistedOrigin': return 'origin_not_allowed'; case 'path': return 'path_not_allowed'; case 'redirectDenied': return 'redirect_not_allowed'; default: return 'invalid_url'; }
}
