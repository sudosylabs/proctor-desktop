import assert from 'node:assert';
import { suite, test } from '../../../../base/common/upstream/testAdapter.ts';
import { NotificationService } from '../../../../../src/prctr/workbench/services/notification/common/notificationService.ts';
import { NotificationStorage } from '../../../../../src/prctr/workbench/services/notification/common/notificationStorage.ts';
import { NotificationProgressService } from '../../../../../src/prctr/workbench/services/notification/common/notificationProgress.ts';
import {
	Severity,
	NotificationPriority,
	NotificationsFilter
} from '../../../../../src/prctr/platform/notification/common/notification.ts';

suite('Notification service boundary', () => {
	test('filters retain notifications and urgent messages bypass ordinary suppression', () => {
		const service = new NotificationService(new NotificationStorage());
		try {
			service.setFilter(NotificationsFilter.ERROR);
			service.notify({ message: 'Quiet', severity: Severity.Info });
			service.notify({
				message: 'Urgent',
				severity: Severity.Info,
				priority: NotificationPriority.URGENT
			});
			service.error('Error');
			assert.equal(service.model.notifications.length, 3);
			assert.equal(service.model.notifications[2].priority, NotificationPriority.SILENT);
			assert.equal(service.model.notifications[1].priority, NotificationPriority.URGENT);
		} finally {
			service.dispose();
		}
	});
	test('prompt keepOpen and onCancel preserve distinct outcomes', async () => {
		const service = new NotificationService(new NotificationStorage());
		try {
			let calls = 0,
				cancelled = 0;
			const handle = service.prompt(
				Severity.Info,
				'Choose',
				[{ label: 'Again', keepOpen: true, run: () => calls++ }],
				{ onCancel: () => cancelled++ }
			);
			await service.model.notifications[0].actions!.primary![0].run();
			assert.equal(service.model.notifications.length, 1);
			handle.close();
			assert.equal(calls, 1);
			assert.equal(cancelled, 0);
			service
				.prompt(Severity.Info, 'Dismiss', [{ label: 'Choose', run: () => {} }], {
					onCancel: () => cancelled++
				})
				.close();
			assert.equal(cancelled, 1);
		} finally {
			service.dispose();
		}
	});
	test('suppression persists and does not mutate caller-owned actions', async () => {
		const storage = new NotificationStorage();
		const service = new NotificationService(storage);
		try {
			const notification = {
				severity: Severity.Info,
				message: 'Tip',
				neverShowAgain: { id: 'prctr.tip' }
			};
			service.notify(notification);
			await service.model.notifications[0].actions!.primary![0].run();
			assert.equal(service.model.notifications.length, 0);
			service.notify(notification);
			assert.equal(service.model.notifications.length, 0);
			assert.equal('actions' in notification, false);
		} finally {
			service.dispose();
		}
	});
	test('fast delayed progress does not flash a notification', async () => {
		const service = new NotificationService(new NotificationStorage());
		const progress = new NotificationProgressService(service, 'Cancel');
		try {
			await progress.withProgress({ title: 'Fast', delay: 50 }, async (reporter) => {
				reporter.report({ increment: 25 });
			});
			await new Promise((resolve) => setTimeout(resolve, 0));
			assert.equal(service.model.notifications.length, 0);
		} finally {
			progress.dispose();
			service.dispose();
		}
	});
	test('cancellable progress invokes the operation owner and closes presentation', async () => {
		const service = new NotificationService(new NotificationStorage());
		const progress = new NotificationProgressService(service, 'Cancel');
		try {
			let cancel = 0;
			let finish!: () => void;
			const pending = progress.withProgress(
				{ title: 'Running', cancellable: true },
				() => new Promise<void>((resolve) => (finish = resolve)),
				() => cancel++
			);
			assert.equal(service.model.notifications[0].hasActiveProgress, true);
			await service.model.notifications[0].actions!.primary![0].run();
			assert.equal(cancel, 1);
			assert.equal(service.model.notifications.length, 0);
			finish();
			await pending;
		} finally {
			progress.dispose();
			service.dispose();
		}
	});
	test('service disposal closes all owned handles', () => {
		const service = new NotificationService(new NotificationStorage());
		let closed = 0;
		service
			.notify({ message: 'Working', severity: Severity.Info, progress: { infinite: true } })
			.onDidClose(() => closed++);
		service.dispose();
		assert.equal(closed, 1);
		assert.equal(service.model.notifications.length, 0);
	});
});
