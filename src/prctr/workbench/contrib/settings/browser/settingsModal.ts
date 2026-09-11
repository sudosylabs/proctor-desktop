import { SettingsPersistenceActions } from './settingsPersistenceActions.js';
import { SettingsJsonRenderer } from './settingsJsonRenderer.js';
import type { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { SettingsModalStatus } from './settingsModalStatus.js';
import './settingsEditorContributions.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../base/common/vscodeNls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import type { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import type { UserSettingsProjection } from '../../../../platform/settings/common/settingsRendererProtocol.js';
import { userSettingsResource } from '../../../../platform/settings/common/settingsResource.js';
import { EditorPaneDescriptor, type IEditorPaneRegistry } from '../../../browser/editor.js';
import { TextResourceEditor } from '../../../browser/parts/editor/textResourceEditor.js';
import { EditorExtensions, type IEditorPane } from '../../../common/editor.js';
import type { IModalEditorPart } from '../../../services/editor/common/editorGroupsService.js';
import { RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { IEditorSaveConfirmation } from '../../../services/dialogs/browser/editorSaveConfirmation.js';
import { SettingsEditorModels } from '../../../services/settings/browser/settingsEditorModels.js';
import type { IOpenSettingsOptions } from '../../../services/preferences/common/preferences.js';
import type { SettingsRendererClient } from '../../../services/settings/common/settingsRendererClient.js';
import { SettingsWorkingCopy } from '../../../services/settings/browser/settingsWorkingCopy.js';
import { SettingsJsonNavigation } from '../../../services/settings/browser/settingsJsonNavigation.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { SettingsEditorSession } from '../../../services/settings/browser/settingsEditorSession.js';
import { SettingsJsonLanguageServices } from '../../../services/settings/browser/settingsJsonLanguageServices.js';
import { ISettingsEditorNavigation } from '../../../services/settings/browser/settingsEditorNavigation.js';
import type { SettingsEditorPartServices } from '../../../services/settings/browser/settingsEditorPartServices.js';
import { PreferencesSearchService } from '../../preferences/browser/preferencesSearch.js';
import { IPreferencesSearchService } from '../../preferences/common/preferences.js';
import { SettingsEditor2 } from '../../preferences/browser/settingsEditor2.js';
import { SettingsJsonEditorInput } from './settingsJsonEditorInput.js';
import { SettingsGraphicalEditorInput } from './settingsGraphicalEditorInput.js';
import {
	SettingsEditorKeyboardActions,
	SettingsEditorTitleContribution
} from './settingsEditorActions.js';

interface OpenSettings {
	readonly store: DisposableStore;
	readonly session: SettingsEditorSession;
	readonly json: SettingsJsonEditorInput;
	readonly graphical: SettingsGraphicalEditorInput;
	readonly modal: IModalEditorPart;
	readonly jsonNavigation: SettingsJsonNavigation;
	graphicalPane: SettingsEditor2 | undefined;
}

/** One modal owner; both original editor panes share one document and persistence session. */
export class SettingsModal extends Disposable implements ISettingsEditorNavigation {
	declare readonly _serviceBrand: undefined;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChangeState = this.changed.event;
	private current: OpenSettings | undefined;
	private opening: Promise<OpenSettings> | undefined;
	private closing: Promise<void> = Promise.resolve();
	private closed = false;
	private projectionSequence = 0;
	private latestProjection: UserSettingsProjection;
	constructor(
		services: ServiceCollection,
		private readonly instantiation: IInstantiationService,
		private readonly parts: SettingsEditorPartServices,
		private readonly client: SettingsRendererClient,
		private readonly document: Document,
		initial: UserSettingsProjection,
		private readonly applyPresentation: (
			source: string,
			projection: UserSettingsProjection
		) => void
	) {
		super();
		this.latestProjection = initial;
		this._register(
			toDisposable(
				client.onDidChange((next) => {
					this.projectionSequence++;
					this.latestProjection = next;
					if (!this.current && !this.opening && !this.closed)
						this.applyPresentation(next.source, next);
				})
			)
		);
		services.set(ISettingsEditorNavigation, this);
		services.set(
			IPreferencesSearchService,
			this._register(instantiation.createInstance(PreferencesSearchService))
		);
		const panes = Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane);
		this._register(
			panes.registerEditorPane(
				EditorPaneDescriptor.create(
					TextResourceEditor,
					TextResourceEditor.ID,
					localize('settings.json', 'settings.json')
				),
				[new SyncDescriptor(SettingsJsonEditorInput)]
			)
		);
		this._register(
			panes.registerEditorPane(
				EditorPaneDescriptor.create(
					SettingsEditor2,
					SettingsEditor2.ID,
					localize('settings.title', 'Settings')
				),
				[new SyncDescriptor(SettingsGraphicalEditorInput)]
			)
		);
		this._register(
			parts.resolver.registerEditor(
				'*',
				{
					id: SettingsJsonEditorInput.ID,
					label: localize('settings.json', 'settings.json'),
					priority: RegisteredEditorPriority.exclusive
				},
				{
					singlePerResource: true,
					canSupportResource: (resource) =>
						!!this.current && resource.toString() === userSettingsResource.toString()
				},
				{
					createEditorInput: (input) => {
						if (
							!this.current ||
							input.resource.toString() !== userSettingsResource.toString()
						)
							throw new Error('Settings document is not open.');
						return { editor: this.current.json, options: input.options };
					}
				}
			)
		);
		this._register(new SettingsEditorKeyboardActions());
		this._register(new SettingsEditorTitleContribution());
		this._register(
			instantiation.invokeFunction(
				(accessor) => new SettingsPersistenceActions(this, accessor.get(IContextKeyService))
			)
		);
		parts.registrations.complete();
	}

	get session(): SettingsEditorSession | undefined {
		return this.current?.session;
	}
	get isReadonly(): boolean {
		return this.current?.session.isReadonly() ?? true;
	}
	get visible(): boolean {
		return !!this.current;
	}

	async openSettingsUi(options: IOpenSettingsOptions = {}): Promise<IEditorPane | undefined> {
		const current = await this.ensureOpen();
		await current.graphicalPane?.flushPendingChanges();
		this.assertCurrent(current);
		const pane = await this.group(current, options.groupId).openEditor(current.graphical, {
			...options,
			pinned: true
		});
		this.assertCurrent(current);
		if (!(pane instanceof SettingsEditor2))
			throw new Error('The Settings editor could not open.');
		if (current.graphicalPane !== pane) {
			current.store.add(
				pane.onDidChangePendingEdits(() => current.session.notifyControlChange())
			);
			current.store.add(pane.onDidFailEdit(() => current.session.notifyEditFailure()));
		}
		current.graphicalPane = pane;
		return pane;
	}

	async openSettingsJson(options: IOpenSettingsOptions = {}): Promise<IEditorPane | undefined> {
		const current = await this.ensureOpen();
		await current.graphicalPane?.flushPendingChanges();
		this.assertCurrent(current);
		const pane = await this.group(current, options.groupId).openEditor(current.json, {
			...options,
			pinned: true
		});
		this.assertCurrent(current);
		if (pane && options.revealSetting)
			await current.jsonNavigation.revealSetting(
				options.revealSetting.key,
				!!options.revealSetting.edit,
				pane,
				userSettingsResource
			);
		return pane;
	}

	private group(current: OpenSettings, groupId: number | undefined) {
		const group =
			groupId === undefined
				? current.modal.activeGroup
				: current.modal.groups.find((group) => group.id === groupId);
		if (!group) throw new Error('Settings target group is not owned by this modal.');
		return group;
	}

	private assertCurrent(current: OpenSettings): void {
		if (this.closed || this.current !== current) throw new CancellationError();
	}

	private ensureOpen(): Promise<OpenSettings> {
		if (this.closed) return Promise.reject(new CancellationError());
		if (this.current) return Promise.resolve(this.current);
		if (this.opening) return this.opening;
		const opening = this.create().finally(() => {
			if (this.opening === opening) this.opening = undefined;
		});
		this.opening = opening;
		return opening;
	}

	private async create(): Promise<OpenSettings> {
		await this.closing;
		if (this.closed) throw new CancellationError();
		const sequence = this.projectionSequence;
		const projection = await this.client.projection();
		if (this.closed) throw new CancellationError();
		const initial = sequence === this.projectionSequence ? projection : this.latestProjection;
		const store = new DisposableStore();
		let modal: IModalEditorPart | undefined;
		try {
			const renderers = store.add(new DisposableStore());
			const copy = store.add(
				this.instantiation.createInstance(
					SettingsWorkingCopy,
					initial.source,
					initial.revision
				)
			);
			let current: OpenSettings | undefined;
			const session = store.add(
				new SettingsEditorSession(copy, initial, this.client, {
					flushEdits: async () => {
						await current?.graphicalPane?.flushPendingChanges();
					},
					hasPendingEdits: () => current?.graphicalPane?.hasPendingEdits ?? false,
					discardEdits: () => current?.graphicalPane?.discardPendingChanges(),
					confirmClose: () =>
						this.instantiation.invokeFunction((accessor) =>
							accessor.get(IEditorSaveConfirmation).showSaveConfirm(['settings.json'])
						),
					applyPresentation: this.applyPresentation
				})
			);
			this.instantiation.invokeFunction((accessor) => {
				const editors = accessor.get(ICodeEditorService);
				const attach = (editor: ICodeEditor): void => {
					renderers.add(
						this.instantiation.createInstance(SettingsJsonRenderer, editor, session)
					);
				};
				renderers.add(editors.onCodeEditorAdd(attach));
				for (const editor of editors.listCodeEditors()) attach(editor);
			});
			store.add(
				this.instantiation.createInstance(
					SettingsJsonLanguageServices,
					copy.document.model,
					this.document
				)
			);
			const models = store.add(this.instantiation.createInstance(SettingsEditorModels));
			const catalog = models.createGraphicalModel();
			const json = store.add(
				this.instantiation.createInstance(SettingsJsonEditorInput, session)
			);
			const graphical = store.add(
				new SettingsGraphicalEditorInput(
					catalog,
					session,
					() => copy.draft.validation.valid
				)
			);
			modal = await this.parts.parts.createModalEditorPart({
				footer: {
					render: (container) =>
						new SettingsModalStatus(container as HTMLElement, session)
				}
			});
			if (this.closed) throw new CancellationError();
			const jsonNavigation = this.instantiation.invokeFunction(
				(accessor) =>
					new SettingsJsonNavigation(
						accessor.get(IConfigurationService),
						this.instantiation,
						accessor.get(ITextModelService),
						copy,
						() => {
							if (!current) throw new CancellationError();
							this.assertCurrent(current);
						}
					)
			);
			current = {
				store,
				session,
				json,
				graphical,
				modal,
				jsonNavigation,
				graphicalPane: undefined
			};
			this.current = current;
			store.add(session.onDidChangeState(() => this.changed.fire()));
			this.changed.fire();
			const owned = current;
			store.add(
				Event.once(modal.onWillDispose)(() => {
					if (this.current !== owned) return;
					this.current = undefined;
					this.changed.fire();
					this.closing = session.shutdown().finally(() => store.dispose());
					// The next open observes a failed cancellation rather than racing a stale preview.
					void this.closing.catch(() => undefined);
				})
			);
			return current;
		} catch (error) {
			if (modal) await modal.close();
			store.dispose();
			throw error;
		}
	}

	async close(): Promise<boolean> {
		return this.current ? this.current.modal.close() : true;
	}

	override dispose(): void {
		if (this.closed) return;
		this.closed = true;
		const current = this.current;
		this.current = undefined;
		this.changed.fire();
		current?.session.dispose();
		current?.store.dispose();
		super.dispose();
	}
}
