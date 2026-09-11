/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @proctor-vscode-port settings-editor-modal-services
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { isBoolean, isObject, isString } from '../../../../base/common/types.js';
import * as nls from '../../../../base/common/vscodeNls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import type { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IListService } from '../../../../platform/list/browser/listService.js';
import { Context as SuggestContext } from '../../../../editor/contrib/suggest/browser/suggest.js';
import { resolveCommandsContext } from '../../../browser/parts/editor/editorCommandsContext.js';
import { ResourceContextKey } from '../../../common/editorContextKeys.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditorGroupsService, type IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { ISettingsEditorNavigation } from '../../../services/settings/browser/settingsEditorNavigation.js';
import { userSettingsResource } from '../../../../platform/settings/common/settingsResource.js';
import { SettingsEditor2, SettingsFocusContext } from '../../preferences/browser/settingsEditor2.js';
import { preferencesOpenSettingsIcon } from '../../preferences/browser/preferencesIcons.js';
import { CONTEXT_SETTINGS_EDITOR, CONTEXT_SETTINGS_FIRST_ROW_FOCUS, CONTEXT_SETTINGS_JSON_EDITOR, CONTEXT_SETTINGS_ROW_FOCUS, CONTEXT_SETTINGS_SEARCH_FOCUS, CONTEXT_TOC_ROW_FOCUS, SETTINGS_EDITOR_COMMAND_CLEAR_SEARCH_RESULTS, SETTINGS_EDITOR_COMMAND_SHOW_CONTEXT_MENU } from '../../preferences/common/preferences.js';

const SETTINGS_EDITOR_COMMAND_SEARCH = 'settings.action.search';

const SETTINGS_EDITOR_COMMAND_FOCUS_FILE = 'settings.action.focusSettingsFile';
const SETTINGS_EDITOR_COMMAND_FOCUS_SETTINGS_FROM_SEARCH = 'settings.action.focusSettingsFromSearch';
const SETTINGS_EDITOR_COMMAND_SHOW_PREVIOUS_SEARCH = 'settings.action.showPreviousSearch';
const SETTINGS_EDITOR_COMMAND_FOCUS_SETTINGS_FROM_SEARCH_ON_ENTER = 'settings.action.focusSettingsFromSearchOnEnter';
const SETTINGS_EDITOR_COMMAND_FOCUS_SEARCH_FROM_SETTINGS = 'settings.action.focusSearchFromSettings';
const SETTINGS_EDITOR_COMMAND_FOCUS_SETTINGS_LIST = 'settings.action.focusSettingsList';
const SETTINGS_EDITOR_COMMAND_FOCUS_TOC = 'settings.action.focusTOC';
const SETTINGS_EDITOR_COMMAND_FOCUS_CONTROL = 'settings.action.focusSettingControl';
const SETTINGS_EDITOR_COMMAND_FOCUS_UP = 'settings.action.focusLevelUp';

const SETTINGS_EDITOR_COMMAND_SWITCH_TO_JSON = 'settings.switchToJSON';

const category = Categories.Preferences;
const OPEN_USER_SETTINGS_UI_TITLE = nls.localize2('openSettings2', "Open Settings (UI)");
interface IOpenSettingsActionOptions {
	openToSide?: boolean;
	query?: string;
	revealSetting?: {
		key: string;
		edit?: boolean;
	};
	focusSearch?: boolean;
}

function sanitizeBoolean(arg: unknown): boolean | undefined {
	return isBoolean(arg) ? arg : undefined;
}

function sanitizeString(arg: unknown): string | undefined {
	return isString(arg) ? arg : undefined;
}

function sanitizeOpenSettingsArgs(args: any): IOpenSettingsActionOptions {
	if (!isObject(args)) {
		args = {};
	}

	let sanitizedObject: IOpenSettingsActionOptions = {
		focusSearch: sanitizeBoolean(args?.focusSearch),
		openToSide: sanitizeBoolean(args?.openToSide),
		query: sanitizeString(args?.query)
	};

	if (isString(args?.revealSetting?.key)) {
		sanitizedObject = {
			...sanitizedObject,
			revealSetting: {
				key: args.revealSetting.key,
				edit: sanitizeBoolean(args.revealSetting?.edit)
			}
		};
	}

	return sanitizedObject;
}


export class SettingsEditorKeyboardActions extends Disposable {
	constructor() { super(); this.registerSettingsEditorActions(); }
	private registerSettingsEditorActions() {
		function getPreferencesEditor(accessor: ServicesAccessor): SettingsEditor2 | null {
			const activeEditorPane = accessor.get(IEditorService).activeEditorPane;
			if (activeEditorPane instanceof SettingsEditor2) {
				return activeEditorPane;
			}
			return null;
		}

		function settingsEditorFocusSearch(accessor: ServicesAccessor) {
			const preferencesEditor = getPreferencesEditor(accessor);
			preferencesEditor?.focusSearch();
		}

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_SEARCH,
					precondition: CONTEXT_SETTINGS_EDITOR,
					keybinding: {
						primary: KeyMod.CtrlCmd | KeyCode.KeyF,
						weight: KeybindingWeight.EditorContrib,
						when: null
					},
					category,
					f1: true,
					title: nls.localize2('settings.focusSearch', "Focus Settings Search")
				});
			}

			run(accessor: ServicesAccessor) { settingsEditorFocusSearch(accessor); }
		}));

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_CLEAR_SEARCH_RESULTS,
					precondition: CONTEXT_SETTINGS_EDITOR,
					keybinding: {
						primary: KeyCode.Escape,
						weight: KeybindingWeight.EditorContrib,
						when: CONTEXT_SETTINGS_SEARCH_FOCUS
					},
					category,
					f1: true,
					title: nls.localize2('settings.clearResults', "Clear Settings Search Results")
				});
			}

			run(accessor: ServicesAccessor) {
				const preferencesEditor = getPreferencesEditor(accessor);
				preferencesEditor?.clearSearchResults();
			}
		}));

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FOCUS_FILE,
					precondition: ContextKeyExpr.and(CONTEXT_SETTINGS_SEARCH_FOCUS, SuggestContext.Visible.toNegated()),
					title: nls.localize('settings.focusFile', "Focus settings file")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				preferencesEditor?.navigateSearchHistoryNextOrFocusSettings();
			}
		}));

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FOCUS_SETTINGS_FROM_SEARCH,
					precondition: ContextKeyExpr.and(CONTEXT_SETTINGS_SEARCH_FOCUS, SuggestContext.Visible.toNegated()),
					keybinding: {
						primary: KeyCode.DownArrow,
						weight: KeybindingWeight.WorkbenchContrib + 1,
						when: ContextKeyExpr.and(CONTEXT_SETTINGS_SEARCH_FOCUS, SuggestContext.Visible.toNegated())
					},
					title: nls.localize('settings.focusFile', "Focus settings file")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				preferencesEditor?.navigateSearchHistoryNextOrFocusSettings();
			}
		}));

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_SHOW_PREVIOUS_SEARCH,
					precondition: ContextKeyExpr.and(CONTEXT_SETTINGS_SEARCH_FOCUS, SuggestContext.Visible.toNegated()),
					keybinding: {
						primary: KeyCode.UpArrow,
						weight: KeybindingWeight.WorkbenchContrib + 1,
						when: ContextKeyExpr.and(CONTEXT_SETTINGS_SEARCH_FOCUS, SuggestContext.Visible.toNegated())
					},
					title: nls.localize('settings.showPreviousSearch', "Show Previous Search in Settings")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				preferencesEditor?.navigateSearchHistoryPrevious();
			}
		}));

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FOCUS_SETTINGS_FROM_SEARCH_ON_ENTER,
					precondition: ContextKeyExpr.and(CONTEXT_SETTINGS_SEARCH_FOCUS, SuggestContext.Visible.toNegated()),
					keybinding: {
						primary: KeyCode.Enter,
						weight: KeybindingWeight.WorkbenchContrib,
						when: ContextKeyExpr.and(CONTEXT_SETTINGS_SEARCH_FOCUS, SuggestContext.Visible.toNegated())
					},
					title: nls.localize('settings.focusSettingsFromSearchOnEnter', "Focus First Setting from Search")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				preferencesEditor?.focusFirstSettingFromSearch();
			}
		}));

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FOCUS_SEARCH_FROM_SETTINGS,
					precondition: ContextKeyExpr.and(CONTEXT_SETTINGS_EDITOR, CONTEXT_SETTINGS_ROW_FOCUS, CONTEXT_SETTINGS_FIRST_ROW_FOCUS),
					keybinding: {
						primary: KeyCode.UpArrow,
						// Win over the list's own `list.focusUp` command so the first row moves focus back to search.
						weight: KeybindingWeight.WorkbenchContrib + 1,
						when: null
					},
					title: nls.localize('settings.focusSearchFromSettings', "Focus Settings Search from Settings")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				preferencesEditor?.focusSearch();
			}
		}));

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FOCUS_SETTINGS_LIST,
					precondition: ContextKeyExpr.and(CONTEXT_SETTINGS_EDITOR, CONTEXT_TOC_ROW_FOCUS),
					keybinding: {
						primary: KeyCode.Enter,
						weight: KeybindingWeight.WorkbenchContrib,
						when: null
					},
					title: nls.localize('settings.focusSettingsList', "Focus settings list")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				if (preferencesEditor instanceof SettingsEditor2) {
					preferencesEditor.focusSettings();
				}
			}
		}));

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FOCUS_TOC,
					precondition: CONTEXT_SETTINGS_EDITOR,
					f1: true,
					keybinding: [
						{
							primary: KeyCode.LeftArrow,
							weight: KeybindingWeight.WorkbenchContrib,
							when: CONTEXT_SETTINGS_ROW_FOCUS
						}],
					category,
					title: nls.localize2('settings.focusSettingsTOC', "Focus Settings Table of Contents")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				if (!(preferencesEditor instanceof SettingsEditor2)) {
					return;
				}

				preferencesEditor.focusTOC();
			}
		}));

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FOCUS_CONTROL,
					precondition: ContextKeyExpr.and(CONTEXT_SETTINGS_EDITOR, CONTEXT_SETTINGS_ROW_FOCUS),
					keybinding: {
						primary: KeyCode.Enter,
						weight: KeybindingWeight.WorkbenchContrib,
					},
					title: nls.localize('settings.focusSettingControl', "Focus Setting Control")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				if (!(preferencesEditor instanceof SettingsEditor2)) {
					return;
				}

				const activeElement = preferencesEditor.getContainer()?.ownerDocument.activeElement;
				if (activeElement?.classList.contains('prctr-list')) {
					preferencesEditor.focusSettings(true);
				}
			}
		}));

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_SHOW_CONTEXT_MENU,
					precondition: CONTEXT_SETTINGS_EDITOR,
					keybinding: {
						primary: KeyMod.Shift | KeyCode.F9,
						weight: KeybindingWeight.WorkbenchContrib,
						when: null
					},
					f1: true,
					category,
					title: nls.localize2('settings.showContextMenu', "Show Setting Context Menu")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				if (preferencesEditor instanceof SettingsEditor2) {
					preferencesEditor.showContextMenu();
				}
			}
		}));

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FOCUS_UP,
					precondition: ContextKeyExpr.and(CONTEXT_SETTINGS_EDITOR, CONTEXT_SETTINGS_SEARCH_FOCUS.toNegated(), CONTEXT_SETTINGS_JSON_EDITOR.toNegated()),
					keybinding: {
						primary: KeyCode.Escape,
						weight: KeybindingWeight.WorkbenchContrib,
						when: null
					},
					f1: true,
					category,
					title: nls.localize2('settings.focusLevelUp', "Move Focus Up One Level")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				if (!(preferencesEditor instanceof SettingsEditor2)) {
					return;
				}

				if (preferencesEditor.currentFocusContext === SettingsFocusContext.SettingControl) {
					preferencesEditor.focusSettings();
				} else if (preferencesEditor.currentFocusContext === SettingsFocusContext.SettingTree) {
					preferencesEditor.focusTOC();
				} else if (preferencesEditor.currentFocusContext === SettingsFocusContext.TableOfContents) {
					preferencesEditor.focusSearch();
				}
			}
		}));
	}


}
export class SettingsEditorTitleContribution extends Disposable {

	static readonly ID = 'workbench.contrib.settingsEditorTitleBarActions';

	constructor(	) {
		super();
		this.registerSettingsEditorTitleActions();
	}

	private registerSettingsEditorTitleActions() {
		const registerOpenUserSettingsEditorFromJsonActionDisposables = this._register(new MutableDisposable());
		const registerOpenUserSettingsEditorFromJsonAction = () => {
			const openUserSettingsEditorWhen = ContextKeyExpr.and(
				CONTEXT_SETTINGS_EDITOR.toNegated(),
				ResourceContextKey.Resource.isEqualTo(userSettingsResource.toString()),
				ContextKeyExpr.not('isInDiffEditor'));
			registerOpenUserSettingsEditorFromJsonActionDisposables.clear();
			registerOpenUserSettingsEditorFromJsonActionDisposables.value = registerAction2(class extends Action2 {
				constructor() {
					super({
						id: '_workbench.openUserSettingsEditor',
						title: OPEN_USER_SETTINGS_UI_TITLE,
						icon: preferencesOpenSettingsIcon,
						menu: [{
							id: MenuId.EditorTitle,
							when: openUserSettingsEditorWhen,
							group: 'navigation',
							order: 1
						}, {
							id: MenuId.ModalEditorEditorTitle,
							when: openUserSettingsEditorWhen,
							group: 'navigation',
							order: 1
						}]
					});
				}
				run(accessor: ServicesAccessor, ...args: unknown[]) {
					const sanitizedArgs = sanitizeOpenSettingsArgs(args[0]);
					const groupId = getEditorGroupFromArguments(accessor, args)?.id;
					return accessor.get(ISettingsEditorNavigation).openSettingsUi({ ...sanitizedArgs, groupId });
				}
			});
		};

		registerOpenUserSettingsEditorFromJsonAction();

		const openSettingsJsonWhen = ContextKeyExpr.and(CONTEXT_SETTINGS_JSON_EDITOR.toNegated(), CONTEXT_SETTINGS_EDITOR);
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_SWITCH_TO_JSON,
					title: nls.localize2('openSettingsJson', "Open Settings (JSON)"),
					icon: preferencesOpenSettingsIcon,
					menu: [{
						id: MenuId.EditorTitle,
						when: openSettingsJsonWhen,
						group: 'navigation',
						order: 1
					}, {
						id: MenuId.ModalEditorEditorTitle,
						when: openSettingsJsonWhen,
						group: 'navigation',
						order: 1
					}]
				});
			}
			run(accessor: ServicesAccessor, ...args: unknown[]) {
				const group = getEditorGroupFromArguments(accessor, args);
				const editorPane = group?.activeEditorPane;
				if (editorPane instanceof SettingsEditor2) {
					return editorPane.switchToSettingsFile();
				}
				return null;
			}
		}));
	}
}

function getEditorGroupFromArguments(accessor: ServicesAccessor, args: unknown[]): IEditorGroup | undefined {
	const context = resolveCommandsContext(args, accessor.get(IEditorService), accessor.get(IEditorGroupsService), accessor.get(IListService));
	return context.groupedEditors[0]?.group;
}

/** Original PreferencesContribution registrations; the authenticated owner initializes lazily. */
export class SettingsOpenActions extends Disposable {
	constructor(open: (json: boolean, options: IOpenSettingsActionOptions) => Promise<unknown>) { super(); this.registerSettingsActions(open); }
	private registerSettingsActions(open: (json: boolean, options: IOpenSettingsActionOptions) => Promise<unknown>) {
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.openSettings',
					title: {
						...nls.localize2('settings', "Settings"),
						mnemonicTitle: nls.localize({ key: 'miOpenSettings', comment: ['&& denotes a mnemonic'] }, "&&Settings"),
					},
					keybinding: {
						weight: KeybindingWeight.WorkbenchContrib,
						when: null,
						primary: KeyMod.CtrlCmd | KeyCode.Comma,
					},
					menu: [{
						id: MenuId.GlobalActivity,
						group: '2_configuration',
						order: 2
					}, {
						id: MenuId.MenubarPreferencesMenu,
						group: '2_configuration',
						order: 2
					}],
				});
			}
			run(_accessor: ServicesAccessor, args: string | IOpenSettingsActionOptions) {
				// args takes a string for backcompat
				const opts = typeof args === 'string' ? { query: args } : sanitizeOpenSettingsArgs(args);
				return open(false, opts);
			}
		}));
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.openSettings2',
					title: nls.localize2('openSettings2', "Open Settings (UI)"),
					category,
					f1: true,
				});
			}
			run(_accessor: ServicesAccessor, args: IOpenSettingsActionOptions) {
				args = sanitizeOpenSettingsArgs(args);
				return open(false, args);
			}
		}));

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.openSettingsJson',
					title: nls.localize2('openSettingsJson', 'Open Settings (JSON)'),
					metadata: {
						description: nls.localize2('workbench.action.openSettingsJson.description', "Opens the JSON file containing the current user profile settings")
					},
					category,
					f1: true,
				});
			}
			run(_accessor: ServicesAccessor, args: IOpenSettingsActionOptions) {
				args = sanitizeOpenSettingsArgs(args);
				return open(true, args);
			}
		}));

	}
}
