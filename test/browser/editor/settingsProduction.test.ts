import { bootstrapWorkbench } from '../../../src/prctr/workbench/browser/bootstrap.js';
import { authenticatedComposition } from '../../../src/prctr/workbench/browser/authenticatedManifest.js';
import { commonWorkbenchContributions } from '../../../src/prctr/workbench/workbench.common.main.js';
import { createDesktopWorkbenchContribution } from '../../../src/prctr/code/electron-browser/workbench.desktop.main.js';
import { createAuthenticatedContribution } from '../../../src/prctr/workbench/contrib/authenticated/browser/authenticatedContribution.js';
import { createAccountContribution } from '../../../src/prctr/workbench/contrib/account/browser/accountContribution.js';
import { createSettingsContribution } from '../../../src/prctr/workbench/contrib/settings/browser/settingsContribution.js';
import { browserSettingsEditorEnvironment } from './settingsEditorEnvironment.js';
import { Emitter } from '../../../src/prctr/base/common/event.js';
import type { UserSettingsProjection } from '../../../src/prctr/platform/settings/common/settingsRendererProtocol.js';
import type { ICommandService } from '../../../src/prctr/platform/commands/common/commands.js';
import { WORKBENCH_COMMAND_SERVICE } from '../../../src/prctr/workbench/common/serviceIds.js';
import { isMacintosh } from '../../../src/prctr/base/common/platform.js';

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function eventually(predicate: () => boolean, message: string): Promise<void> {
	const deadline = performance.now() + 4000;
	while (!predicate()) { if (performance.now() > deadline) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 10)); }
}

/** The actual authenticated contribution, not a replacement editor host or a form mock. */
export async function exerciseSettingsProduction(): Promise<void> {
	const events = new Emitter<UserSettingsProjection>();
	let acknowledged: UserSettingsProjection = { source: '{"editor.fontSize":18}', revision: 'r1', registryVersion: 1, writable: true, availability: 'available', presentation: { theme: 'dark', zoomPercent: 100, reducedMotion: false } };
	let writes = 0;
	let commands: ICommandService | undefined;
	const contribution = createSettingsContribution({
		async projection() { return acknowledged; },
		onDidChange(listener) { const disposable = events.event(listener); return () => disposable.dispose(); },
		async preview() { events.fire(acknowledged); }, async cancelPreview() { events.fire(acknowledged); },
		async commit(intent) { writes++; acknowledged = { ...acknowledged, source: intent.source, revision: `r${writes + 1}` }; events.fire(acknowledged); return { kind: 'success', projection: acknowledged }; }
	}, browserSettingsEditorEnvironment);
	const result = await bootstrapWorkbench(document, authenticatedComposition, [
		...commonWorkbenchContributions,
		createDesktopWorkbenchContribution('authenticated', async () => ({ protocolVersion: 1, kind: 'authenticated', windowId: 'window:settings', institutionOrigin: 'https://institution.example.test', principalId: 'principal:one', sessionId: 'session:one', initialDestination: 'settings' }), {
			async configuration() { return { protocolVersion: 1, platform: isMacintosh ? 'darwin' : 'linux', mode: isMacintosh ? 'nativeTrafficLights' : 'nativeOverlay', controlsLocation: isMacintosh ? 'left' : 'right', titlebarHeight: 35, fullscreen: false }; },
			onDidChangeFullscreen() { return { dispose() {} }; }, zoomFactor() { return 1; }, async update() {}
		}),
		createAuthenticatedContribution({ async signOut() {}, async close() {} }, true),
		createAccountContribution({ async request() { return { kind: 'error', reason: 'unavailable' }; } }),
		{ ...contribution, async activate(context) { commands = context.getService<ICommandService>(WORKBENCH_COMMAND_SERVICE); await contribution.activate(context); } }
	]);
	try {
		await eventually(() => !!document.querySelector('.settings-editor'), 'Production Settings did not open its source graphical editor.');
		check(result.shell.overlayHost.visible, 'Settings did not enter the window modal gate.');
		check(result.shell.part('content').inert, 'The background remained interactive.');
		check(!result.shell.part('content').querySelector('.prctr-settings textarea'), 'Production still mounted the legacy Settings form.');
		await eventually(() => !!document.querySelector('[data-key="editor.fontSize"] input'), 'Production Settings omitted its catalog control.');
		const themeRow = document.querySelector('[data-key="workbench.colorTheme"]')!;
		check(!themeRow.querySelector('select') && themeRow.textContent?.includes('Edit in settings.json'), 'Theme selection did not retain its JSON-only product workflow.');
		const saveIcon = document.querySelector('.modal-editor-part .codicon-save')!;
		await eventually(() => !!saveIcon && !['none', 'normal', ''].includes(getComputedStyle(saveIcon, '::before').content), 'The modal toolbar did not load its registered icon glyphs.');
		const input = document.querySelector<HTMLInputElement>('[data-key="editor.fontSize"] input')!;
		input.value = '21'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
		await commands!.executeCommand('prctr.settings.discard');
		check(writes === 0, 'Discard persisted a control edit.');
		const restoredInput = document.querySelector<HTMLInputElement>('[data-key="editor.fontSize"] input')!;
		restoredInput.value = '20'; restoredInput.dispatchEvent(new window.Event('input', { bubbles: true }));
		await commands!.executeCommand('prctr.settings.save');
		check(Number(writes) === 1 && acknowledged.source.includes('20'), 'Production Save lost a pending graphical edit.');
		await commands!.executeCommand('workbench.action.closeModalEditor');
		await eventually(() => !document.querySelector('.modal-editor-part'), 'Production Settings did not close its modal.');
		check(!result.shell.overlayHost.visible && !result.shell.part('content').inert, 'Closing Settings did not release background gating.');
		const trigger = result.shell.part('titlebar').querySelector<HTMLButtonElement>('[data-region=trigger]')!;
		trigger.focus();
		await commands!.executeCommand('workbench.action.openSettingsJson', { revealSetting: { key: 'editor.fontSize', edit: false } });
		check(!!document.querySelector('.modal-editor-part .monaco-editor'), 'The Settings JSON entrypoint did not open the source editor.');
		await commands!.executeCommand('workbench.action.closeModalEditor');
		await eventually(() => !document.querySelector('.modal-editor-part'), 'The JSON modal did not close.');
		check(document.activeElement === trigger, 'Closing the source modal did not restore its background trigger focus.');
		trigger.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', keyCode: 188, ctrlKey: !isMacintosh, metaKey: isMacintosh, bubbles: true, cancelable: true }));
		await eventually(() => !!document.querySelector('.settings-editor'), 'The platform Settings shortcut did not open the graphical editor.');
		await commands!.executeCommand('workbench.action.closeModalEditor');
	} finally { result.disposables.dispose(); events.dispose(); }
}
