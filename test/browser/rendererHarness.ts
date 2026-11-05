import { runExamActivityTests } from './examActivityTests.js';
import { createLocalization, defineMessage } from '../../src/prctr/base/common/localization.js';
import { Emitter } from '../../src/prctr/base/common/event.js';
import { DisposableStore } from '../../src/prctr/base/common/lifecycle.js';
import { createSemanticIcon } from '../../src/prctr/platform/theme/browser/semanticIcon.js';
import { BrowserThemeService } from '../../src/prctr/platform/theme/browser/themeService.js';
import { runBrowserInteractionOwnerTests } from './upstream/browserOwnerTests.ts';
import { runControlExplorer } from './controlExplorer/controlExplorer.ts';
import { runWorkbenchKernelBrowserTests } from './workbenchKernelTests.ts';
import { runBrowserKeybindingServiceTests } from './browserKeybindingServiceTests.ts';

const parameters = new URL(globalThis.location.href).searchParams;
const disposables = new DisposableStore();
const themeService = disposables.add(
	new BrowserThemeService(document, 'dark', {
		density: 'compact',
		motion: 'reduced',
		transparency: 'reduced'
	})
);
let themeChanges = 0;
disposables.add(themeService.onDidChangeTheme(() => themeChanges++));
themeService.setTheme('highContrastLight');
const activationEmitter = disposables.add(new Emitter<number>());
const locale = parameters.get('locale') ?? 'en';
const headingMessage = defineMessage({
	id: 'test.browser.harness.heading',
	defaultMessage: '{product} browser harness',
	description: 'Heading for the real Chromium browser test harness.'
});
const localization = createLocalization({
	requestedLocale: locale,
	messages: [headingMessage],
	catalogs: [
		{
			locale: 'ar',
			direction: 'rtl',
			messages: { 'test.browser.harness.heading': 'بيئة اختبار {product}' }
		}
	]
});

document.documentElement.lang = localization.locale;
document.documentElement.dir = localization.direction;

const main = document.createElement('main');
main.dataset.fixture = 'browser-harness';

const heading = document.createElement('h1');
heading.textContent = localization.format(headingMessage, { product: 'Proctor' });

const button = document.createElement('button');
button.type = 'button';
button.textContent = 'Exercise browser event';
button.dataset.activations = '0';
disposables.add(
	activationEmitter.event((activations) => {
		button.dataset.activations = String(activations);
	})
);
button.addEventListener('click', () => {
	const activations = Number(button.dataset.activations ?? '0');
	activationEmitter.fire(activations + 1);
});
const decorativeIcon = disposables.add(
	createSemanticIcon(document, {
		id: 'action.settings'
	})
);
const labelledIcon = disposables.add(
	createSemanticIcon(document, {
		accessibleLabel: 'Loading examination workspace',
		id: 'state.loading',
		modifier: 'spin',
		size: 20
	})
);
globalThis.addEventListener('pagehide', () => disposables.dispose(), { once: true });

main.append(heading, button, decorativeIcon.element, labelledIcon.element);
document.body.append(main);
await document.fonts.ready;
const failures: string[] = [];
async function runGroup(name: string, run: () => Promise<void>): Promise<void> {
	document.body.dataset.currentSuite = name;
	try {
		await run();
	} catch (error) {
		failures.push(
			name + ': ' + (error instanceof Error ? (error.stack ?? error.message) : String(error))
		);
	}
}
await runGroup('exam-activity', runExamActivityTests);
await runGroup('browser-owner', async () => {
	document.body.dataset.browserOwnerTests = String(await runBrowserInteractionOwnerTests());
});
await runGroup('control-explorer', async () => {
	document.body.dataset.controlExplorer = JSON.stringify(await runControlExplorer(document.body));
});
await runGroup('workbench-kernel', async () => {
	document.body.dataset.workbenchKernelTests = String(
		await runWorkbenchKernelBrowserTests(document)
	);
});
await runGroup('keybindings', async () => {
	await runBrowserKeybindingServiceTests(document);
});
if (failures.length) document.body.dataset.browserOwnerError = failures.join('\n');
delete document.body.dataset.currentSuite;
document.body.dataset.themeChanges = String(themeChanges);
document.body.dataset.ready = 'true';
