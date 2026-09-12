import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { electronExecutable as preparedElectron } from '../../build/lib/electron.ts';
import { repositoryRoot } from '../../build/lib/paths.ts';
import test from 'node:test';

void test('three product windows use isolated capability-specific preloads and locked production preferences', () => {
	const electron: unknown = preparedElectron();
	if (typeof electron !== 'string')
		throw new TypeError('Electron did not resolve to an executable');
	const result = JSON.parse(
		execFileSync(electron, ['.build/window-skeleton'], {
			encoding: 'utf8',
			cwd: repositoryRoot,
			timeout: 25_000,
			killSignal: 'SIGKILL'
		}).trim()
	) as {
		readonly results: readonly Record<string, any>[];
		readonly integratedBrowser: Record<string, any>;
		readonly transactionalRollback: Record<string, any>;
		readonly candidateSurface: Record<string, any>;
		readonly candidateContentBounds: Record<string, any>;
		readonly chromeUpdateRecovery: Record<string, any>;
		readonly windowChromeOptions: Record<string, Record<string, any>>;
		readonly applicationMenuRemoved: boolean;
		readonly runtimeIconForwarded: boolean;
	};
	assert.deepEqual(
		result.results.map((item) => ({
			kind: item.kind,
			names: item.renderer.names,
			intent: item.intents[0]
		})),
		[
			{ kind: 'launch', names: ['proctorLaunch'], intent: { kind: 'launch.exit' } },
			{
				kind: 'authenticated',
				names: ['proctorAuthenticated'],
				intent: { kind: 'authenticated.joinAttempt', attemptId: 'attempt-2' }
			},
			{
				kind: 'candidate',
				names: ['proctorCandidate'],
				intent: { kind: 'candidate.requestDeparture' }
			}
		]
	);
	for (const item of result.results) {
		assert.equal(item.renderer.bootstrap.kind, item.kind);
		assert.equal(item.renderer.hasNodeProcess, false);
		assert.equal(item.renderer.hasNodeRequire, false);
		assert.equal(item.renderer.popupDenied, true);
		assert.equal(item.devToolsDisabled, true);
		assert.equal(item.reloadDenied, true);
		assert.equal(item.subframeAuthorizationRejected, true);
		assert.deepEqual(item.preferences, {
			allowRunningInsecureContent: false,
			contextIsolation: true,
			nodeIntegration: false,
			nodeIntegrationInSubFrames: false,
			nodeIntegrationInWorker: false,
			sandbox: true,
			webSecurity: true,
			webviewTag: false
		});
		if (item.kind === 'candidate') assert.equal(item.renderer.windowChrome, undefined);
		else {
			assert.equal(item.renderer.windowChrome.protocolVersion, 1);
			assert.equal(
				item.renderer.windowChrome.platform,
				process.platform === 'darwin' || process.platform === 'win32'
					? process.platform
					: 'linux'
			);
			assert.equal(
				item.renderer.windowChrome.mode,
				process.platform === 'darwin' ? 'nativeTrafficLights' : 'nativeOverlay'
			);
			assert.equal(item.renderer.windowChrome.fullscreen, false);
			assert.ok(item.renderer.windowChrome.titlebarHeight >= 24);
		}
	}
	assert.deepEqual(result.windowChromeOptions.darwin, {
		width: 600,
		height: 500,
		minWidth: 360,
		minHeight: 360,
		title: 'Proctor',
		backgroundColor: '#0d1117',
		titleBarStyle: 'hidden',
		titleBarOverlay: true,
		acceptFirstMouse: true
	});
	assert.deepEqual(result.windowChromeOptions.darwinRtl, result.windowChromeOptions.darwin);
	for (const platform of ['win32', 'linux']) {
		const options = result.windowChromeOptions[platform]!;
		assert.equal(options.frame, false);
		assert.equal(options.title, 'Proctor');
		assert.equal(options.backgroundColor, '#0d1117');
		assert.equal(options.titleBarStyle, 'hidden');
		assert.deepEqual(options.titleBarOverlay, {
			color: '#0d1117',
			symbolColor: '#7d8590',
			height: 34
		});
	}
	assert.deepEqual(result.windowChromeOptions.candidate, {
		width: 1280,
		height: 800,
		titleBarStyle: 'hidden',
		closable: false,
		frame: false,
		fullscreenable: false,
		maximizable: false,
		minimizable: false,
		movable: false,
		resizable: false
	});
	assert.deepEqual(result.chromeUpdateRecovery, {
		overlayAttempts: 4,
		dimmedOverlay: {
			color: 'rgb(7, 9, 12)',
			symbolColor: 'rgb(63, 67, 72)',
			height: 35
		},
		trafficLightAttempts: 3,
		sheetAttempts: 3
	});
	assert.equal(result.applicationMenuRemoved, true);
	assert.equal(result.runtimeIconForwarded, true);
	assert.equal(
		result.results.find((item) => item.kind === 'candidate')?.renderer
			.browserSurfaceValidationRejected,
		true
	);
	assert.deepEqual(result.candidateSurface, {
		visible: true,
		focus: true,
		bounds: {
			x: 0,
			y: 10,
			width: result.candidateContentBounds.width,
			height: result.candidateContentBounds.height - 10
		}
	});
	assert.deepEqual(
		{
			popupDenied: result.integratedBrowser.popupDenied,
			permissionDenied: result.integratedBrowser.permissionDenied,
			subresourceBlocked: result.integratedBrowser.subresourceBlocked,
			secretContacted: result.integratedBrowser.secretContacted,
			redirectTargetContacted: result.integratedBrowser.redirectTargetContacted,
			devToolsDisabled: result.integratedBrowser.devToolsDisabled,
			sandbox: result.integratedBrowser.sandbox,
			surfaceVisible: result.integratedBrowser.surfaceVisible,
			surfaceBounds: result.integratedBrowser.surfaceBounds,
			surfaceFocusedOnce: result.integratedBrowser.surfaceFocusedOnce,
			surfaceFocusReleased: result.integratedBrowser.surfaceFocusReleased,
			focusObserverReported: result.integratedBrowser.focusObserverReported,
			activityContainsSensitivePayload:
				result.integratedBrowser.activityContainsSensitivePayload
		},
		{
			popupDenied: true,
			permissionDenied: true,
			subresourceBlocked: true,
			secretContacted: false,
			redirectTargetContacted: false,
			devToolsDisabled: true,
			sandbox: true,
			surfaceVisible: true,
			surfaceBounds: { x: 8, y: 12, width: 640, height: 480 },
			surfaceFocusedOnce: true,
			surfaceFocusReleased: true,
			focusObserverReported: true,
			activityContainsSensitivePayload: false
		}
	);
	assert.equal(
		result.integratedBrowser.activityKinds.includes('blockedTopLevelNavigation'),
		true
	);
	assert.deepEqual(result.integratedBrowser.compositionRollback, {
		rejected: true,
		handlersRemaining: 0,
		detached: 1,
		activityDisposed: 1,
		destroyed: true
	});
	assert.deepEqual(result.transactionalRollback, {
		terminal: { rejected: true, handlersRemaining: 0, modelClosed: true },
		settings: { rejected: true, handlersRemaining: 0 },
		security: { rejected: true, handlersRemaining: 0 },
		productWindow: { rejected: true, handlersRemaining: 0, windowDestroyed: true }
	});
});
