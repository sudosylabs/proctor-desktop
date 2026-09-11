import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { FocusMode } from '../../../../platform/window/common/windowFocus.js';
import type { IEditorWindowHost } from './editorWindowHost.js';

export interface EditorWindowHostBindings {
	focus(options?: { mode?: FocusMode }): Promise<void>;
	moveTop(): Promise<void>;
	setDimmed(dimmed: boolean): Promise<void>;
	getCursorScreenPoint(): ReturnType<IEditorWindowHost['getCursorScreenPoint']>;
}

/** Projection of the owning native window; editor commands never choose another window. */
export class EditorWindowHostService extends Disposable implements IEditorWindowHost {
	declare readonly _serviceBrand: undefined;
	private readonly focusEmitter = this._register(new Emitter<boolean>());
	readonly onDidChangeFocus = this.focusEmitter.event;
	private closed = false;
	constructor(
		private readonly window: Window,
		private readonly bindings: EditorWindowHostBindings
	) {
		super();
		for (const event of ['focus', 'blur']) {
			this._register(
				addDisposableListener(window, event, () => this.focusEmitter.fire(this.hasFocus))
			);
		}
	}
	get hasFocus(): boolean {
		return !this.closed && this.window.document.hasFocus();
	}
	private assertWindow(window = this.window): void {
		if (this.closed || window !== this.window) throw new Error('Editor window is unavailable');
	}
	async focus(window: Window, options?: { mode?: FocusMode }): Promise<void> {
		this.assertWindow(window);
		await this.bindings.focus(options);
		this.assertWindow(window);
	}
	async moveTop(window: Window): Promise<void> {
		this.assertWindow(window);
		await this.bindings.moveTop();
		this.assertWindow(window);
	}
	async setWindowDimmed(window: Window, dimmed: boolean): Promise<void> {
		// Releasing an overlay during window teardown is idempotent and has no native effect.
		if (this.closed && !dimmed) return;
		this.assertWindow(window);
		await this.bindings.setDimmed(dimmed);
	}
	async getCursorScreenPoint(): ReturnType<IEditorWindowHost['getCursorScreenPoint']> {
		this.assertWindow();
		const result = await this.bindings.getCursorScreenPoint();
		this.assertWindow();
		return result;
	}
	override dispose(): void {
		this.closed = true;
		super.dispose();
	}
}
