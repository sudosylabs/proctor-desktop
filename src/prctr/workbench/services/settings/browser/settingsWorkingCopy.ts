import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';
import { SettingsDraft } from '../../../../platform/settings/common/settingsDraft.js';
import { userSettingsResource } from '../../../../platform/settings/common/settingsResource.js';
import { SettingsModelDocument } from '../common/settingsModelDocument.js';
import {
	ISettingsEditorConfiguration,
	type SettingsEditorConfiguration
} from '../common/settingsEditorConfiguration.js';
import { setProperty, applyEdits } from '../../../../base/common/jsonEdit.js';
import { parseSettingsDocument } from '../../../../platform/settings/common/settingsDocument.js';
import { settingsRegistry } from '../../../../platform/settings/common/settingsRegistry.js';

/** One modal's model, serialization and undo ownership, shared by both Settings presentations. */
export class SettingsWorkingCopy extends Disposable {
	readonly document: SettingsModelDocument;
	private readonly currentDraft = this._register(new MutableDisposable<SettingsDraft>());
	private readonly readonlyState = this._register(new Emitter<void>());
	readonly onDidChangeReadonly = this.readonlyState.event;
	private readonlyStateValue = false;
	private readonly refreshFailure = this._register(new Emitter<void>());
	readonly onDidFailConfigurationRefresh = this.refreshFailure.event;

	constructor(
		source: string,
		revision: string,
		@ISettingsEditorConfiguration private readonly configuration: SettingsEditorConfiguration,
		@IModelService models: IModelService,
		@ILanguageService languages: ILanguageService,
		@IUndoRedoService undoRedo: IUndoRedoService
	) {
		super();
		try {
			if (models.getModel(userSettingsResource))
				throw new Error('The Settings working copy is already open.');
			const model = this._register(
				models.createModel(source, languages.createById('jsonc'), userSettingsResource)
			);
			this.document = this._register(
				new SettingsModelDocument(model, models, undoRedo, source)
			);
			this.currentDraft.value = new SettingsDraft(
				source,
				revision,
				this.document,
				() => this.readonlyStateValue
			);
			configuration.acknowledge(source);
			configuration.bindDraft(this.draft);
			this._register(
				this.document.onDidChange(() => {
					void configuration.refresh().catch(() => this.refreshFailure.fire());
				})
			);
		} catch (error) {
			this.dispose();
			throw error;
		}
	}

	get isReadonly(): boolean {
		return this.readonlyStateValue;
	}
	get hasPendingEdits(): boolean {
		return this.configuration.hasPendingEdits;
	}
	get onDidChangePendingEdits() {
		return this.configuration.onDidChangePendingEdits;
	}
	flushPendingEdits(): Promise<void> {
		return this.configuration.flushPendingEdits();
	}
	setReadonly(value: boolean): void {
		if (value === this.readonlyStateValue) return;
		this.readonlyStateValue = value;
		this.readonlyState.fire();
	}

	get draft(): SettingsDraft {
		if (!this.currentDraft.value) throw new Error('The Settings working copy is closed.');
		return this.currentDraft.value;
	}

	/** Rebase the acknowledged identity while keeping the same model and undo history. */
	accept(source: string, revision: string): void {
		this.document.replace(source);
		this.currentDraft.value = new SettingsDraft(
			source,
			revision,
			this.document,
			() => this.readonlyStateValue
		);
		this.configuration.acknowledge(source);
		this.configuration.bindDraft(this.draft);
	}

	/** A successful save acknowledges its captured source without replacing later edits. */
	acknowledge(source: string, revision: string): void {
		this.draft.acknowledge(source, revision);
		this.configuration.acknowledge(source);
	}

	setPreviewEnabled(enabled: boolean): Promise<void> {
		return this.configuration.setPreviewEnabled(enabled);
	}

	/** Insert the source preferences editor's initial JSON value without persisting it. */
	insertJsonSetting(key: string, value: unknown): void {
		if (this.isReadonly) throw new Error('Settings are read-only.');
		const declaration = settingsRegistry.declaration(key);
		if (
			(!declaration || declaration.candidate === 'prohibited') &&
			!/^\[[a-z0-9][a-z0-9+._-]{0,63}\]$/i.test(key)
		)
			throw new Error('This setting cannot be inserted.');
		const source = this.draft.source;
		if (!this.draft.validation.valid)
			throw new Error('Fix settings.json before inserting a setting.');
		const { tabSize, insertSpaces } = this.document.model.getOptions();
		const edits = setProperty(source, [key], value, {
			tabSize,
			insertSpaces,
			eol: this.document.model.getEOL()
		});
		// The source editor may deliberately insert a primitive placeholder. It remains a
		// draft diagnostic until corrected, but syntax and structural limits always apply.
		const next = parseSettingsDocument(applyEdits(source, edits));
		if (next.diagnostics.some((diagnostic) => diagnostic.code !== 'invalid-value'))
			throw new Error('The inserted setting exceeds the document constraints.');
		this.document.applyEdits(edits);
	}

	override dispose(): void {
		if (this.currentDraft.value) this.configuration.unbindDraft(this.currentDraft.value);
		super.dispose();
	}
}
