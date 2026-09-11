import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize2 } from '../../../../base/common/vscodeNls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Action2, registerAction2, MenuId } from '../../../../platform/actions/common/actions.js';
import {
	ContextKeyExpr,
	type IContextKeyService,
	RawContextKey
} from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { EditorPartModalContext } from '../../../common/editorContextKeys.js';
import type { SettingsModal } from './settingsModal.js';

const visibleKey = new RawContextKey<boolean>('prctr.settings.visible', false);
const writableKey = new RawContextKey<boolean>('prctr.settings.writable', false);
const savingKey = new RawContextKey<boolean>('prctr.settings.saving', false);

/** Proctor's explicit commit actions use the source modal toolbar and keybinding owners. */
export class SettingsPersistenceActions extends Disposable {
	constructor(owner: SettingsModal, context: IContextKeyService) {
		super();
		const visible = visibleKey.bindTo(context),
			writable = writableKey.bindTo(context),
			saving = savingKey.bindTo(context);
		const update = (): void => {
			const session = owner.session;
			visible.set(!!session);
			writable.set(!!session && !session.isReadonly());
			saving.set(!!session?.isSaving());
		};
		this._register(owner.onDidChangeState(update));
		this._register({
			dispose: () => {
				visible.reset();
				writable.reset();
				saving.reset();
			}
		});
		update();
		this._register(
			registerAction2(
				class extends Action2 {
					constructor() {
						super({
							id: 'prctr.settings.save',
							title: localize2('settings.save', 'Save Settings'),
							icon: Codicon.save,
							precondition: ContextKeyExpr.and(
								visibleKey,
								writableKey,
								savingKey.toNegated()
							),
							menu: {
								id: MenuId.ModalEditorEditorTitle,
								when: visibleKey,
								group: 'navigation',
								order: 0
							},
							keybinding: {
								primary: KeyMod.CtrlCmd | KeyCode.KeyS,
								weight: KeybindingWeight.WorkbenchContrib,
								when: EditorPartModalContext
							}
						});
					}
					// Action2 declares a void return; the command runner consumes this promise.
					// eslint-disable-next-line @typescript-eslint/no-misused-promises
					async run(): Promise<void> {
						await owner.session?.save();
					}
				}
			)
		);
		this._register(
			registerAction2(
				class extends Action2 {
					constructor() {
						super({
							id: 'prctr.settings.discard',
							title: localize2('settings.discard', 'Discard Settings Changes'),
							icon: Codicon.discard,
							precondition: ContextKeyExpr.and(visibleKey, savingKey.toNegated()),
							menu: {
								id: MenuId.ModalEditorEditorTitle,
								when: visibleKey,
								group: 'navigation',
								order: 0.5
							}
						});
					}
					// Action2 declares a void return; the command runner consumes this promise.
					// eslint-disable-next-line @typescript-eslint/no-misused-promises
					async run(): Promise<void> {
						try {
							await owner.session?.revert();
						} catch {
							owner.session?.notifyDiscardFailure();
						}
					}
				}
			)
		);
	}
}
