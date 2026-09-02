import type { IpcMain, WebContents } from 'electron/main';
import {
	ExamSecurityIpcBridge,
	type ExamSecurityIpcModel
} from '../../workbench/services/examSecurity/electron-main/examSecurityIpc.js';

/** Electron main exposes only the fail-closed sanitized projection supplied by the utility-owned coordinator. */
export function createExamSecurityProjectionComposition(
	ipcMain: IpcMain,
	candidateContents: WebContents,
	model: ExamSecurityIpcModel
): ExamSecurityIpcBridge {
	return new ExamSecurityIpcBridge(ipcMain, candidateContents, model);
}
