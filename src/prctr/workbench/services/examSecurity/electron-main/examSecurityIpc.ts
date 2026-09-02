/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron/main';
import { CANDIDATE_SECURITY_CHANNELS } from '../../../../platform/windows/common/windowChannels.js';
import { validateCandidateSecurityIntentForProjection, validateCandidateSecurityProjection, type CandidateSecurityIntent, type CandidateSecurityProjection } from '../common/securityProjectionProtocol.js';

interface Subscription { dispose(): void }
export interface ExamSecurityIpcModel { observe(): { readonly current: CandidateSecurityProjection; readonly onDidChange: (listener: (projection: CandidateSecurityProjection) => void) => Subscription }; handleIntent(intent: CandidateSecurityIntent): Promise<void> }
export class ExamSecurityIpcBridge {
	readonly #ipcMain: IpcMain;
	readonly #subscription: Subscription;
	readonly #handled: string[];
	#disposed = false;
	constructor(ipcMain: IpcMain, candidateContents: WebContents, model: ExamSecurityIpcModel) {
		this.#ipcMain = ipcMain;
		const observation = model.observe(); validateCandidateSecurityProjection(observation.current); const handled: string[] = []; let subscription: Subscription | undefined;
		try {
			ipcMain.handle(CANDIDATE_SECURITY_CHANNELS.projection, event => { assertSender(event, candidateContents); return validateCandidateSecurityProjection(model.observe().current); }); handled.push(CANDIDATE_SECURITY_CHANNELS.projection);
			ipcMain.handle(CANDIDATE_SECURITY_CHANNELS.intent, async (event, value: unknown) => { assertSender(event, candidateContents); const current = validateCandidateSecurityProjection(model.observe().current); await model.handleIntent(validateCandidateSecurityIntentForProjection(value, current)); }); handled.push(CANDIDATE_SECURITY_CHANNELS.intent);
			subscription = observation.onDidChange(projection => { if (!candidateContents.isDestroyed()) candidateContents.send(CANDIDATE_SECURITY_CHANNELS.changed, validateCandidateSecurityProjection(projection)); });
		} catch (error) { const cleanupErrors = rollbackSecurityIpc(ipcMain, handled, subscription); if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors], 'Exam Security IPC registration and rollback failed'); throw error; }
		this.#handled = handled; this.#subscription = subscription;
	}
	dispose(): void { if (this.#disposed) return; this.#disposed = true; const errors = rollbackSecurityIpc(this.#ipcMain, this.#handled, this.#subscription); if (errors.length > 0) throw new AggregateError(errors, 'Exam Security IPC disposal failed'); }
}
function assertSender(event: IpcMainInvokeEvent, contents: WebContents): void { if (event.sender.id !== contents.id || event.senderFrame !== contents.mainFrame) throw new Error('Exam Security IPC sender is not the bound CandidateWindow'); }
function rollbackSecurityIpc(ipcMain: IpcMain, handled: readonly string[], subscription: Subscription | undefined): unknown[] { const errors: unknown[] = []; if (subscription !== undefined) { try { subscription.dispose(); } catch (error) { errors.push(error); } } for (const channel of [...handled].reverse()) { try { ipcMain.removeHandler(channel); } catch (error) { errors.push(error); } } return errors; }
