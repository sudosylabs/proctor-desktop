/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-model-host

import { URI } from '../../../../base/common/uri.js';
import { IDisposable, toDisposable, IReference, ReferenceCollection, Disposable, AsyncReferenceCollection } from '../../../../base/common/lifecycle.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModelService, ITextModelContentProvider, ITextEditorModel, IResolvedTextEditorModel, isResolvedTextEditorModel } from '../../../../editor/common/services/resolverService.js';
import { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';
import { ModelUndoRedoParticipant } from '../../../../editor/common/services/modelUndoRedoParticipant.js';

export interface IResolvedVirtualModelFactory {
	create(resource: URI): IResolvedTextEditorModel;
}

class ResourceModelCollection extends ReferenceCollection<Promise<IResolvedTextEditorModel>> {

	private disposed = false;
	private readonly pendingModels = new Set<Promise<IResolvedTextEditorModel>>();

	private readonly providers = new Map<string, ITextModelContentProvider[]>();
	private readonly modelsToDispose = new Map<string, Promise<ITextEditorModel>>();

	constructor(
		private readonly factory: IResolvedVirtualModelFactory
	) {
		super();
	}

	protected createReferencedObject(key: string): Promise<IResolvedTextEditorModel> {
		if (this.disposed) return Promise.reject(new Error('The virtual model resolver is closed.'));
		const pending = this.doCreateReferencedObject(key);
		this.pendingModels.add(pending);
		void pending.catch(() => this.pendingModels.delete(pending));
		return pending;
	}

	private async doCreateReferencedObject(key: string): Promise<IResolvedTextEditorModel> {
		const resource = URI.parse(key);

		// Untrack as being disposed
		const pendingModel = this.modelsToDispose.get(key);
		this.modelsToDispose.delete(key);

		// In-Memory / Virtual documents
		if (this.providers.has(resource.scheme)) {
			await this.ensureResolvedTextModelContent(resource); // throws if failing to resolve content

			let model: ITextEditorModel | undefined = undefined;
			if (pendingModel) {
				try {
					// if we have a pending model for this key, we try to await that and prevent
					// creating a new model so that we are not leaking models. we only do this for
					// in-memory or virtual documents where we create models here, the others are
					// already shared by their respective services.
					model = await pendingModel;
				} catch {
					// ignore and re-create below
				}
			}

			if (!model) {
				model = this.factory.create(resource);
			}

			if (this.ensureResolvedModel(model, key)) {
				return model;
			}
		}


		throw new Error(`Unable to resolve resource ${key}`);
	}

	private ensureResolvedModel(model: ITextEditorModel, key: string): model is IResolvedTextEditorModel {
		if (this.disposed) { model.dispose(); throw new Error('The virtual model resolver is closed.'); }
		if (isResolvedTextEditorModel(model)) {
			return true;
		}

		throw new Error(`Unable to resolve resource ${key}`);
	}

	protected destroyReferencedObject(key: string, modelPromise: Promise<ITextEditorModel>): void {

		// Track as being disposed before waiting for model to load
		// to handle the case that the reference is acquired again
		this.modelsToDispose.set(key, modelPromise);

		(async () => {
			try {
				const model = await modelPromise;

				if (!this.modelsToDispose.has(key)) {
					// return if model has been acquired again meanwhile
					return;
				}


				if (!this.modelsToDispose.has(key)) {
					// return if model has been acquired again meanwhile
					return;
				}

				// Finally we can dispose the model
				model.dispose();
			} catch (error) {
				// ignore
			} finally {
				this.modelsToDispose.delete(key); // Untrack as being disposed
				this.pendingModels.delete(modelPromise as Promise<IResolvedTextEditorModel>);
			}
		})();
	}

	dispose(): void {
		this.disposed = true;
		this.providers.clear();
		for (const pending of this.pendingModels) void pending.then(model => model.dispose(), () => undefined);
		this.pendingModels.clear();
	}

	registerTextModelContentProvider(scheme: string, provider: ITextModelContentProvider): IDisposable {
		if (this.disposed) throw new Error('The virtual model resolver is closed.');
		let providers = this.providers.get(scheme);
		if (!providers) {
			providers = [];
			this.providers.set(scheme, providers);
		}

		providers.unshift(provider);

		return toDisposable(() => {
			const providersForScheme = this.providers.get(scheme);
			if (!providersForScheme) {
				return;
			}

			const index = providersForScheme.indexOf(provider);
			if (index === -1) {
				return;
			}

			providersForScheme.splice(index, 1);

			if (providersForScheme.length === 0) {
				this.providers.delete(scheme);
			}
		});
	}

	hasTextModelContentProvider(scheme: string): boolean {
		return this.providers.get(scheme) !== undefined;
	}

	private async ensureResolvedTextModelContent(resource: URI): Promise<void> {

		// provider based
		const providersForScheme = this.providers.get(resource.scheme) || [];

		for (const provider of providersForScheme) {
			if (await provider.provideTextContent(resource)) {
				return;
			}
		}

		throw new Error(`Unable to resolve text model content for resource ${resource.toString()}`);
	}
}

export class TextModelResolverService extends Disposable implements ITextModelService {

	declare readonly _serviceBrand: undefined;

	private _resourceModelCollection: ResourceModelCollection & ReferenceCollection<Promise<IResolvedTextEditorModel>> /* TS Fail */ | undefined = undefined;
	private get resourceModelCollection() {
		if (!this._resourceModelCollection) {
			this._resourceModelCollection = new ResourceModelCollection(this.factory);
		}

		return this._resourceModelCollection;
	}

	private _asyncModelCollection: AsyncReferenceCollection<IResolvedTextEditorModel> | undefined = undefined;
	private get asyncModelCollection() {
		if (!this._asyncModelCollection) {
			this._asyncModelCollection = new AsyncReferenceCollection(this.resourceModelCollection);
		}

		return this._asyncModelCollection;
	}

	constructor(
		private readonly factory: IResolvedVirtualModelFactory,
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService,
		@IModelService private readonly modelService: IModelService,
	) {
		super();

		this._register(new ModelUndoRedoParticipant(this.modelService, this, this.undoRedoService));
	}

	override dispose(): void {
		this._resourceModelCollection?.dispose();
		super.dispose();
	}

	async createModelReference(resource: URI): Promise<IReference<IResolvedTextEditorModel>> {
		if (this._store.isDisposed) throw new Error('The virtual model resolver is closed.');

		return await this.asyncModelCollection.acquire(resource.toString());
	}

	registerTextModelContentProvider(scheme: string, provider: ITextModelContentProvider): IDisposable {
		if (this._store.isDisposed) throw new Error('The virtual model resolver is closed.');
		return this.resourceModelCollection.registerTextModelContentProvider(scheme, provider);
	}

	canHandleResource(resource: URI): boolean {
		return !this._store.isDisposed && this.resourceModelCollection.hasTextModelContentProvider(resource.scheme);
	}
}


