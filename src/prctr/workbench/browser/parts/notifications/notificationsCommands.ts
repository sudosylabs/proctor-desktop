/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port workbench-notifications
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { KeyCode, KeyMod, KeyChord } from '../../../../base/common/keyCodes.js';
import {
	ContextKeyExpr,
	RawContextKey
} from '../../../../platform/contextkey/common/contextkey.js';
import type { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { registerProctorAction } from '../../../services/actions/common/proctorActions.js';
import { notificationMessages } from './notificationMessages.js';
import type { WorkbenchNotifications } from './notifications.js';

const notificationAvailable = new RawContextKey<boolean>('prctr.notifications.available', false);
const notificationFocused = new RawContextKey<boolean>('prctr.notifications.focused', false);
const notificationVisible = new RawContextKey<boolean>('prctr.notifications.visible', false);
export function registerNotificationCommands(
	notifications: WorkbenchNotifications,
	context: IContextKeyService,
	centerEnabled = true
): DisposableStore {
	const store = new DisposableStore();
	const available = notificationAvailable.bindTo(context),
		visible = notificationVisible.bindTo(context),
		focused = notificationFocused.bindTo(context);
	const update = (): void => {
		available.set(notifications.canInteract);
		visible.set(notifications.center.visible || notifications.toasts.visible);
		focused.set(
			notifications.element.contains(notifications.element.ownerDocument.activeElement)
		);
	};
	update();
	store.add(notifications.onDidChangeInteraction(update));
	store.add(addDisposableListener(notifications.element.ownerDocument, 'focusin', update, true));
	store.add(notifications.center.onDidChangeVisibility(update));
	store.add(notifications.toasts.onDidChangeVisibility(update));
	for (const action of [
		{
			id: 'prctr.notifications.show',
			title: notificationMessages.notifications,
			run: () => notifications.showCenter(),
			key: KeyChord(
				KeyMod.CtrlCmd | KeyCode.KeyK,
				KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyN
			)
		},
		{
			id: 'prctr.notifications.hide',
			title: notificationMessages.hide,
			run: () => notifications.hide(),
			key: undefined
		},
		{
			id: 'prctr.notifications.clearAll',
			title: notificationMessages.clearAll,
			run: () => notifications.clearAll(),
			key: undefined
		},
		{
			id: 'prctr.notifications.focus',
			title: notificationMessages.notifications,
			run: () => notifications.focus(),
			key: undefined
		},
		{
			id: 'prctr.notifications.read',
			title: notificationMessages.read,
			run: () => notifications.read(),
			key: KeyMod.Alt | KeyCode.F2
		}
	] as const)
		if (centerEnabled || action.id !== 'prctr.notifications.show') store.add(
			registerProctorAction({
				command: {
					id: action.id,
					title: action.title,
					precondition:
						action.id === 'prctr.notifications.read'
							? ContextKeyExpr.and(notificationAvailable, notificationFocused)
							: notificationAvailable
				},
				handler: () => action.run(),
				commandPalette: true,
				keybindings:
					action.key === undefined
						? []
						: [{ primary: action.key, weight: KeybindingWeight.WorkbenchContrib }]
			})
		);
	store.add(
		registerProctorAction({
			command: {
				id: 'prctr.notifications.hideToasts',
				title: notificationMessages.hide,
				precondition: notificationVisible
			},
			handler: () => notifications.hide(),
			keybindings: [
				{ primary: KeyCode.Escape, weight: KeybindingWeight.WorkbenchContrib - 50 }
			]
		})
	);
	store.add({
		dispose: () => {
			available.reset();
			visible.reset();
			focused.reset();
		}
	});
	return store;
}
