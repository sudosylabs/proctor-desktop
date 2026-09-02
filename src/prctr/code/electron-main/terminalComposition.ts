import type { IpcMain, WebContents } from 'electron/main';
import { createRemoteTerminal } from '../../workbench/services/executionEnvironment/common/remoteTerminalModel.js';
import type { RemoteTerminalOptions } from '../../workbench/services/executionEnvironment/common/remoteTerminal.js';
import { TerminalIpcBridge } from '../../workbench/services/executionEnvironment/electron-main/terminalIpc.js';

export interface TerminalCompositionOptions extends RemoteTerminalOptions { readonly ipcMain: IpcMain; readonly candidateContents: WebContents }

/** CandidateWindow composition root. The authenticated server transport supplies the bound ports. */
export function createTerminalComposition(options: TerminalCompositionOptions) {
	const model = createRemoteTerminal(options); let ipc: TerminalIpcBridge;
	try { ipc = new TerminalIpcBridge(options.ipcMain, options.candidateContents, model); }
	catch (error) { try { model.dispose(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Terminal composition and rollback failed'); } throw error; }
	return Object.freeze({ model, dispose(): void { const errors: unknown[] = []; try { ipc.dispose(); } catch (error) { errors.push(error); } try { model.dispose(); } catch (error) { errors.push(error); } if (errors.length > 0) throw new AggregateError(errors, 'Terminal composition disposal failed'); } });
}
