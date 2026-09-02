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
			timeout: 25_000
		}).trim()
	) as {
		readonly results: readonly Record<string, any>[];
		readonly integratedBrowser: Record<string, any>;
		readonly transactionalRollback: Record<string, any>;
		readonly candidateSurface: Record<string, any>;
		readonly candidateContentBounds: Record<string, any>;
		readonly applicationMenuRemoved: boolean;
	};
	assert.deepEqual(
		result.results.map((item) => ({
			kind: item.kind,
			names: item.renderer.names,
			intent: item.intents[0]
		})),
		[
			{ kind: 'launch', names: ['proctorLaunch'], intent: { kind: 'launch.changeServer' } },
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
	}
	assert.equal(result.applicationMenuRemoved, true);
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
