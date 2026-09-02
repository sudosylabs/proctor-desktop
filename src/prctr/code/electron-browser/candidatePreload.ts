import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { validateTerminalRendererOutput, validateTerminalRendererProjection, type TerminalRendererIntent, type TerminalRendererOutput, type TerminalRendererProjection } from '../../platform/executionEnvironment/common/terminalRendererProtocol.js';
import { validateIntegratedBrowserProjection, validateIntegratedBrowserSurface, type IntegratedBrowserIntent, type IntegratedBrowserProjection, type IntegratedBrowserSurface } from '../../platform/integratedBrowser/common/browserProtocol.js';
import { CANDIDATE_BROWSER_CHANNELS, CANDIDATE_SECURITY_CHANNELS, CANDIDATE_TERMINAL_CHANNELS, WINDOW_CHANNELS } from '../../platform/windows/common/windowChannels.js';
import { validateWindowDescriptor, type CandidateWindowDescriptor } from '../../platform/windows/common/windowProtocol.js';
import { validateCandidateSecurityProjection, type CandidateSecurityIntent, type CandidateSecurityProjection } from '../../workbench/services/examSecurity/common/securityProjectionProtocol.js';

contextBridge.exposeInMainWorld('proctorCandidate', Object.freeze({
  bootstrap: async (): Promise<CandidateWindowDescriptor> => { const descriptor = validateWindowDescriptor(await ipcRenderer.invoke(WINDOW_CHANNELS.candidate.bootstrap)); if (descriptor.kind !== 'candidate') throw new TypeError('Candidate bootstrap returned the wrong window kind'); return descriptor; },
  requestDeparture: (): Promise<void> => ipcRenderer.invoke(WINDOW_CHANNELS.candidate.intent, { kind: 'candidate.requestDeparture' }),
  security: Object.freeze({
    projection: async (): Promise<CandidateSecurityProjection> => validateCandidateSecurityProjection(await ipcRenderer.invoke(CANDIDATE_SECURITY_CHANNELS.projection)),
    intent: (intent: CandidateSecurityIntent): Promise<void> => ipcRenderer.invoke(CANDIDATE_SECURITY_CHANNELS.intent, intent),
    onDidChange: (listener: (projection: CandidateSecurityProjection) => void): (() => void) => { const handler = (_event: IpcRendererEvent, value: unknown): void => listener(validateCandidateSecurityProjection(value)); ipcRenderer.on(CANDIDATE_SECURITY_CHANNELS.changed, handler); return () => ipcRenderer.off(CANDIDATE_SECURITY_CHANNELS.changed, handler); }
  }),
  browser: Object.freeze({
    projection: async (): Promise<IntegratedBrowserProjection> => validateIntegratedBrowserProjection(await ipcRenderer.invoke(CANDIDATE_BROWSER_CHANNELS.projection)),
    intent: (intent: IntegratedBrowserIntent): Promise<void> => ipcRenderer.invoke(CANDIDATE_BROWSER_CHANNELS.intent, intent),
    surface: (surface: IntegratedBrowserSurface): Promise<void> => ipcRenderer.invoke(CANDIDATE_BROWSER_CHANNELS.surface, validateIntegratedBrowserSurface(surface)),
    surfaceFocus: async (): Promise<boolean> => { const focused: unknown = await ipcRenderer.invoke(CANDIDATE_BROWSER_CHANNELS.surfaceFocus); if (typeof focused !== 'boolean') throw new TypeError('Integrated browser surface focus is invalid'); return focused; },
    onDidChange: (listener: (projection: IntegratedBrowserProjection) => void): (() => void) => { const handler = (_event: IpcRendererEvent, value: unknown): void => listener(validateIntegratedBrowserProjection(value)); ipcRenderer.on(CANDIDATE_BROWSER_CHANNELS.changed, handler); return () => ipcRenderer.off(CANDIDATE_BROWSER_CHANNELS.changed, handler); },
    onDidChangeSurfaceFocus: (listener: (focused: boolean) => void): (() => void) => { const handler = (_event: IpcRendererEvent, value: unknown): void => { if (typeof value !== 'boolean') throw new TypeError('Integrated browser surface focus event is invalid'); listener(value); }; ipcRenderer.on(CANDIDATE_BROWSER_CHANNELS.surfaceFocusChanged, handler); return () => ipcRenderer.off(CANDIDATE_BROWSER_CHANNELS.surfaceFocusChanged, handler); }
  }),
  terminal: Object.freeze({
    projection: async (): Promise<TerminalRendererProjection> => validateTerminalRendererProjection(await ipcRenderer.invoke(CANDIDATE_TERMINAL_CHANNELS.projection)),
    intent: (intent: TerminalRendererIntent): Promise<void> => ipcRenderer.invoke(CANDIDATE_TERMINAL_CHANNELS.intent, intent),
    onDidChange: (listener: (projection: TerminalRendererProjection) => void): (() => void) => { const handler = (_event: IpcRendererEvent, value: unknown): void => listener(validateTerminalRendererProjection(value)); ipcRenderer.on(CANDIDATE_TERMINAL_CHANNELS.changed, handler); return () => ipcRenderer.off(CANDIDATE_TERMINAL_CHANNELS.changed, handler); },
    onDidOutput: (listener: (output: TerminalRendererOutput) => void): (() => void) => { const handler = (_event: IpcRendererEvent, value: unknown): void => listener(validateTerminalRendererOutput(value)); ipcRenderer.on(CANDIDATE_TERMINAL_CHANNELS.output, handler); return () => ipcRenderer.off(CANDIDATE_TERMINAL_CHANNELS.output, handler); }
  })
}));
