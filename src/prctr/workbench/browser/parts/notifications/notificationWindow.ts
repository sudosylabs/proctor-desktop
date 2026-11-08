import type { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import type { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import type { NotificationPreferenceBinding } from '../../../services/notification/browser/notificationPreferenceStore.js';
import {
	CandidateInteractionAllowedContext,
	WorkbenchWindowKindContext
} from '../../../common/contextKeys.js';
import { IWorkbenchShellService, IWorkbenchWindowService } from '../../workbenchServices.js';
import { createWindowNotifications } from './notificationComposition.js';
import type { WorkbenchNotifications } from './notifications.js';
import { registerNotificationCommands } from './notificationsCommands.js';

/** Creates the window's notifications in its overlay host and registers their commands. */
export function installWorkbenchNotifications(
	accessor: ServicesAccessor,
	binding: NotificationPreferenceBinding,
	disposables: DisposableStore
): WorkbenchNotifications {
	const keys = accessor.get(IContextKeyService);
	const shell = accessor.get(IWorkbenchShellService);
	const { document, composition } = accessor.get(IWorkbenchWindowService);
	const changed = disposables.add(new Emitter<void>());
	disposables.add(shell.overlayHost.onDidChangeVisibility(() => changed.fire()));
	disposables.add(
		keys.onDidChangeContext((event) => {
			if (event.affectsSome(new Set([CandidateInteractionAllowedContext.key]))) {
				changed.fire();
			}
		})
	);
	const status = composition.layout.parts.includes('status') ? shell.part('status') : undefined;
	const notifications = createWindowNotifications(
		document,
		shell.overlayHost.notificationLayer,
		status,
		shell.part('titlebar'),
		status,
		binding,
		() =>
			!shell.overlayHost.visible &&
			(keys.getContextKeyValue(WorkbenchWindowKindContext.key) !== 'candidate' ||
				keys.getContextKeyValue(CandidateInteractionAllowedContext.key) === true),
		changed.event,
		() => shell.part('content').focus()
	);
	disposables.add(notifications);
	disposables.add(
		registerNotificationCommands(
			notifications,
			keys,
			composition.windowKind !== 'authenticated'
		)
	);
	disposables.add({
		dispose: () => shell.overlayHost.notificationLayer.replaceChildren()
	});
	return notifications;
}
