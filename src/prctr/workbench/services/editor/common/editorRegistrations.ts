import { DeferredPromise } from '../../../../base/common/async.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IEditorRegistrations = createDecorator<IEditorRegistrations>('editorRegistrations');
export interface IEditorRegistrations {
	readonly _serviceBrand: undefined;
	readonly onDidRegister: Event<void>;
	readonly whenReady: Promise<void>;
}

/** Completed by the literal editor manifest after its registrations have succeeded. */
export class EditorRegistrations extends Disposable implements IEditorRegistrations {
	declare readonly _serviceBrand: undefined;
	private readonly ready = new DeferredPromise<void>();
	readonly whenReady = this.ready.p;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidRegister = this.changed.event;
	private closed = false;
	constructor() { super(); void this.whenReady.catch(() => undefined); }
	complete(): void {
		if (this.closed) throw new CancellationError();
		if (this.ready.isSettled) return;
		this.changed.fire();
		void this.ready.complete();
	}
	override dispose(): void {
		this.closed = true;
		if (!this.ready.isSettled) void this.ready.error(new CancellationError());
		super.dispose();
	}
}
