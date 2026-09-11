import { CancellationError } from '../../../../base/common/errors.js';
import type { IReference } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../base/common/vscodeNls.js';
import {
	ITextModelService,
	type IResolvedTextEditorModel
} from '../../../../editor/common/services/resolverService.js';
import { userSettingsResource } from '../../../../platform/settings/common/settingsResource.js';
import { EditorInputCapabilities, type IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput, type IEditorCloseHandler } from '../../../common/editor/editorInput.js';
import { VirtualTextEditorInput } from '../../../common/editor/virtualTextEditorInput.js';
import type { SettingsEditorInputHost } from '../../../services/settings/common/settingsEditorInputHost.js';

/** A view onto the one Settings working copy, with original editor-group dirty/save/close mechanics. */
export class SettingsJsonEditorInput extends VirtualTextEditorInput {
	static readonly ID = 'prctr.settings.jsonEditorInput';
	override readonly resource = userSettingsResource;
	override readonly closeHandler: IEditorCloseHandler;
	private reference: Promise<IReference<IResolvedTextEditorModel>> | undefined;
	constructor(
		private readonly host: SettingsEditorInputHost,
		@ITextModelService private readonly models: ITextModelService
	) {
		super();
		this.closeHandler = {
			showConfirm: () => true,
			confirm: () => this.host.confirmClose()
		};
		this._register(
			host.onDidChangeState(() => {
				this._onDidChangeDirty.fire();
				this._onDidChangeCapabilities.fire();
			})
		);
	}
	override get typeId(): string {
		return SettingsJsonEditorInput.ID;
	}
	override get editorId(): string {
		return SettingsJsonEditorInput.ID;
	}
	override get capabilities(): EditorInputCapabilities {
		return (
			EditorInputCapabilities.RequiresModal |
			EditorInputCapabilities.CanSplitInGroup |
			(this.host.isReadonly()
				? EditorInputCapabilities.Readonly
				: EditorInputCapabilities.None)
		);
	}
	override getName(): string {
		return localize('settingsJsonEditorName', 'settings.json');
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
	override async resolve(): Promise<IResolvedTextEditorModel> {
		if (this.isDisposed()) throw new CancellationError();
		const pending = (this.reference ??= this.models.createModelReference(this.resource));
		try {
			const reference = await pending;
			if (this.isDisposed()) {
				reference.dispose();
				throw new CancellationError();
			}
			return reference.object;
		} catch (error) {
			if (this.reference === pending) this.reference = undefined;
			throw error;
		}
	}
	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (other instanceof SettingsJsonEditorInput) return other.host === this.host;
		return super.matches(other);
	}
	override dispose(): void {
		if (this.isDisposed()) return;
		const pending = this.reference;
		this.reference = undefined;
		void pending?.then(
			(reference) => reference.dispose(),
			() => undefined
		);
		super.dispose();
	}
}
