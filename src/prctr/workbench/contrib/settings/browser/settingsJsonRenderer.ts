/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-json-navigation

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import type { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { SettingsEditorModel } from '../../../services/preferences/common/preferencesModels.js';
import type { SettingsEditorSession } from '../../../services/settings/browser/settingsEditorSession.js';
import { UserSettingsRenderer } from '../../preferences/browser/preferencesRenderers.js';

/** SettingsEditorContribution's model-bound renderer, scoped to the owned user document. */
export class SettingsJsonRenderer extends Disposable {
	private readonly renderers = this._register(new DisposableStore());
	private generation = 0;
	private disposed = false;

	constructor(
		private readonly editor: ICodeEditor,
		private readonly session: SettingsEditorSession,
		@IInstantiationService private readonly instantiation: IInstantiationService,
		@ITextModelService private readonly resolver: ITextModelService
	) {
		super();
		this.refresh();
		this._register(editor.onDidChangeModel(() => this.refresh()));
		this._register(editor.onDidDispose(() => this.dispose()));
	}

	private refresh(): void {
		const generation = ++this.generation;
		this.renderers.clear();
		const model = this.editor.getModel();
		if (model !== this.session.copy.document.model || model.isDisposed()) return;
		void this.resolver.createModelReference(model.uri).then(reference => {
			if (this.disposed || generation !== this.generation || this.editor.getModel() !== model || model.isDisposed()) {
				reference.dispose();
				return;
			}
			const preferences = new SettingsEditorModel(reference, ConfigurationTarget.USER_LOCAL);
			try {
				const renderer = this.instantiation.createInstance(UserSettingsRenderer, this.editor, preferences, 'external');
				// Dispose glyphs/highlights before releasing their model reference.
				this.renderers.add(renderer);
				this.renderers.add(preferences);
				this.renderers.add(renderer.onDidFailEdit(() => this.session.notifyEditFailure()));
				renderer.render();
			} catch (error) {
				this.renderers.clear();
				preferences.dispose();
				throw error;
			}
		}).catch(() => {
			if (!this.disposed && generation === this.generation) this.session.notifyEditFailure();
		});
	}

	override dispose(): void {
		this.disposed = true;
		++this.generation;
		super.dispose();
	}
}
