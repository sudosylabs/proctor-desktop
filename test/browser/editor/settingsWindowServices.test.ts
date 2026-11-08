import { SettingsModal } from '../../../src/prctr/workbench/contrib/settings/browser/settingsModal.js';
import type { UserSettingsProjection } from '../../../src/prctr/platform/settings/common/settingsRendererProtocol.js';
import { Emitter } from '../../../src/prctr/base/common/event.js';
import { exerciseSettingsEditorSession } from './settingsEditorSession.test.js';
import { SettingsEditor2 } from '../../../src/prctr/workbench/contrib/preferences/browser/settingsEditor2.js';
import { exerciseRenderedLinesDom } from './renderedLinesDom.test.js';
import '../../../src/prctr/workbench/contrib/settings/browser/settingsEditorContributions.js';
import { DisposableStore } from '../../../src/prctr/base/common/lifecycle.js';
import { InstantiationService } from '../../../src/prctr/platform/instantiation/common/instantiationService.js';
import { ServiceCollection } from '../../../src/prctr/platform/instantiation/common/serviceCollection.js';
import { IContextKeyService } from '../../../src/prctr/platform/contextkey/common/contextkey.js';
import { ContextKeyService } from '../../../src/prctr/platform/contextkey/browser/contextKeyService.js';
import { ICommandService } from '../../../src/prctr/platform/commands/common/commands.js';
import { IKeybindingService } from '../../../src/prctr/platform/keybinding/common/keybinding.js';
import { CommandService } from '../../../src/prctr/workbench/services/commands/common/commandService.js';
import {
	BrowserKeybindingService,
	WorkbenchKeybindingFeedbackService
} from '../../../src/prctr/workbench/services/keybinding/browser/browserKeybindingService.js';
import { BrowserThemeService } from '../../../src/prctr/platform/theme/browser/themeService.js';
import { EditorWorkbenchLayoutService } from '../../../src/prctr/workbench/services/layout/browser/editorWorkbenchLayoutService.js';
import { Position } from '../../../src/prctr/workbench/services/layout/browser/layoutService.js';
import { SettingsEditorPartServices } from '../../../src/prctr/workbench/services/settings/browser/settingsEditorPartServices.js';
import { BrowserClipboardService } from '../../../src/prctr/platform/clipboard/browser/clipboardService.js';
import { ILogService, NullLogService } from '../../../src/prctr/platform/log/common/log.js';
import { NotificationService } from '../../../src/prctr/workbench/services/notification/common/notificationService.js';
import { NotificationStorage } from '../../../src/prctr/workbench/services/notification/common/notificationStorage.js';
import { SettingsEditorWindowServices } from '../../../src/prctr/workbench/services/settings/browser/settingsEditorWindowServices.js';
import { SettingsWorkingCopy } from '../../../src/prctr/workbench/services/settings/browser/settingsWorkingCopy.js';
import { CodeEditorWidget } from '../../../src/prctr/editor/browser/widget/codeEditor/codeEditorWidget.js';
import { createRenderedLinesFragment } from '../../../src/prctr/editor/browser/view/renderedLinesDom.js';

import { Event } from '../../../src/prctr/base/common/event.js';
import { ProgressBar } from '../../../src/prctr/base/browser/ui/progressbar/progressbar.js';
import { ScopedProgressIndicator } from '../../../src/prctr/workbench/services/progress/browser/progressIndicator.js';
import { InMemoryStorageService } from '../../../src/prctr/platform/storage/common/storage.js';
import { ContextMenuService } from '../../../src/prctr/platform/contextview/browser/contextMenuService.js';
import { OpenerService } from '../../../src/prctr/editor/browser/services/openerService.js';
import { SettingsEditorControlServices } from '../../../src/prctr/workbench/services/settings/browser/settingsEditorControlServices.js';

import { defaultProgressBarStyles } from '../../../src/prctr/platform/theme/browser/defaultStyles.js';
import { SettingsJsonLanguageServices } from '../../../src/prctr/workbench/services/settings/browser/settingsJsonLanguageServices.js';
import {
	IBulkEditService,
	ResourceTextEdit,
	ResourceFileEdit
} from '../../../src/prctr/editor/browser/services/bulkEditService.js';
import { Range } from '../../../src/prctr/editor/common/core/range.js';
import { URI } from '../../../src/prctr/base/common/uri.js';
import { ITextModelService } from '../../../src/prctr/editor/common/services/resolverService.js';
import { IDialogService } from '../../../src/prctr/platform/dialogs/common/dialogs.js';
import { EditorWindowHostService } from '../../../src/prctr/workbench/services/host/browser/editorWindowHostService.js';
import { IHoverService } from '../../../src/prctr/platform/hover/browser/hover.js';
import {
	exerciseHoverBindingLifetime,
	exerciseInstantHoverOwnership
} from './hoverLifetime.test.js';

async function eventually(predicate: () => boolean, message: string): Promise<void> {
	const deadline = performance.now() + 3000;
	while (!predicate()) {
		if (performance.now() >= deadline) throw new Error(message);
		await new Promise<void>((resolve) => setTimeout(resolve, 20));
	}
}

function check(value: unknown, message: string): void {
	if (!value) throw new Error(message);
}

/** Exercises the production window service graph with an actual Monaco view and existing kernel services. */
export async function exerciseSettingsWindowServices(): Promise<void> {
	const store = new DisposableStore();
	const violations: string[] = [];
	const onViolation = (event: SecurityPolicyViolationEvent): void => {
		violations.push(
			`${event.violatedDirective} ${event.sourceFile}:${event.lineNumber}:${event.columnNumber}`
		);
	};
	document.addEventListener('securitypolicyviolation', onViolation);
	store.add({
		dispose: () => document.removeEventListener('securitypolicyviolation', onViolation)
	});
	const host = document.body.appendChild(document.createElement('div'));
	host.style.width = '600px';
	host.style.height = '360px';
	store.add({ dispose: () => host.remove() });
	try {
		exerciseHoverBindingLifetime();
		await exerciseRenderedLinesDom();
		const rendered = host.appendChild(document.createElement('div'));
		rendered.appendChild(
			createRenderedLinesFragment(
				document,
				'<div style="height:21px" title="a style=\'literal\' >"><span style="display:inline-block;width:42px">text style="literal" &lt;span style="text"&gt;</span><svg style="height:3px;width:4px"></svg></div>'
			)
		);
		check(
			rendered.firstElementChild?.getBoundingClientRect().height === 21 &&
				rendered.querySelector('span')?.getBoundingClientRect().width === 42,
			'Generated line geometry was not preserved under CSP.'
		);
		check(
			rendered.textContent === 'text style="literal" <span style="text">' &&
				rendered.firstElementChild?.getAttribute('title') === "a style='literal' >",
			'Style deferral changed escaped source or another attribute.'
		);
		check(
			!rendered.querySelector('[data-prctr-rendered-style]'),
			'Temporary rendering attributes escaped into the editor DOM.'
		);
		const services = new ServiceCollection();
		const instantiation = store.add(new InstantiationService(services, true));
		const context = store.add(new ContextKeyService());
		services.set(IContextKeyService, context);
		const commands = store.add(new CommandService(instantiation));
		services.set(ICommandService, commands);
		const feedback = host.appendChild(document.createElement('span'));
		const keybindings = store.add(
			new BrowserKeybindingService(
				document,
				context,
				commands,
				new WorkbenchKeybindingFeedbackService(feedback)
			)
		);
		services.set(IKeybindingService, keybindings);
		const layout = store.add(
			new EditorWorkbenchLayoutService(
				host,
				{
					parts: new Map(),
					onDidChangePresentation: Event.None,
					readOffset: () => ({ top: 0, quickPickTop: 0 }),
					focusContent: () => host.focus(),
					isRestored: () => true,
					readPresentation: () => ({
						floating: true,
						compact: false,
						uppercaseHeaders: false
					}),
					relayout() {},
					readPositions: () => ({
						sidebar: Position.LEFT,
						panel: Position.BOTTOM,
						panelAlignment: 'center'
					}),
					setPartHidden() {
						throw new Error('No shell part is registered in this fixture');
					}
				},
				Promise.resolve()
			)
		);
		const presentation = store.add(
			new BrowserThemeService(document, 'dark', {
				density: 'default',
				motion: 'full',
				transparency: 'full'
			})
		);
		const clipboard = store.add(new BrowserClipboardService(layout, new NullLogService()));
		const notifications = store.add(new NotificationService(new NotificationStorage()));
		let readonly = false;
		const runtime = store.add(
			new SettingsEditorWindowServices(services, instantiation, {
				source: '{}',
				document,
				presentation,
				layout,
				clipboard,
				notifications,
				isSettingsReadonly: () => readonly
			})
		);
		await runtime.initialize();
		class FixtureLogService extends NullLogService {
			override error(message: string | Error, ...args: unknown[]): void {
				console.error(message, ...args);
			}
		}
		services.set(ILogService, new FixtureLogService());
		const progressBar = store.add(
			new ProgressBar(host, { ...defaultProgressBarStyles, ariaLabel: 'Settings progress' })
		);
		const progress = store.add(
			new ScopedProgressIndicator(progressBar, {
				onDidChangeActive: Event.None,
				isActive: true
			})
		);
		const controls = store.add(
			new SettingsEditorControlServices(services, instantiation, {
				storage: store.add(new InMemoryStorageService()),
				isDevelopment: false,
				progress,
				windowHost: store.add(
					new EditorWindowHostService(window, {
						async focus() {
							window.focus();
						},
						async moveTop() {
							window.focus();
						},
						async setDimmed(dimmed) {
							host.classList.toggle('fixture-dimmed', dimmed);
						},
						async getCursorScreenPoint() {
							return undefined;
						}
					})
				),
				createContextMenu: (owner) => owner.createInstance(ContextMenuService),
				createOpener: (owner) => owner.createInstance(OpenerService)
			})
		);
		check(
			services.get(ICommandService) === commands &&
				services.get(IKeybindingService) === keybindings &&
				services.get(IContextKeyService) === context,
			'Settings replaced the kernel interaction owner.'
		);
		exerciseInstantHoverOwnership(host);
		const copy = store.add(instantiation.createInstance(SettingsWorkingCopy, '{}', 'r1'));
		const json = store.add(
			instantiation.createInstance(
				SettingsJsonLanguageServices,
				copy.document.model,
				document
			)
		);
		await json.validate();
		const container = host.appendChild(document.createElement('div'));
		const editor = store.add(
			instantiation.createInstance(
				CodeEditorWidget,
				container,
				{ minimap: { enabled: false } },
				{}
			)
		);
		editor.setModel(copy.document.model);
		editor.layout({ width: 600, height: 360 });
		editor.focus();
		editor.setPosition({ lineNumber: 1, column: 2 });
		editor.trigger('keyboard', 'type', { text: '"editor.fontSize":18' });
		check(
			copy.draft.source === '{"editor.fontSize":18}',
			'Actual editor typing did not update the shared source.'
		);
		await copy.document.model.undo();
		check(copy.draft.source === '{}', 'Actual editor undo did not restore the working source.');
		copy.document.replace('{}');
		editor.setPosition({ lineNumber: 1, column: 2 });
		await editor.getAction('editor.action.commentLine')!.run();
		check(
			copy.draft.source.includes('//'),
			'The packaged JSONC line-comment rule was not registered.'
		);
		await editor.getAction('editor.action.commentLine')!.run();
		check(
			copy.draft.source === '{}',
			'The JSONC comment action did not toggle back to the original source.'
		);
		editor.trigger('keyboard', 'type', { text: '\n' });
		check(
			copy.document.model.getLineCount() === 3 &&
				copy.document.model.getLineContent(2).length > 0,
			'JSONC bracket indentation did not create the inner indented line.'
		);
		copy.document.replace('{}');
		await runtime.configuration.updateValue('editor.fontSize', 20);
		check(
			editor.getValue().includes('20'),
			'Graphical configuration edit did not reach the existing Monaco view.'
		);
		const references = instantiation.invokeFunction((accessor) =>
			accessor.get(ITextModelService)
		);
		const firstReference = await references.createModelReference(copy.document.model.uri);
		const secondReference = await references.createModelReference(copy.document.model.uri);
		check(
			firstReference.object === secondReference.object,
			'Resolver references did not share their original owner.'
		);
		firstReference.dispose();
		secondReference.dispose();
		await Promise.resolve();
		check(
			!copy.document.model.isDisposed(),
			'Closing a model reference destroyed the Settings working copy.'
		);
		const bulk = instantiation.invokeFunction((accessor) => accessor.get(IBulkEditService));
		const beforeBulk = copy.draft.source;
		const edit = () =>
			new ResourceTextEdit(
				copy.document.model.uri,
				{ range: new Range(1, 2, 1, 2), text: ' ' },
				copy.document.model.getVersionId()
			);
		check(
			(await bulk.apply([edit()])).isApplied,
			'A source edit did not apply through the original bulk edit service.'
		);
		await copy.document.model.undo();
		check(copy.draft.source === beforeBulk, 'Source bulk edit did not share Monaco undo.');
		readonly = true;
		let refused = false;
		try {
			await bulk.apply([edit()]);
		} catch {
			refused = true;
		}
		check(
			refused && copy.draft.source === beforeBulk,
			'A bulk edit changed read-only Settings.'
		);
		readonly = false;
		refused = false;
		try {
			await bulk.apply([
				edit(),
				new ResourceFileEdit(undefined, URI.from({ scheme: 'file', path: '/not-allowed' }))
			]);
		} catch {
			refused = true;
		}
		check(
			refused && copy.draft.source === beforeBulk,
			'A mixed filesystem operation partially changed Settings.'
		);
		editor.focus();
		await eventually(() => editor.hasWidgetFocus(), 'Editor did not receive native focus.');
		await editor.getAction('actions.find')!.run();
		check(
			!!container.querySelector('.find-widget textarea'),
			'The original find widget did not open.'
		);
		editor.trigger('keyboard', 'closeFindWidget', undefined);
		copy.document.replace('{\n \n}');
		editor.setPosition({ lineNumber: 2, column: 2 });
		await editor.getAction('editor.action.triggerSuggest')!.run();
		await eventually(
			() =>
				!!container.querySelector(
					'.suggest-widget.visible .monaco-list-row, .suggest-widget.visible .prctr-list-row'
				),
			'Schema-backed suggestions did not render.'
		);
		check(
			container.querySelector('.suggest-widget')?.textContent?.includes('editor.'),
			'The suggestion widget did not display the packaged settings catalog.'
		);
		editor.trigger('keyboard', 'acceptSelectedSuggestion', undefined);
		await eventually(
			() => copy.draft.source !== '{\n \n}',
			'Accepting a schema suggestion did not insert it into the working document.'
		);
		await copy.document.model.undo();
		check(
			copy.draft.source === '{\n \n}',
			'Accepting a schema suggestion did not form one undoable edit.'
		);
		editor.trigger('keyboard', 'hideSuggestWidget', undefined);
		copy.document.replace('{"editor.fontSize":18,"editor.lineNumbers":"on"}');
		editor.setPosition({ lineNumber: 1, column: 5 });
		await editor.getAction('editor.action.showHover')!.run();
		await eventually(
			() => !!container.querySelector('.monaco-hover')?.textContent?.includes('font size'),
			'The packaged schema hover did not render.'
		);
		const hover = container.querySelector<HTMLElement>('.monaco-resizable-hover')!;
		check(
			getComputedStyle(hover).borderTopLeftRadius === '8px',
			'The editor hover lost the pinned VS Code large corner radius.'
		);
		editor.trigger('keyboard', 'editor.action.hideHover', undefined);
		check(
			editor.getAction('editor.action.formatDocument')!.isSupported(),
			'Formatting action is incorrectly disabled for a writable JSON document.'
		);
		await editor.getAction('editor.action.formatDocument')!.run();
		check(
			copy.draft.source.includes('\n'),
			'The original format action did not format the Settings document.'
		);
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
		);
		check(
			(container.querySelector('.view-line')?.getBoundingClientRect().height ?? 0) > 0,
			'Monaco did not render a visible line.'
		);
		await exerciseSettingsEditorSession(copy, runtime.configuration);
		editor.dispose();
		container.remove();
		json.dispose();
		copy.dispose();
		const parts = store.add(
			new SettingsEditorPartServices(services, instantiation, layout, runtime.editors)
		);
		const projectionEvents = store.add(new Emitter<UserSettingsProjection>());
		let acknowledged: UserSettingsProjection = {
			source: '{"editor.fontSize":18}',
			revision: 'r1',
			writable: true,
			availability: 'available',
			presentation: {
				windowTheme: 'system',
				highContrast: false,
				zoomPercent: 100,
				reducedMotion: false
			}
		};
		const modalOwner = store.add(
			new SettingsModal(
				services,
				instantiation,
				parts,
				{
					async projection() {
						return acknowledged;
					},
					async preview() {
						projectionEvents.fire(acknowledged);
					},
					async cancelPreview() {
						projectionEvents.fire(acknowledged);
					},
					onDidChange(listener) {
						const subscription = projectionEvents.event(listener);
						return () => subscription.dispose();
					},
					async commit(intent) {
						acknowledged = { ...acknowledged, source: intent.source, revision: 'r2' };
						projectionEvents.fire(acknowledged);
						return { kind: 'success', projection: acknowledged };
					}
				},
				document,
				acknowledged,
				() => {}
			)
		);
		const pane = await modalOwner.openSettingsJson();
		check(
			pane?.getControl() === runtime.editors.getActiveCodeEditor(),
			'Modal editor did not activate the original code editor.'
		);
		check(
			runtime.editors.getActiveCodeEditor()?.getModel() ===
				modalOwner.session?.copy.document.model,
			'Modal editor replaced the Settings model.'
		);
		check(!!host.querySelector('.modal-editor-part'), 'Original modal host did not mount.');
		await modalOwner.openSettingsJson({
			revealSetting: { key: 'editor.fontSize', edit: true }
		});
		const modalEditor = runtime.editors.getActiveCodeEditor()!;
		const modalCopy = modalOwner.session!.copy;
		const status = host.querySelector<HTMLElement>('.prctr-settings-modal-status')!;
		check(
			status?.getAttribute('role') === 'status' && status.closest('[role=dialog]'),
			'Settings persistence feedback is outside the modal accessibility tree.'
		);
		modalCopy.document.replace('{\n\t"editor.lineNumbers": "on"\n}');
		modalEditor.setPosition({ lineNumber: 2, column: 2 });
		await eventually(
			() =>
				modalCopy.document.model
					.getAllDecorations()
					.some((decoration) =>
						decoration.options.glyphMarginClassName?.includes('settings-edit')
					),
			'The original JSON setting edit glyph did not appear.'
		);
		projectionEvents.fire({ ...acknowledged, writable: false, availability: 'unavailable' });
		await eventually(
			() =>
				!modalCopy.document.model
					.getAllDecorations()
					.some((decoration) =>
						decoration.options.glyphMarginClassName?.includes('settings-edit')
					),
			'Read-only JSON retained an editable setting glyph.'
		);
		projectionEvents.fire(acknowledged);
		await modalOwner.session!.revert();
		await modalOwner.openSettingsJson({
			revealSetting: { key: 'editor.fontSize', edit: true }
		});
		check(
			modalEditor.getPosition()?.column === 22,
			'Edit in settings.json did not position the cursor after the existing value.'
		);
		modalEditor.trigger('keyboard', 'hideSuggestWidget', undefined);
		await modalOwner.openSettingsJson({
			revealSetting: { key: 'editor.tokenColorCustomizations', edit: true }
		});
		check(
			modalCopy.draft.source.includes('"editor.tokenColorCustomizations"'),
			'Edit in settings.json did not insert the registered object default.'
		);
		check(
			modalCopy.document.model
				.getLineContent(modalEditor.getPosition()!.lineNumber)
				.trim() === '',
			'Object editing did not open an indented line inside the value.'
		);
		check(
			acknowledged.source === '{"editor.fontSize":18}',
			'JSON reveal unexpectedly persisted a draft.'
		);
		modalEditor.trigger('keyboard', 'hideSuggestWidget', undefined);
		await modalOwner.session!.revert();
		const unmodified = modalCopy.draft.source;
		await modalOwner.openSettingsJson({
			revealSetting: { key: 'unregistered.setting', edit: true }
		});
		check(
			modalCopy.draft.source === unmodified,
			'JSON reveal inserted an unregistered setting.'
		);
		modalCopy.setReadonly(true);
		await modalOwner.openSettingsJson({
			revealSetting: { key: 'editor.tokenColorCustomizations', edit: true }
		});
		check(modalCopy.draft.source === unmodified, 'JSON reveal edited a read-only document.');
		modalCopy.setReadonly(false);
		modalCopy.document.replace('{ invalid');
		await modalOwner.openSettingsJson({
			revealSetting: { key: 'editor.tokenColorCustomizations', edit: true }
		});
		check(modalCopy.draft.source === '{ invalid', 'JSON reveal overwrote invalid source.');
		check(
			status.textContent?.includes('problems before saving'),
			'Invalid-source feedback was not visible in the modal.'
		);
		await modalOwner.session!.revert();
		await modalOwner.openSettingsUi({ query: '@id:editor.wordWrap' });
		await eventually(
			() => !!host.querySelector('[data-key="editor.wordWrap"] select'),
			'The enum control did not render.'
		);
		const select = host.querySelector<HTMLElement>('[data-key="editor.wordWrap"] select')!;
		check(
			getComputedStyle(select).appearance === 'none',
			'Settings used the OS select arrow instead of the original workbench arrow.'
		);
		check(
			getComputedStyle(select).borderTopLeftRadius === '4px',
			'Settings lost the original select corner radius.'
		);
		check(
			getComputedStyle(select.closest('.select-container')!, '::after').content.includes(
				'\ueab4'
			),
			'The original select chevron glyph was not styled.'
		);
		const labelIcon = host.querySelector<HTMLElement>('.codicon-settings-editor-label-icon')!;
		check(
			labelIcon &&
				getComputedStyle(labelIcon, '::before').content.includes('\ueb52') &&
				getComputedStyle(labelIcon, '::before').fontFamily.includes('codicon'),
			'The Settings title did not render its original Codicon.'
		);
		const checkViewAction = async (mode: 'JSON' | 'UI'): Promise<void> => {
			const action = host.querySelector<HTMLElement>(
				`.modal-editor-header [aria-label^="Open Settings (${mode})"]`
			)!;
			check(
				action && getComputedStyle(action, '::before').content.includes('\uea94'),
				`The ${mode} view switch did not use the original go-to-file icon.`
			);
			action.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
			await eventually(
				() =>
					[...host.querySelectorAll('.monaco-hover')].some((hover) =>
						hover.textContent?.includes(`Open Settings (${mode})`)
					),
				`The ${mode} view switch tooltip did not appear on hover.`
			);
			instantiation.invokeFunction((accessor) => accessor.get(IHoverService).hideHover());
		};
		await checkViewAction('JSON');
		const graphical = await modalOwner.openSettingsUi({ query: '@id:editor.fontSize' });
		check(
			graphical?.getId() === SettingsEditor2.ID,
			'Original graphical Settings pane did not open.'
		);
		await eventually(
			() => !!host.querySelector('[data-key="editor.fontSize"] input'),
			'The original Settings tree did not render its number control.'
		);
		const numberInput = host.querySelector<HTMLInputElement>(
			'[data-key="editor.fontSize"] input'
		)!;
		numberInput.value = '20';
		numberInput.dispatchEvent(new window.Event('input', { bubbles: true }));
		await modalOwner.openSettingsJson();
		const jsonIcon = host.querySelector<HTMLElement>(
			'.modal-editor-title .jsonc-lang-file-icon'
		)!;
		check(
			jsonIcon && getComputedStyle(jsonIcon, '::before').fontFamily.includes('seti'),
			'The JSON title did not use the packaged file icon theme.'
		);
		const fonts = await document.fonts.load('16px seti');
		check(
			fonts.length > 0 && fonts.every((font) => font.status === 'loaded'),
			'The packaged Seti font did not load.'
		);
		await checkViewAction('UI');
		const darkIconColor = getComputedStyle(jsonIcon, '::before').color;
		presentation.setTheme('GitHub Light Default');
		check(
			host.classList.contains('vs') &&
				!host.classList.contains('vs-dark') &&
				getComputedStyle(jsonIcon, '::before').color !== darkIconColor,
			'The source workbench and file icons did not follow a light theme change.'
		);
		presentation.setTheme('GitHub Dark High Contrast');
		check(
			host.classList.contains('hc-black') && !host.classList.contains('vs'),
			'The source workbench did not activate its high-contrast class.'
		);
		presentation.setTheme('GitHub Dark Default');
		check(
			modalOwner.session!.copy.draft.source.includes('20'),
			'Switching to JSON dropped the pending graphical edit.'
		);
		check(await modalOwner.session!.save(), 'Modal session failed to save.');
		check(await modalOwner.close(), 'Clean modal failed to close.');
		await modalOwner.openSettingsUi();
		check(
			modalOwner.session?.copy.draft.source === acknowledged.source,
			'Reopening did not create the latest Settings working copy.'
		);
		check(await modalOwner.close(), 'Reopened modal failed to close.');

		const dialogs = instantiation.invokeFunction((accessor) => accessor.get(IDialogService));
		const confirmed = dialogs.confirm({
			message: 'Save the Settings draft?',
			primaryButton: 'Save'
		});
		await eventually(
			() => !!host.querySelector('.monaco-dialog-box .dialog-buttons-row .monaco-button'),
			'The original dialog did not open.'
		);
		const save = Array.from(
			host.querySelectorAll<HTMLElement>('.monaco-dialog-box .monaco-button')
		).find((button) => button.textContent === 'Save');
		check(save, 'The original dialog omitted its primary action.');
		save!.click();
		check(
			(await confirmed).confirmed,
			'The original dialog did not return its primary choice.'
		);
		const pending = [
			dialogs.confirm({ message: 'First pending dialog' }),
			dialogs.confirm({ message: 'Second pending dialog' })
		];
		const settled = Promise.allSettled(pending);
		controls.dispose();
		check(
			(await settled).every((result) => result.status === 'rejected'),
			'Closing Settings left a dialog promise pending.'
		);
		check(
			!host.querySelector('.monaco-dialog-box'),
			'Closing Settings left a dialog in the document.'
		);
		check(violations.length === 0, `Editor violated CSP: ${violations.join(', ')}`);
		editor.dispose();
		check(runtime.editors.getActiveCodeEditor() === null, 'Disposed editor remained active.');
	} finally {
		store.dispose();
	}
}
