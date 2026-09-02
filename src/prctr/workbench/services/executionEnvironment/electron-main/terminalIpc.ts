/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron/main';
import {
	validateTerminalRendererIntent,
	validateTerminalRendererProjection
} from '../../../../platform/executionEnvironment/common/terminalRendererProtocol.js';
import { CANDIDATE_TERMINAL_CHANNELS } from '../../../../platform/windows/common/windowChannels.js';
import type { RemoteTerminal } from '../common/remoteTerminal.js';

interface Subscription {
	dispose(): void;
}
export type TerminalIpcModel = RemoteTerminal;
export class TerminalIpcBridge {
	readonly #ipcMain: IpcMain;
	readonly #candidateContents: WebContents;
	readonly #subscriptions: Subscription[];
	readonly #handled: string[];
	#disposed = false;
	constructor(ipcMain: IpcMain, candidateContents: WebContents, model: TerminalIpcModel) {
		this.#ipcMain = ipcMain;
		this.#candidateContents = candidateContents;
		const observation = model.observe();
		validateTerminalRendererProjection(observation.current);
		const handled: string[] = [];
		const subscriptions: Subscription[] = [];
		try {
			ipcMain.handle(CANDIDATE_TERMINAL_CHANNELS.projection, (event) => {
				this.#assertSender(event);
				return validateTerminalRendererProjection(model.observe().current);
			});
			handled.push(CANDIDATE_TERMINAL_CHANNELS.projection);
			ipcMain.handle(CANDIDATE_TERMINAL_CHANNELS.intent, async (event, raw: unknown) => {
				this.#assertSender(event);
				const intent = validateTerminalRendererIntent(raw);
				switch (intent.kind) {
					case 'terminal.open':
						await model.open(intent.dimensions, intent.requireCurrentWorkspace);
						break;
					case 'terminal.input':
						await model.input(intent.selector, intent.data);
						break;
					case 'terminal.resize':
						await model.resize(intent.selector, intent.dimensions);
						break;
					case 'terminal.ackOutput':
						await model.acknowledgeOutput(intent.selector, intent.sequence);
						break;
					case 'terminal.close':
						await model.close(intent.selector);
						break;
				}
			});
			handled.push(CANDIDATE_TERMINAL_CHANNELS.intent);
			subscriptions.push(
				observation.onDidChange((projection) => {
					if (!candidateContents.isDestroyed())
						candidateContents.send(
							CANDIDATE_TERMINAL_CHANNELS.changed,
							validateTerminalRendererProjection(projection)
						);
				})
			);
			subscriptions.push(
				observation.onDidOutput((output) => {
					if (!candidateContents.isDestroyed())
						candidateContents.send(CANDIDATE_TERMINAL_CHANNELS.output, {
							selector: output.selector,
							sequence: output.sequence,
							data: new Uint8Array(output.data)
						});
				})
			);
		} catch (error) {
			const cleanupErrors = rollbackIpc(ipcMain, handled, subscriptions);
			if (cleanupErrors.length > 0)
				throw new AggregateError(
					[error, ...cleanupErrors],
					'Terminal IPC registration and rollback failed'
				);
			throw error;
		}
		this.#handled = handled;
		this.#subscriptions = subscriptions;
	}
	#assertSender(event: IpcMainInvokeEvent): void {
		if (
			event.sender.id !== this.#candidateContents.id ||
			event.senderFrame !== this.#candidateContents.mainFrame
		)
			throw new Error('Terminal IPC sender is not the bound CandidateWindow');
	}
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		const errors = rollbackIpc(this.#ipcMain, this.#handled, this.#subscriptions);
		if (errors.length > 0) throw new AggregateError(errors, 'Terminal IPC disposal failed');
	}
}
function rollbackIpc(
	ipcMain: IpcMain,
	handled: readonly string[],
	subscriptions: readonly Subscription[]
): unknown[] {
	const errors: unknown[] = [];
	for (const subscription of [...subscriptions].reverse()) {
		try {
			subscription.dispose();
		} catch (error) {
			errors.push(error);
		}
	}
	for (const channel of [...handled].reverse()) {
		try {
			ipcMain.removeHandler(channel);
		} catch (error) {
			errors.push(error);
		}
	}
	return errors;
}
