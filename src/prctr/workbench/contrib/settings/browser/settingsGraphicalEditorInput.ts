import { EditorInputCapabilities, type IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput, type IEditorCloseHandler } from '../../../common/editor/editorInput.js';
import { SettingsEditor2Input } from '../../../services/preferences/common/preferencesEditorInput.js';
import type { Settings2EditorModel } from '../../../services/preferences/common/preferencesModels.js';
import type { SettingsEditorInputHost } from '../../../services/settings/common/settingsEditorInputHost.js';

/** The original Settings catalog input projects the shared document's dirty/authority state. */
export class SettingsGraphicalEditorInput extends SettingsEditor2Input {
	override readonly closeHandler: IEditorCloseHandler;
	constructor(
		model: Settings2EditorModel,
		private readonly host: SettingsEditorInputHost,
		private readonly isValid: () => boolean
	) {
		super(model);
		this.closeHandler = { showConfirm: () => true, confirm: () => this.host.confirmClose() };
		this._register(
			host.onDidChangeState(() => {
				this._onDidChangeDirty.fire();
				this._onDidChangeCapabilities.fire();
			})
		);
	}
	override get capabilities(): EditorInputCapabilities {
		return (
			EditorInputCapabilities.RequiresModal |
			(this.host.isReadonly() || !this.isValid()
				? EditorInputCapabilities.Readonly
				: EditorInputCapabilities.None)
		);
	}
	override isDirty(): boolean {
		return this.host.isDirty();
	}
	override isSaving(): boolean {
		return this.host.isSaving();
	}
	override async save(): Promise<EditorInput | undefined> {
		return (await this.host.save()) ? this : undefined;
	}
	override async revert(): Promise<void> {
		await this.host.revert();
	}
	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return (
			other === this ||
			(other instanceof SettingsGraphicalEditorInput && other.host === this.host)
		);
	}
}
