export interface TestSuite {
	readonly patterns: readonly string[];
	readonly build?: string;
	readonly output?: string;
	readonly runtime: 'node' | 'electron';
}

export const testSuites = {
	checks: { patterns: ['test/checks/**/*.test.ts'], runtime: 'node' },
	base: {
		patterns: ['test/base/common/**/*.test.ts'],
		build: 'build/buildBaseCommonTests.ts',
		output: '.build/base-common-tests/**/*.test.js',
		runtime: 'node'
	},
	platform: {
		patterns: ['test/platform/**/*.test.ts', 'test/workbench/**/*.test.ts'],
		build: 'build/buildPlatformFoundationTests.ts',
		output: '.build/platform-foundation-tests/**/*.test.js',
		runtime: 'node'
	},
	editor: {
		patterns: ['test/editor/**/*.test.ts'],
		build: 'build/buildEditorCoreTests.ts',
		output: '.build/editor-core-tests/**/*.test.js',
		runtime: 'node'
	},
	'security-utility': {
		patterns: ['test/security-utility/**/*.test.ts'],
		build: 'build/buildSecurityUtilityTests.ts',
		output: '.build/security-utility-tests/**/*.test.js',
		runtime: 'node'
	},
	'native-agent': {
		patterns: ['test/native-agent/**/*.test.ts'],
		build: 'build/buildNativeAgentTests.ts',
		output: '.build/native-agent-tests/**/*.test.js',
		runtime: 'node'
	},
	browser: {
		patterns: ['test/electron/browserHarness.real.test.ts'],
		build: 'build/buildBrowserHarness.ts',
		runtime: 'electron'
	},
	'window-skeleton': {
		patterns: ['test/electron/windowSkeleton.real.test.ts'],
		build: 'build/buildWindowSkeleton.ts',
		runtime: 'electron'
	},
	'integrated-browser': {
		patterns: ['test/electron/integratedBrowser.real.test.ts'],
		build: 'build/buildIntegratedBrowserTests.ts',
		runtime: 'electron'
	},
	'resource-preview': {
		patterns: ['test/electron/resourcePreview.real.test.ts'],
		build: 'build/buildResourcePreviewTests.ts',
		runtime: 'electron'
	},
	'editor-worker': {
		patterns: ['test/electron/editorWorker.real.test.ts'],
		build: 'build/buildEditorWorkerTests.ts',
		runtime: 'electron'
	},
	'desktop-identity': {
		patterns: ['test/electron/desktopIdentity.real.test.ts'],
		build: 'build/buildDesktopIdentityTests.ts',
		runtime: 'electron'
	},
	'electron-security': {
		patterns: ['test/electron/securityUtility.real.test.ts'],
		build: 'build/buildSecurityUtility.ts',
		runtime: 'electron'
	}
} as const satisfies Record<string, TestSuite>;

export type TestSuiteName = keyof typeof testSuites;

export function selectSuites(name: string): TestSuiteName[] {
	const names = Object.keys(testSuites) as TestSuiteName[];
	if (name === 'unit' || name === 'electron') {
		const runtime = name === 'unit' ? 'node' : 'electron';
		return names.filter((key) => testSuites[key].runtime === runtime);
	}
	if (!Object.hasOwn(testSuites, name)) throw new Error(`Unknown test suite: ${name}`);
	return [name as TestSuiteName];
}
