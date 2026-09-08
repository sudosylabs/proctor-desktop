import type { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import type { NotificationPreferenceBinding } from '../../../services/notification/browser/notificationPreferenceStore.js';
import { createWindowNotifications } from './notificationComposition.js';
import {
	CandidateInteractionAllowedContext,
	WorkbenchWindowKindContext
} from '../../../common/contextKeys.js';
import { Emitter } from '../../../../base/common/event.js';
import { WORKBENCH_CONTEXT_KEY_SERVICE } from '../../../common/serviceIds.js';
import {
	WorkbenchNotifications,
	WORKBENCH_NOTIFICATION_SERVICE,
	WORKBENCH_NOTIFICATION_PROGRESS_SERVICE
} from './notifications.js';
import { registerNotificationCommands } from './notificationsCommands.js';
import type { WorkbenchBootstrapContext } from '../../bootstrap.js';

export function installWorkbenchNotifications(
	context: WorkbenchBootstrapContext,
	binding: NotificationPreferenceBinding
): WorkbenchNotifications {
	const keys = context.getService<IContextKeyService>(WORKBENCH_CONTEXT_KEY_SERVICE);
	const changed = context.disposables.add(new Emitter<void>());
	context.disposables.add(context.shell.overlayHost.onDidChangeVisibility(() => changed.fire()));
	context.disposables.add(
		keys.onDidChangeContext((event) => {
			if (event.affectsSome(new Set([CandidateInteractionAllowedContext.key])))
				changed.fire();
		})
	);
	const notifications = createWindowNotifications(
		context.document,
		context.shell.overlayHost.notificationLayer,
		context.shell.part('status'),
		context.shell.part('titlebar'),
		context.shell.part('status'),
		binding,
		() =>
			!context.shell.overlayHost.visible &&
			(keys.getContextKeyValue(WorkbenchWindowKindContext.key) !== 'candidate' ||
				keys.getContextKeyValue(CandidateInteractionAllowedContext.key) === true),
		changed.event,
		() => context.shell.part('content').focus()
	);
	context.disposables.add(notifications);
	context.setService(WORKBENCH_NOTIFICATION_SERVICE, notifications.service);
	context.setService(WORKBENCH_NOTIFICATION_PROGRESS_SERVICE, notifications.progress);
	context.disposables.add(registerNotificationCommands(notifications, keys));
	context.disposables.add({
		dispose: () => context.shell.overlayHost.notificationLayer.replaceChildren()
	});
	return notifications;
}
