import { DisposableStore } from '../../src/prctr/base/common/lifecycle.js';
import { app, BrowserWindow, Menu } from 'electron';
import {
	createNativeSecurityComposition,
	NativeSecurityCompositionError,
	type SecurityUtilityConnection
} from '../../src/prctr/code/electron-main/securityUtilityComposition.js';
import type { CandidateWindowHostEvent } from '../../src/prctr/platform/native/common/nativeObservation.generated.js';
import {
	SECURITY_UTILITY_SOURCE_MANIFEST,
	type NativeBatchEnvelope
} from '../../src/prctr/platform/native/common/securityUtilityProtocol.js';
import { CandidateWindowEnforcementError } from '../../src/prctr/platform/native/electron-main/candidateWindowEnforcer.js';
import { createElectronCandidateWindow } from '../../src/prctr/platform/native/electron-main/electronCandidateWindow.js';
import { NativePermissionBrokerError } from '../../src/prctr/platform/native/electron-main/nativePermissionBroker.js';

const participationGeneration = 'participation-generation-test-0001';
const selectedSources = SECURITY_UTILITY_SOURCE_MANIFEST.map((entry) => entry.source_id);
const selectedSourceCategories = [
	'os-clipboard-change',
	'removable-block-storage',
	'portable-mtp',
	'system-proxy-state',
	'os-managed-vpn-state',
	'tunnel-interface-state',
	'route-change',
	'network-source-health',
	'camera',
	'microphone'
] as const;
const permissionSelection = { selectedSources, selectedSourceCategories } as const;

const nativeCompositions = new DisposableStore();
let connection: SecurityUtilityConnection | undefined;
const failures: string[] = [];
const candidateTrace: string[] = [];
let observedCloseAttempts = 0;
let phase = 'module_loaded';
const harnessTimeout = setTimeout(() => {
	process.stdout.write(
		`${JSON.stringify({ error: 'electron_harness_timeout', phase, failures })}\n`
	);
	nativeCompositions.dispose();
	app.exit(1);
}, 10_000);

phase = 'waiting_for_app';
void app
	.whenReady()
	.then(runHarness)
	.catch((error) => failHarness(error));

async function runHarness(): Promise<void> {
	try {
		phase = 'checking_native_permissions';
		const nativeSecurity = nativeCompositions.add(
			createNativeSecurityComposition({
				isParticipationOrCandidateActive: () => true
			})
		);
		const permissionPreflight =
			await nativeSecurity.inspectPermissionPreflight(permissionSelection);
		await nativeSecurity.sealPermissionPreflight(permissionSelection);
		let permissionPromptBlocked = false;
		try {
			await nativeSecurity.requestPermissionDuringPreflight('capture-session');
		} catch (error) {
			permissionPromptBlocked =
				error instanceof NativePermissionBrokerError && error.code === 'preflight_sealed';
		}
		phase = 'preparing_candidate_window';
		const applicationMenuAtCreation = Menu.buildFromTemplate([
			{ label: 'Proctor Test', submenu: [{ label: 'Creation menu marker', enabled: false }] }
		]);
		const applicationMenuBeforeCandidate = Menu.buildFromTemplate([
			{
				label: 'Proctor Test',
				submenu: [{ label: 'Preparation menu marker', enabled: false }]
			}
		]);
		if (process.platform === 'darwin') Menu.setApplicationMenu(applicationMenuAtCreation);
		const pendingCandidateEvents: CandidateWindowHostEvent[] = [];
		const candidateWindow = createCandidateWindowForTest({
			backgroundColor: '#111111',
			title: 'Proctor Candidate Test',
			verifiedDisplayTargetId: 'electron-test-display',
			onEvent: (event) => {
				candidateTrace.push(
					`${event.kind}:${event.window?.placement ?? 'none'}:${
						event.window?.visibility ?? 'none'
					}`
				);
				if (connection === undefined) pendingCandidateEvents.push(event);
				else connection.sendCandidateWindowEvent(event);
			},
			onFailure: (failure) => failures.push(`enforcement:${failure}`)
		});
		if (process.platform === 'darwin') Menu.setApplicationMenu(applicationMenuBeforeCandidate);
		const enforcer = candidateWindow.enforcer;
		const prepared = enforcer.prepare(participationGeneration);
		phase = 'launching_utility';
		const launchOptions = {
			participationGeneration,
			collectionSessionId: 'collection-session-test-0001',
			queueCapacity: 32,
			selectedSources,
			selectedSourceCategories,
			initialCandidateWindow: prepared.window,
			onPoll: (poll) => {
				observedCloseAttempts += countCandidateCloseAttempts(poll.batches);
			},
			onFailure: (failure) => failures.push(failure)
		} as const satisfies Parameters<typeof nativeSecurity.launchSecurityUtility>[0];
		const failedStartupSecurity = nativeCompositions.add(
			createNativeSecurityComposition({
				isParticipationOrCandidateActive: () => true
			})
		);
		await failedStartupSecurity.inspectPermissionPreflight(permissionSelection);
		await failedStartupSecurity.sealPermissionPreflight(permissionSelection);
		let startupFailureRetainedSeal = false;
		try {
			await failedStartupSecurity.launchSecurityUtility({
				...launchOptions,
				collectionSessionId: 'collection-session-failed-startup-test-0001',
				queueCapacity: 0,
				onFailure: () => undefined
			});
		} catch {
			const [inspection, request] = await Promise.allSettled([
				failedStartupSecurity.inspectPermissionPreflight(permissionSelection),
				failedStartupSecurity.requestPermissionDuringPreflight('capture-session')
			]);
			startupFailureRetainedSeal =
				rejectedWithBrokerCode(inspection, 'preflight_sealed') &&
				rejectedWithBrokerCode(request, 'preflight_sealed');
		}
		let unsealedLaunchRejected = false;
		try {
			await nativeCompositions
				.add(
					createNativeSecurityComposition({
						isParticipationOrCandidateActive: () => true
					})
				)
				.launchSecurityUtility(launchOptions);
		} catch (error) {
			unsealedLaunchRejected =
				error instanceof NativeSecurityCompositionError &&
				error.code === 'permission_preflight_not_sealed';
		}
		let mismatchedPreflightLaunchRejected = false;
		try {
			await nativeSecurity.launchSecurityUtility({
				...launchOptions,
				selectedSources: selectedSources.filter((source) => source !== 'media-device'),
				selectedSourceCategories: ['os-clipboard-change']
			});
		} catch (error) {
			mismatchedPreflightLaunchRejected =
				error instanceof NativeSecurityCompositionError &&
				error.code === 'permission_preflight_scope_mismatch';
		}
		const mutableLaunchSources = [...launchOptions.selectedSources];
		const mutableLaunchCategories = [...launchOptions.selectedSourceCategories];
		const launching = nativeSecurity.launchSecurityUtility({
			...launchOptions,
			selectedSources: mutableLaunchSources,
			selectedSourceCategories: mutableLaunchCategories
		});
		mutableLaunchSources.splice(0);
		mutableLaunchCategories.splice(0);
		const launched = await launching;
		phase = 'utility_ready';
		connection = launched.connection;
		let activePermissionReleaseRejected = false;
		try {
			nativeSecurity.cancelPermissionPreflight();
		} catch (error) {
			activePermissionReleaseRejected =
				error instanceof NativeSecurityCompositionError &&
				error.code === 'permission_preflight_active';
		}
		for (const event of pendingCandidateEvents.splice(0)) {
			connection.sendCandidateWindowEvent(event);
		}
		candidateWindow.window.close();
		await new Promise((resolve) => setTimeout(resolve, 250));
		const closeVetoed = !candidateWindow.window.isDestroyed();
		const verified = enforcer.verify(participationGeneration);
		const stopped = await connection.shutdown(verified.window);
		observedCloseAttempts += countCandidateCloseAttempts(stopped.batches);
		phase = 'utility_stopped';
		const released = enforcer.release(participationGeneration);
		const reopenedPermissionPreflight =
			await nativeSecurity.inspectPermissionPreflight(permissionSelection);
		const applicationMenuRestored =
			process.platform !== 'darwin' ||
			Menu.getApplicationMenu() === applicationMenuBeforeCandidate;
		const listenerRollback = verifyTransactionalListenerRollback();
		const restorationFailure = verifyRestorationFailureContainment();
		process.stdout.write(
			`${JSON.stringify({
				ready: launched.ready.kind,
				sources: launched.ready.snapshots.map((snapshot) => snapshot.source).sort(),
				permission_platform: permissionPreflight.platform,
				permission_modes: permissionPreflight.permissions.map(
					(permission) => permission.mode
				),
				permission_states: permissionPreflight.permissions.map(
					(permission) => permission.permission
				),
				permission_prompt_blocked: permissionPromptBlocked,
				permission_startup_failure_retained_seal: startupFailureRetainedSeal,
				permission_unsealed_launch_rejected: unsealedLaunchRejected,
				permission_mismatched_launch_rejected: mismatchedPreflightLaunchRejected,
				permission_active_release_rejected: activePermissionReleaseRejected,
				permission_preflight_reopened:
					reopenedPermissionPreflight.permissions.length ===
					permissionPreflight.permissions.length,
				constraints: verified.constraints,
				close_vetoed: closeVetoed,
				close_attempt_observed: observedCloseAttempts > 0,
				stopped: stopped.state,
				process_replacement_required: stopped.process_replacement_required,
				released: released.presence,
				application_menu_restored: applicationMenuRestored,
				...listenerRollback,
				...restorationFailure,
				failures
			})}\n`
		);
		clearTimeout(harnessTimeout);
		nativeCompositions.dispose();
		app.exit(failures.length === 0 ? 0 : 1);
	} catch (error) {
		failHarness(error);
	}
}

function rejectedWithBrokerCode(
	result: PromiseSettledResult<unknown>,
	code: NativePermissionBrokerError['code']
): boolean {
	return (
		result.status === 'rejected' &&
		result.reason instanceof NativePermissionBrokerError &&
		result.reason.code === code
	);
}

function verifyTransactionalListenerRollback(): {
	readonly listener_setup_failed_closed: boolean;
	readonly listener_rollback_cleanup_precedence: boolean;
	readonly listener_cleanup_retried: boolean;
	readonly listener_failure_released: boolean;
} {
	phase = 'verifying_listener_rollback';
	const candidateWindow = createCandidateWindowForTest({
		title: 'Proctor Listener Rollback Test',
		verifiedDisplayTargetId: 'electron-test-display',
		onEvent: () => undefined,
		onFailure: () => undefined
	});
	const target = candidateWindow.window as unknown as {
		on(event: string, listener: (...arguments_: unknown[]) => void): void;
		off(event: string, listener: (...arguments_: unknown[]) => void): void;
	};
	const originalOn = target.on.bind(target);
	const originalOff = target.off.bind(target);
	let offCount = 0;
	let cleanupFailureThrown = false;
	target.on = (event, listener) => {
		if (event === 'show') throw new Error('listener_registration_failed');
		originalOn(event, listener);
	};
	target.off = (event, listener) => {
		originalOff(event, listener);
		offCount += 1;
		if (!cleanupFailureThrown) {
			cleanupFailureThrown = true;
			throw new Error('listener_cleanup_failed');
		}
	};

	let setupFailedClosed = false;
	let cleanupFailureHasPrecedence = false;
	try {
		candidateWindow.enforcer.prepare('participation-generation-test-rollback-0002');
	} catch (error) {
		setupFailedClosed =
			error instanceof CandidateWindowEnforcementError && error.code === 'prepare_failed';
		const setupCause = error instanceof Error ? error.cause : undefined;
		cleanupFailureHasPrecedence =
			setupCause instanceof AggregateError &&
			setupCause.errors[0] instanceof Error &&
			setupCause.errors[0].message === 'listener_cleanup_failed' &&
			setupCause.errors[1] instanceof Error &&
			setupCause.errors[1].message === 'listener_registration_failed';
	}

	target.on = originalOn;
	const released = candidateWindow.enforcer.release(
		'participation-generation-test-rollback-0002'
	);
	target.off = originalOff;
	return {
		listener_setup_failed_closed: setupFailedClosed,
		listener_rollback_cleanup_precedence: cleanupFailureHasPrecedence,
		listener_cleanup_retried: offCount === 4,
		listener_failure_released: released.presence === 'absent'
	};
}

function verifyRestorationFailureContainment(): {
	readonly restoration_failure_contained: boolean;
	readonly restoration_failure_blocked: boolean;
	readonly restoration_failure_recovered: boolean;
	readonly restoration_failure_released: boolean;
} {
	phase = 'verifying_restoration_failure';
	const localFailures: string[] = [];
	const candidateWindow = createCandidateWindowForTest({
		title: 'Proctor Restoration Failure Test',
		verifiedDisplayTargetId: 'electron-test-display',
		onEvent: () => undefined,
		onFailure: (failure) => localFailures.push(failure)
	});
	candidateWindow.enforcer.prepare('participation-generation-test-restoration-0003');
	const target = candidateWindow.window as unknown as {
		setFullScreen(flag: boolean): void;
		emit(event: string): boolean;
	};
	const originalSetFullScreen = target.setFullScreen.bind(target);
	target.setFullScreen = () => {
		throw new Error('fullscreen restoration failed');
	};
	let restorationFailureContained = true;
	try {
		target.emit('enter-full-screen');
	} catch {
		restorationFailureContained = false;
	}
	target.setFullScreen = originalSetFullScreen;
	const restorationFailureBlocked = localFailures.includes('constraint_drift');
	const restorationFailureRecovered = candidateWindow.enforcer.verify(
		'participation-generation-test-restoration-0003'
	).constraints.fullscreenPrevented;
	const released = candidateWindow.enforcer.release(
		'participation-generation-test-restoration-0003'
	);
	return {
		restoration_failure_contained: restorationFailureContained,
		restoration_failure_blocked: restorationFailureBlocked,
		restoration_failure_recovered: restorationFailureRecovered,
		restoration_failure_released: released.presence === 'absent'
	};
}

function createCandidateWindowForTest(
	options: Parameters<typeof createElectronCandidateWindow>[0]
): {
	readonly enforcer: ReturnType<typeof createElectronCandidateWindow>;
	readonly window: BrowserWindow;
} {
	const existingWindowIds = new Set(BrowserWindow.getAllWindows().map((window) => window.id));
	const enforcer = createElectronCandidateWindow(options);
	const createdWindows = BrowserWindow.getAllWindows().filter(
		(window) => !existingWindowIds.has(window.id)
	);
	if (createdWindows.length !== 1 || createdWindows[0] === undefined) {
		throw new Error('CandidateWindow factory did not create exactly one private BrowserWindow');
	}
	return { enforcer, window: createdWindows[0] };
}

function countCandidateCloseAttempts(batches: readonly NativeBatchEnvelope[]): number {
	return batches.reduce((count, envelope) => {
		if (envelope.source !== 'candidate-window') return count;
		return (
			count +
			envelope.batch.observations.reduce(
				(sum, observation) => sum + observation.event.close_attempts_since_previous,
				0
			)
		);
	}, 0);
}

function failHarness(error?: unknown): void {
	clearTimeout(harnessTimeout);
	process.stdout.write(
		`${JSON.stringify({
			error: 'electron_harness_failed',
			phase,
			failures,
			candidateTrace,
			cause: error instanceof Error ? error.message : undefined
		})}\n`
	);
	nativeCompositions.dispose();
	app.exit(1);
}
