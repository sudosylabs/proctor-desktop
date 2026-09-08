/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port workbench-notifications
import { Action, type IAction } from '../../../../base/common/actions.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import {
	Severity,
	type INotificationHandle,
	type INotificationService,
	type INotificationSource,
	type NotificationPriority
} from '../../../../platform/notification/common/notification.js';

export interface NotificationProgressOptions {
	readonly title?: string;
	readonly source?: string | INotificationSource;
	readonly delay?: number;
	readonly priority?: NotificationPriority;
	readonly cancellable?: boolean | string;
	readonly buttons?: readonly string[];
	readonly primaryActions?: readonly IAction[];
	readonly secondaryActions?: readonly IAction[];
}
export interface NotificationProgressStep {
	readonly message?: string;
	readonly increment?: number;
}
export class NotificationProgressService extends Disposable {
	readonly #operations = new Set<DisposableStore>();
	#disposed = false;
	constructor(
		private readonly notifications: INotificationService,
		private readonly cancelLabel: string
	) {
		super();
	}
	withProgress<T>(
		options: NotificationProgressOptions,
		task: (progress: { report(step: NotificationProgressStep): void }) => Promise<T>,
		onCancel?: (choice?: number) => void
	): Promise<T> {
		if (this.#disposed) throw new Error('Notification progress service is disposed');
		const store = new DisposableStore();
		this.#operations.add(store);
		let handle: INotificationHandle | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let closed = false;
		let message = options.title ?? '';
		let worked: number | undefined;
		const finish = (): void => {
			if (closed) return;
			closed = true;
			if (timer !== undefined) clearTimeout(timer);
			handle?.close();
			store.dispose();
			this.#operations.delete(store);
		};
		store.add({
			dispose: () => {
				closed = true;
				if (timer !== undefined) clearTimeout(timer);
				handle?.close();
			}
		});
		const cancel = (choice?: number): void => {
			try {
				onCancel?.(choice);
			} finally {
				finish();
			}
		};
		const show = (): void => {
			timer = undefined;
			if (closed || !message) return;
			const primary = [...(options.primaryActions ?? [])];
			for (const [index, label] of (options.buttons ?? []).entries())
				primary.push(
					store.add(
						new Action(
							`prctr.notification.progress.choice.${index}`,
							label,
							undefined,
							true,
							async () => cancel(index)
						)
					)
				);
			if (options.cancellable)
				primary.push(
					store.add(
						new Action(
							'prctr.notification.progress.cancel',
							typeof options.cancellable === 'string'
								? options.cancellable
								: this.cancelLabel,
							undefined,
							true,
							async () => cancel()
						)
					)
				);
			handle = this.notifications.notify({
				severity: Severity.Info,
				message,
				source: options.source,
				priority: options.priority,
				actions: { primary, secondary: [...(options.secondaryActions ?? [])] },
				progress: worked === undefined ? { infinite: true } : { total: 100, worked }
			});
		};
		const report = (step: NotificationProgressStep): void => {
			if (closed) return;
			if (step.message)
				message = options.title ? `${options.title}: ${step.message}` : step.message;
			if (
				typeof step.increment === 'number' &&
				Number.isFinite(step.increment) &&
				step.increment >= 0
			)
				worked = (worked ?? 0) + step.increment;
			if (handle) {
				handle.updateMessage(message);
				if (worked !== undefined) {
					handle.progress.total(100);
					if (step.increment !== undefined) handle.progress.worked(step.increment);
				}
			} else if (message && timer === undefined) {
				if ((options.delay ?? 0) > 0) timer = setTimeout(show, options.delay);
				else show();
			}
		};
		report({});
		let result: Promise<T>;
		try {
			result = task({ report });
		} catch (error) {
			finish();
			throw error;
		}
		const minimum =
			(options.delay ?? 0) > 0
				? Promise.resolve()
				: new Promise<void>((resolve) => {
						const id = setTimeout(resolve, 800);
						store.add({
							dispose: () => {
								clearTimeout(id);
								resolve();
							}
						});
					});
		void Promise.allSettled([result, minimum]).then(finish);
		return result;
	}
	override dispose(): void {
		this.#disposed = true;
		for (const store of this.#operations) store.dispose();
		this.#operations.clear();
		super.dispose();
	}
}
