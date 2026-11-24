import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { electronExecutable as preparedElectron } from '../../build/lib/electron.ts';
import { repositoryRoot } from '../../build/lib/paths.ts';
import test from 'node:test';

void test('sandboxed Chromium renderer runs deterministic browser fixtures', () => {
	const electronExecutable: unknown = preparedElectron();
	if (typeof electronExecutable !== 'string') {
		throw new TypeError('Electron package did not resolve to an executable path');
	}
	const output = execFileSync(electronExecutable, ['.build/browser-harness'], {
		encoding: 'utf8',
		cwd: repositoryRoot,
		timeout: 50_000
	}).trim();
	const result = JSON.parse(output) as {
		readonly chrome?: unknown;
		readonly electron?: unknown;
		readonly preferences?: unknown;
		readonly renderer?: unknown;
		readonly zoomFactor?: unknown;
	};
	assert.equal(result.electron, '44.11.3');
	assert.equal(result.chrome, '152.0.7977.169');
	assert.equal(result.zoomFactor, 2);
	assert.deepEqual(result.preferences, {
		contextIsolation: true,
		nodeIntegration: false,
		nodeIntegrationInSubFrames: false,
		nodeIntegrationInWorker: false,
		sandbox: true,
		webSecurity: true,
		webviewTag: false
	});
	assert.ok(typeof result.renderer === 'object' && result.renderer !== null);
	const { userAgent, ...renderer } = result.renderer as Record<string, unknown>;
	if (typeof userAgent !== 'string') {
		throw new TypeError('Renderer did not report a string user agent');
	}
	assert.match(userAgent, /\bChrome\/152\.0\.7977\.169\b/u);
	assert.match(userAgent, /\bElectron\/44\.11\.3\b/u);
	assert.deepEqual(renderer, {
		activations: '1',
		browserOwnerTests: '130',
		controlExplorer: '{"fixtures":7,"states":88,"interactions":91,"themes":4}',
		direction: 'rtl',
		fixture: 'browser-harness',
		hasNodeProcess: false,
		hasNodeRequire: false,
		heading: 'بيئة اختبار Proctor',
		locale: 'ar',
		motionDuration: '0ms',
		overlayBackdrop: '#ffffff',
		presentation: {
			density: 'compact',
			motion: 'reduced',
			theme: 'highContrastLight',
			themeContrast: 'high',
			transparency: 'reduced'
		},
		semanticIcons: [
			{
				ariaHidden: 'true',
				ariaLabel: null,
				fontFamily: 'prctr-codicon',
				id: 'action.settings',
				modifier: null,
				role: null,
				size: '16px'
			},
			{
				ariaHidden: null,
				ariaLabel: 'Loading examination workspace',
				fontFamily: 'prctr-codicon',
				id: 'state.loading',
				modifier: 'spin',
				role: 'img',
				size: '20px'
			}
		],
		ready: 'true',
		themeChanges: '1',
		workbenchKernelTests: '27'
	});
});
