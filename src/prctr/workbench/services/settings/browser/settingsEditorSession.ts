import { Emitter } from '../../../../base/common/event.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ConfirmResult } from '../../../../platform/dialogs/common/dialogs.js';
import type {
	UserSettingsCommitIntent,
	UserSettingsProjection
} from '../../../../platform/settings/common/settingsRendererProtocol.js';
import type { SettingsEditorInputHost } from '../common/settingsEditorInputHost.js';
import type { SettingsRendererClient } from '../common/settingsRendererClient.js';
import type { SettingsWorkingCopy } from './settingsWorkingCopy.js';

export type SettingsEditorStatus =
	| 'ready'
	| 'saved'
	| 'invalid'
	| 'saving'
	| 'readonly'
	| 'conflict'
	| 'merged'
	| 'ambiguous'
	| 'failed'
	| 'previewFailed'
	| 'discardFailed';
export interface SettingsEditorSessionBindings {
	flushEdits(): Promise<void>;
	hasPendingEdits?(): boolean;
	discardEdits?(): void;
	confirmClose(): Promise<ConfirmResult>;
	/** Source is the valid preview or acknowledged source, never a second working document. */
	applyPresentation(source: string, projection: UserSettingsProjection): void;
}

/** Owns one live Principal-bound Settings edit. It never persists outside the privileged client. */
export class SettingsEditorSession extends Disposable implements SettingsEditorInputHost {
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChangeState = this.changed.event;
	private projection: UserSettingsProjection;
	private acknowledgedPresentation: UserSettingsProjection['presentation'];
	private closed = false;
	private statusValue: SettingsEditorStatus = 'ready';
	private pendingIntent: UserSettingsCommitIntent | undefined;
	private saveOperation: Promise<boolean> | undefined;
	private closeOperation: Promise<ConfirmResult> | undefined;
	private bufferedProjection: UserSettingsProjection | undefined;
	private projectionSequence = 0;
	private lastReceivedProjection: UserSettingsProjection | undefined;
	private conflict = false;
	private desiredPreview: string | undefined;
	private appliedPreview: string | undefined;
	private previewOperation: Promise<void> | undefined;
	private previewSuppressed = false;
	private mutating = false;
	private discarding = false;

	constructor(
		readonly copy: SettingsWorkingCopy,
		initial: UserSettingsProjection,
		private readonly client: SettingsRendererClient,
		private readonly bindings: SettingsEditorSessionBindings
	) {
		super();
		this.projection = initial;
		this.acknowledgedPresentation = initial.presentation;
		if (copy.draft.source !== initial.source || copy.draft.baseRevision !== initial.revision)
			throw new Error('Settings session base does not match its projection.');
		copy.setReadonly(!initial.writable);
		this._register(copy.onDidChangePendingEdits(() => this.changed.fire()));
		this._register(toDisposable(client.onDidChange((next) => this.receiveProjection(next))));
		this._register(
			copy.document.onDidChange(() => {
				if (this.closed || this.mutating) return;
				this.previewSuppressed = false;
				this.statusValue = this.pendingIntent
					? 'ambiguous'
					: this.copy.draft.validation.valid
						? 'ready'
						: 'invalid';
				this.refreshPreview();
				this.changed.fire();
			})
		);
		this.bindings.applyPresentation(initial.source, initial);
	}

	get status(): SettingsEditorStatus {
		return this.isReadonly()
			? 'readonly'
			: this.saveOperation
				? 'saving'
				: this.conflict
					? 'conflict'
					: this.statusValue;
	}
	get latest(): UserSettingsProjection {
		return this.projection;
	}
	isDirty(): boolean {
		return (
			!this.closed &&
			(this.copy.draft.source !== this.copy.draft.baseSource ||
				!!this.pendingIntent ||
				this.copy.hasPendingEdits ||
				!!this.bindings.hasPendingEdits?.())
		);
	}
	isReadonly(): boolean {
		return this.closed || this.discarding || !this.projection.writable;
	}
	isSaving(): boolean {
		return !!this.saveOperation;
	}
	notifyControlChange(): void {
		if (!this.closed) this.changed.fire();
	}
	notifyDiscardFailure(): void {
		if (!this.closed) {
			this.statusValue = 'discardFailed';
			this.changed.fire();
		}
	}
	notifyEditFailure(): void {
		if (!this.closed) {
			this.statusValue = 'failed';
			this.changed.fire();
		}
	}
	private assertLive(): void {
		if (this.closed) throw new CancellationError();
	}

	private receiveProjection(next: UserSettingsProjection): void {
		if (this.closed) return;
		this.projectionSequence++;
		this.lastReceivedProjection = next;
		this.copy.setReadonly(this.discarding || !next.writable);
		const documentChanged =
			next.source !== this.projection.source || next.revision !== this.projection.revision;
		if (documentChanged && (this.saveOperation || this.pendingIntent)) {
			this.bufferedProjection = next;
			this.projection = {
				...this.projection,
				writable: next.writable,
				availability: next.availability
			};
		} else if (documentChanged) {
			this.reconcile(next);
		} else {
			this.projection = next;
			if (this.desiredPreview === undefined)
				this.acknowledgedPresentation = next.presentation;
		}
		if (!next.writable) this.previewSuppressed = true;
		this.refreshPreview();
		this.changed.fire();
	}

	private reconcile(next: UserSettingsProjection): void {
		const clean = !this.isDirty();
		const merge = clean ? undefined : this.copy.draft.mergeLatest(next.source);
		this.projection = next;
		this.acknowledgedPresentation = next.presentation;
		this.mutating = true;
		try {
			if (clean) {
				this.copy.accept(next.source, next.revision);
				this.conflict = false;
			} else if (merge?.merged !== undefined) {
				this.copy.acknowledge(next.source, next.revision);
				this.copy.document.replace(merge.merged);
				this.conflict = false;
				this.statusValue = 'merged';
			} else {
				// Keep the original base, current draft and latest projection for explicit resolution.
				this.conflict = true;
				this.statusValue = 'conflict';
			}
		} finally {
			this.mutating = false;
		}
	}

	save(): Promise<boolean> {
		if (this.saveOperation) return this.saveOperation;
		this.assertLive();
		const operation = this.doSave().finally(async () => {
			if (this.saveOperation !== operation) return;
			if (this.closed) return;
			if (!this.pendingIntent && this.bufferedProjection) {
				const buffered = this.bufferedProjection;
				this.bufferedProjection = undefined;
				if (
					buffered.revision !== this.projection.revision ||
					buffered.source !== this.projection.source
				) {
					// Revisions are opaque. A notification received before the commit reply
					// may precede or follow it; refetch instead of guessing their order.
					const sequence = this.projectionSequence;
					try {
						const snapshot = await this.client.projection();
						if (this.closed) return;
						const next =
							sequence === this.projectionSequence
								? snapshot
								: this.lastReceivedProjection!;
						if (
							next.revision !== this.projection.revision ||
							next.source !== this.projection.source
						)
							this.reconcile(next);
						this.projection = {
							...this.projection,
							writable: next.writable,
							availability: next.availability
						};
						this.copy.setReadonly(!next.writable);
					} catch {
						if (this.closed) return;
						this.projection = {
							...this.projection,
							writable: false,
							availability: 'unavailable'
						};
						this.copy.setReadonly(true);
						this.previewSuppressed = true;
					}
					this.bufferedProjection = undefined;
				}
			}
			this.saveOperation = undefined;
			this.refreshPreview();
			this.changed.fire();
		});
		this.saveOperation = operation;
		this.changed.fire();
		return operation;
	}

	private async doSave(): Promise<boolean> {
		try {
			if (!this.pendingIntent) {
				await this.bindings.flushEdits();
				await this.copy.flushPendingEdits();
			}
			this.assertLive();
			if (this.isReadonly() || this.conflict) return false;
			if (!this.pendingIntent && !this.copy.draft.validation.valid) {
				this.statusValue = 'invalid';
				return false;
			}
			const intent = this.pendingIntent ?? {
				source: this.copy.draft.source,
				expectedRevision: this.copy.draft.baseRevision,
				idempotencyKey: crypto.randomUUID()
			};
			this.previewSuppressed = true;
			this.refreshPreview();
			await this.previewOperation;
			this.assertLive();
			if (this.isReadonly()) return false;
			this.pendingIntent = intent;
			const result = await this.client.commit(intent);
			this.assertLive();
			if (result.kind === 'success') {
				if (result.projection.source !== intent.source)
					throw new Error(
						'Settings acknowledgement does not match the submitted document.'
					);
				this.copy.acknowledge(intent.source, result.projection.revision);
				this.projection = result.projection;
				this.acknowledgedPresentation = result.projection.presentation;
				this.pendingIntent = undefined;
				this.previewSuppressed = false;
				this.statusValue = 'saved';
				return true;
			}
			if (result.kind === 'conflict') {
				this.pendingIntent = undefined;
				this.reconcile(result.projection);
			} else if (result.kind === 'ambiguous') {
				this.statusValue = 'ambiguous';
			} else {
				this.projection = {
					...this.projection,
					writable: false,
					availability: 'unavailable'
				};
				this.copy.setReadonly(true);
			}
			return false;
		} catch {
			if (this.closed) return false;
			// A transport exception after dispatch cannot establish whether the write reached authority.
			this.statusValue = this.pendingIntent ? 'ambiguous' : 'failed';
			this.previewSuppressed = true;
			return false;
		}
	}

	confirmClose(): Promise<ConfirmResult> {
		if (this.closeOperation) return this.closeOperation;
		this.assertLive();
		const operation = (async () => {
			try {
				await this.bindings.flushEdits();
				await this.copy.flushPendingEdits();
			} catch {
				// A rejected control edit must not prevent the user choosing Discard or Cancel.
				// Choosing Save still runs the same validation and preserves a failed draft.
				this.statusValue = 'failed';
			}
			if (this.saveOperation) await this.saveOperation;
			this.assertLive();
			if (!this.isDirty() && !this.pendingIntent) return ConfirmResult.DONT_SAVE;
			const result = await this.bindings.confirmClose();
			this.assertLive();
			return result;
		})().finally(() => {
			if (this.closeOperation === operation) this.closeOperation = undefined;
		});
		this.closeOperation = operation;
		return operation;
	}

	async revert(): Promise<void> {
		this.assertLive();
		if (this.saveOperation) await this.saveOperation;
		this.assertLive();
		if (this.pendingIntent) {
			// Resolve unknown completion before treating any source as acknowledged.
			if (!(await this.save()))
				throw new Error('The previous Settings save has not been resolved.');
		}
		// Fence already queued edits before cancelling control debounces. They must not reappear after discard.
		this.discarding = true;
		this.copy.setReadonly(true);
		this.changed.fire();
		this.bindings.discardEdits?.();
		try {
			await this.bindings.flushEdits();
		} catch {
			/* Edits fenced by this discard are rejected by the document owner. */
		}
		try {
			await this.copy.flushPendingEdits();
		} catch {
			/* Includes edits already queued by the JSON setting menu. */
		}
		this.assertLive();
		this.discarding = false;
		this.copy.setReadonly(!this.projection.writable);
		this.mutating = true;
		try {
			this.copy.accept(this.projection.source, this.projection.revision);
		} finally {
			this.mutating = false;
		}
		this.conflict = false;
		this.previewSuppressed = true;
		this.statusValue = 'ready';
		this.refreshPreview();
		await this.previewOperation;
		this.assertLive();
		this.changed.fire();
	}

	private refreshPreview(): void {
		if (this.closed) return;
		const canPreview =
			!this.isReadonly() &&
			!this.previewSuppressed &&
			!this.conflict &&
			this.copy.draft.validation.valid;
		this.desiredPreview =
			canPreview && this.copy.draft.source !== this.copy.draft.baseSource
				? this.copy.draft.source
				: undefined;
		void this.copy.setPreviewEnabled(canPreview).catch(() => {
			if (!this.closed) {
				this.statusValue = 'previewFailed';
				this.changed.fire();
			}
		});
		this.bindings.applyPresentation(
			this.desiredPreview ?? this.projection.source,
			this.desiredPreview === undefined
				? { ...this.projection, presentation: this.acknowledgedPresentation }
				: this.projection
		);
		if (!this.previewOperation && this.appliedPreview !== this.desiredPreview) {
			const operation = Promise.resolve()
				.then(() => this.synchronizePreview())
				.catch(() => {
					if (!this.closed) {
						this.statusValue = 'previewFailed';
						this.changed.fire();
					}
				})
				.finally(() => {
					if (this.previewOperation === operation) this.previewOperation = undefined;
					if (!this.closed && this.appliedPreview !== this.desiredPreview)
						this.refreshPreview();
				});
			this.previewOperation = operation;
		}
	}

	private async synchronizePreview(): Promise<void> {
		while (!this.closed && this.appliedPreview !== this.desiredPreview) {
			const source = this.desiredPreview;
			try {
				if (source === undefined) await this.client.cancelPreview();
				else await this.client.preview({ source });
				this.appliedPreview = source;
			} catch {
				this.previewSuppressed = true;
				this.desiredPreview = undefined;
				try {
					await this.client.cancelPreview();
				} catch {
					/* Local acknowledged presentation is restored below. */
				}
				this.appliedPreview = undefined;
				if (!this.closed) {
					await this.copy.setPreviewEnabled(false);
					this.bindings.applyPresentation(this.projection.source, {
						...this.projection,
						presentation: this.acknowledgedPresentation
					});
					this.statusValue = 'previewFailed';
					this.changed.fire();
				}
				return;
			}
		}
	}

	/** Await before allowing a replacement owner to preview through the same window client. */
	async shutdown(): Promise<void> {
		this.dispose();
		await this.previewOperation;
		await this.client.cancelPreview();
	}

	override dispose(): void {
		if (this.closed) return;
		this.closed = true;
		this.copy.setReadonly(true);
		void this.copy.setPreviewEnabled(false).catch(() => undefined);
		this.bindings.applyPresentation(this.projection.source, {
			...this.projection,
			presentation: this.acknowledgedPresentation
		});
		super.dispose();
	}
}
