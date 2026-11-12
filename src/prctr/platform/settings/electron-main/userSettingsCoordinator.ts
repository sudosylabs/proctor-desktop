import { Emitter, type Event } from '../../../base/common/event.js';
import { parseSettingsDocument, SETTINGS_DOCUMENT_LIMITS } from '../common/settingsDocument.js';
import {
	validateUserSettingsCommitIntent,
	validateUserSettingsPreviewIntent,
	type UserSettingsCommitIntent,
	type UserSettingsCommitResponse,
	type UserSettingsPreviewIntent,
	type UserSettingsProjection
} from '../common/settingsRendererProtocol.js';
import {
	DefaultUserSettingsService,
	type AcknowledgedUserSettings,
	type SettingsCommitRequest,
	type SettingsCommitResult
} from '../common/userSettingsService.js';
import type { SettingsResolutionContext } from '../common/settingsResolution.js';
import type { UserSettingsSnapshot } from '../common/userSettingsSession.js';

export interface UserSettingsBinding {
	readonly principalId: string;
	readonly sessionId: string;
}
export interface UserSettingsAuthorityPort {
	/** The server's current settings, or `undefined` when it can't be read now. */
	read(binding: UserSettingsBinding): Promise<UserSettingsSnapshot | undefined>;
	commit(
		binding: UserSettingsBinding,
		request: SettingsCommitRequest
	): Promise<SettingsCommitResult>;
}
export interface ProtectedUserSettingsCachePort {
	load(binding: UserSettingsBinding): Promise<AcknowledgedUserSettings | undefined>;
	store(binding: UserSettingsBinding, acknowledged: AcknowledgedUserSettings): Promise<void>;
}
export interface UserSettingsCoordinatorOptions {
	readonly binding: UserSettingsBinding;
	readonly context: SettingsResolutionContext;
	readonly authority: UserSettingsAuthorityPort;
	readonly cache: ProtectedUserSettingsCachePort;
	readonly acknowledged?: AcknowledgedUserSettings;
	readonly writable: boolean;
}
interface ProtectedCacheLane {
	generation: number;
	serial: Promise<void>;
}
interface ProtectedCacheLease {
	readonly lane: ProtectedCacheLane;
	readonly generation: number;
}
const protectedCacheLanes = new WeakMap<
	ProtectedUserSettingsCachePort,
	Map<string, ProtectedCacheLane>
>();

export class UserSettingsCoordinator {
	readonly #change = new Emitter<UserSettingsProjection>();
	readonly onDidChange: Event<UserSettingsProjection> = this.#change.event;
	readonly #binding: UserSettingsBinding;
	readonly #authority: UserSettingsAuthorityPort;
	readonly #cache: ProtectedUserSettingsCachePort;
	readonly #cacheLease: ProtectedCacheLease;
	readonly #effective: DefaultUserSettingsService;
	#acknowledged: AcknowledgedUserSettings;
	#inMemory: AcknowledgedUserSettings;
	#writable: boolean;
	#ambiguousRequest: SettingsCommitRequest | undefined;
	#commitSerial: Promise<void> = Promise.resolve();
	#disposePromise: Promise<void> | undefined;
	#disposed = false;
	private constructor(
		options: UserSettingsCoordinatorOptions,
		acknowledged: AcknowledgedUserSettings,
		cacheLease: ProtectedCacheLease
	) {
		this.#binding = Object.freeze({ ...options.binding });
		this.#authority = options.authority;
		this.#cache = options.cache;
		this.#cacheLease = cacheLease;
		this.#acknowledged = freezeAcknowledged(acknowledged);
		this.#inMemory = this.#acknowledged;
		this.#writable = options.writable && acknowledged.revision !== 'unavailable';
		this.#effective = new DefaultUserSettingsService(this.#inMemory, options.context);
	}
	static async create(options: UserSettingsCoordinatorOptions): Promise<UserSettingsCoordinator> {
		const cacheLease = acquireProtectedCacheLease(options.cache, options.binding);
		await cacheLease.lane.serial;
		let cached = options.acknowledged;
		if (cached === undefined) {
			try {
				cached = await options.cache.load(options.binding);
			} catch {
				cached = undefined;
			}
		}
		if (cacheLease.lane.generation !== cacheLease.generation)
			throw new Error('User Settings coordinator creation was superseded');
		const coordinator = new UserSettingsCoordinator(
			options,
			cached ?? {
				source: '{}',
				revision: 'unavailable'
			},
			cacheLease
		);
		if (options.acknowledged !== undefined)
			await coordinator.#persistAcknowledged(coordinator.#acknowledged).catch(() => {});
		if (!coordinator.#ownsBinding()) {
			await coordinator.dispose();
			throw new Error('User Settings coordinator creation was superseded');
		}
		return coordinator;
	}
	projection(): UserSettingsProjection {
		this.#assertLive();
		return Object.freeze({
			...this.#inMemory,
			availability: this.#writable ? 'available' : 'unavailable',
			writable: this.#writable,
			presentation: this.#presentationProjection()
		});
	}
	get effective(): DefaultUserSettingsService {
		return this.#effective;
	}
	setWritable(value: boolean): void {
		this.#assertLive();
		const writable = value && this.#acknowledged.revision !== 'unavailable';
		if (this.#writable === writable) return;
		this.#writable = writable;
		if (!writable) this.#effective.cancelPreview();
		this.#change.fire(this.projection());
	}
	preview(raw: UserSettingsPreviewIntent): void {
		this.#assertLive();
		const intent = validateUserSettingsPreviewIntent(raw);
		if (!this.#writable)
			throw new Error('User Settings preview is unavailable while settings are read-only');
		this.#effective.preview(intent.source);
		this.#change.fire(this.projection());
	}
	cancelPreview(): void {
		this.#assertLive();
		this.#effective.cancelPreview();
		this.#change.fire(this.projection());
	}
	async commit(raw: UserSettingsCommitIntent): Promise<UserSettingsCommitResponse> {
		this.#assertLive();
		const intent = validateUserSettingsCommitIntent(raw);
		const parsed = parseSettingsDocument(intent.source);
		if (!parsed.valid) throw new TypeError('Cannot commit an invalid User Settings document');
		return this.#enqueueCommit(() => this.#commit(intent));
	}
	async #commit(intent: UserSettingsCommitIntent): Promise<UserSettingsCommitResponse> {
		if (intent.expectedRevision !== this.#acknowledged.revision)
			return Object.freeze({ kind: 'conflict', projection: this.projection() });
		if (!this.#writable) return Object.freeze({ kind: 'unavailable' });
		const request = Object.freeze({
			source: intent.source,
			expectedRevision: intent.expectedRevision,
			idempotencyKey: intent.idempotencyKey
		});
		if (this.#ambiguousRequest !== undefined && !sameRequest(this.#ambiguousRequest, request))
			throw new TypeError(
				'An ambiguous User Settings commit must be resolved with the same request'
			);
		let result: SettingsCommitResult;
		try {
			result = await this.#authority.commit(this.#binding, this.#ambiguousRequest ?? request);
			this.#assertLive();
			if (result.kind === 'ambiguous') {
				result = await this.#authority.commit(
					this.#binding,
					this.#ambiguousRequest ?? request
				);
				this.#assertLive();
			}
		} catch (error) {
			this.#effective.cancelPreview();
			this.#change.fire(this.projection());
			throw error;
		}
		if (result.kind === 'success') {
			this.#ambiguousRequest = undefined;
			await this.#accept({
				source: request.source,
				revision: result.revision
			});
			return Object.freeze({ kind: 'success', projection: this.projection() });
		}
		if (result.kind === 'conflict') {
			this.#ambiguousRequest = undefined;
			await this.#accept(result.latest);
			return Object.freeze({ kind: 'conflict', projection: this.projection() });
		}
		if (result.kind === 'unavailable') {
			this.setWritable(false);
			return Object.freeze({ kind: 'unavailable' });
		}
		this.#ambiguousRequest = request;
		return Object.freeze({ kind: 'ambiguous' });
	}
	/**
	 * Takes in a change made outside this window, by another computer or Session. `revision` is
	 * the one the server announced, or `undefined` when changes may have been missed. Runs after
	 * any commit in flight, so a window's own change is never read back as someone else's.
	 */
	reconcile(revision: string | undefined): Promise<void> {
		this.#assertLive();
		return this.#enqueueCommit(async () => {
			if (revision !== undefined && revision === this.#acknowledged.revision) return;
			// An unresolved commit is retried with the same request, and its answer settles the
			// revision; reading now could not tell whether that commit landed.
			if (this.#ambiguousRequest !== undefined) return;
			const latest = await this.#authority.read(this.#binding);
			this.#assertLive();
			if (latest === undefined) return;
			if (latest.acknowledged.revision !== this.#acknowledged.revision)
				await this.#accept(latest.acknowledged);
			this.setWritable(latest.writable);
		});
	}
	#enqueueCommit<T>(operation: () => Promise<T>): Promise<T> {
		const queued = this.#commitSerial.then(() => {
			this.#assertLive();
			return operation();
		});
		this.#commitSerial = queued.then(
			() => undefined,
			() => undefined
		);
		return queued;
	}
	async #accept(value: AcknowledgedUserSettings): Promise<void> {
		this.#assertLive();
		const acknowledged = freezeAcknowledged(value);
		this.#acknowledged = acknowledged;
		this.#inMemory = acknowledged;
		this.#effective.updateAcknowledged(this.#inMemory);
		this.#change.fire(this.projection());
		await this.#persistAcknowledged(acknowledged).catch(() => {});
	}
	#persistAcknowledged(acknowledged: AcknowledgedUserSettings): Promise<void> {
		const operation = this.#cacheLease.lane.serial.then(async () => {
			if (!this.#ownsBinding() || this.#disposed) return;
			await this.#cache.store(this.#binding, acknowledged);
		});
		this.#cacheLease.lane.serial = operation.catch(() => {});
		return operation;
	}
	#ownsBinding(): boolean {
		return this.#cacheLease.lane.generation === this.#cacheLease.generation;
	}
	#presentationProjection(): UserSettingsProjection['presentation'] {
		return Object.freeze({
			windowTheme: this.#effective.get('window.theme'),
			highContrast: this.#effective.get('workbench.preferHighContrast'),
			colorCustomizations: this.#effective.get('workbench.colorCustomizations'),
			zoomPercent: this.#effective.get('window.zoomLevel'),
			reducedMotion: this.#effective.get('accessibility.reducedMotion')
		});
	}
	#assertLive(): void {
		if (this.#disposed) throw new Error('UserSettingsCoordinator is disposed');
		if (!this.#ownsBinding())
			throw new Error('UserSettingsCoordinator no longer owns this Principal binding');
	}
	dispose(): Promise<void> {
		if (this.#disposePromise !== undefined) return this.#disposePromise;
		this.#disposed = true;
		this.#effective.cancelPreview();
		this.#disposePromise = this.#commitSerial
			.then(
				() => {},
				() => {}
			)
			.then(() => {
				this.#effective.dispose();
				this.#change.dispose();
			});
		return this.#disposePromise;
	}
}
function acquireProtectedCacheLease(
	cache: ProtectedUserSettingsCachePort,
	binding: UserSettingsBinding
): ProtectedCacheLease {
	let lanes = protectedCacheLanes.get(cache);
	if (lanes === undefined) {
		lanes = new Map();
		protectedCacheLanes.set(cache, lanes);
	}
	let lane = lanes.get(binding.principalId);
	if (lane === undefined) {
		lane = { generation: 0, serial: Promise.resolve() };
		lanes.set(binding.principalId, lane);
	}
	const generation = ++lane.generation;
	return Object.freeze({ lane, generation });
}
function freezeAcknowledged(value: AcknowledgedUserSettings): AcknowledgedUserSettings {
	if (
		!isExactAcknowledged(value) ||
		typeof value.source !== 'string' ||
		value.source.length > SETTINGS_DOCUMENT_LIMITS.maxBytes ||
		new TextEncoder().encode(value.source).byteLength > SETTINGS_DOCUMENT_LIMITS.maxBytes ||
		typeof value.revision !== 'string' ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.revision)
	)
		throw new TypeError('Acknowledged User Settings are invalid');
	return Object.freeze({
		source: value.source,
		revision: value.revision
	});
}
function isExactAcknowledged(value: unknown): value is AcknowledgedUserSettings {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const keys = Object.keys(value);
	return keys.length === 2 && ['source', 'revision'].every((key) => Object.hasOwn(value, key));
}
function sameRequest(left: SettingsCommitRequest, right: SettingsCommitRequest): boolean {
	return (
		left.source === right.source &&
		left.expectedRevision === right.expectedRevision &&
		left.idempotencyKey === right.idempotencyKey
	);
}
