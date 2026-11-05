import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CancellationToken } from '../../src/prctr/base/common/cancellation.js';
import type { CandidateWindowState } from '../../src/prctr/platform/native/common/nativeObservation.generated.js';
import {
	SECURITY_UTILITY_SOURCE_MANIFEST,
	type NativeSupervisorStop
} from '../../src/prctr/platform/native/common/securityUtilityProtocol.js';
import { SyncDescriptor } from '../../src/prctr/platform/instantiation/common/descriptors.js';
import { InstantiationService } from '../../src/prctr/platform/instantiation/common/instantiationService.js';
import { ServiceCollection } from '../../src/prctr/platform/instantiation/common/serviceCollection.js';
import {
	INativePermissionBroker,
	NativePermissionBroker,
	NativePermissionBrokerError,
	createBaselineNativePermissionAdapters
} from '../../src/prctr/platform/native/electron-main/nativePermissionBroker.js';
import {
	ISecurityUtilityLifecycle,
	SecurityUtilityLifecycle
} from '../../src/prctr/platform/native/electron-main/securityUtilityLifecycle.js';
import {
	INativeServiceRegistration,
	NativeServiceRegistration,
	NativeServiceRegistrationError
} from '../../src/prctr/platform/native/electron-main/nativeServiceRegistration.js';
import {
	ISecurityUtilityProcessService,
	NativeSecurityCompositionError,
	type LaunchSecurityUtilityOptions,
	type LaunchedSecurityUtility
} from '../../src/prctr/platform/native/electron-main/nativeSecurity.js';
import { NativeSecurityService } from '../../src/prctr/platform/native/electron-main/nativeSecurityService.js';

const selection = { selectedSources: ['candidate-window'], selectedSourceCategories: [] } as const;
const candidate: CandidateWindowState = {
	certainty: 'complete',
	presence: 'present',
	focus: 'focused',
	visibility: 'visible',
	placement: 'maximized',
	bounds: { x: 0, y: 0, width: 1440, height: 900 },
	display_target_id: 'test-display'
};
const finalStop: NativeSupervisorStop = {
	state: 'stopped',
	final_snapshots: [],
	batches: [],
	process_replacement_required: false
};
const launchOptions: LaunchSecurityUtilityOptions = {
	...selection,
	participationGeneration: 'participation-test-001',
	collectionSessionId: 'collection-test-001',
	queueCapacity: 32,
	initialCandidateWindow: candidate,
	onPoll: () => {},
	onFailure: () => {}
};

class TestProcessService implements ISecurityUtilityProcessService {
	declare readonly _serviceBrand: undefined;
	public launched = 0;
	public aborted = 0;
	public cancelled = 0;
	public sent = 0;
	public shutdowns = 0;
	public reportAbortFailure = true;
	public launchGate: Promise<void> = Promise.resolve();
	public stopGate: Promise<void> = Promise.resolve();
	public failures: LaunchSecurityUtilityOptions['onFailure'] | undefined;

	public async launch(
		options: LaunchSecurityUtilityOptions,
		cancellation: CancellationToken
	): Promise<LaunchedSecurityUtility> {
		this.launched++;
		this.failures = options.onFailure;
		const listener = cancellation.onCancellationRequested(() => this.cancelled++);
		await this.launchGate;
		let aborted = false;
		return {
			abort: () => {
				if (aborted) return;
				aborted = true;
				listener.dispose();
				this.aborted++;
				if (this.reportAbortFailure) options.onFailure('process_exit');
			},
			connection: {
				sendCandidateWindowEvent: () => {
					this.sent++;
				},
				shutdown: async () => {
					this.shutdowns++;
					await this.stopGate;
					listener.dispose();
					return finalStop;
				}
			},
			ready: {
				kind: 'ready',
				protocol_version: 1,
				message_sequence: 0,
				challenge_response: 'test',
				build_identity: 'test',
				source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST,
				selected_sources: options.selectedSources,
				selected_source_categories: options.selectedSourceCategories,
				participation_generation: options.participationGeneration,
				delivered_at_wall_time_unix_ms: 1,
				snapshots: []
			}
		};
	}
}

function fixture() {
	let service: NativeSecurityService | undefined;
	let writes = 0;
	const processService = new TestProcessService();
	const services = new ServiceCollection();
	services.set(
		INativePermissionBroker,
		new SyncDescriptor(NativePermissionBroker, [
			{ adapters: createBaselineNativePermissionAdapters('macos') }
		])
	);
	services.set(ISecurityUtilityLifecycle, new SyncDescriptor(SecurityUtilityLifecycle));
	services.set(ISecurityUtilityProcessService, processService);
	services.set(
		INativeServiceRegistration,
		new SyncDescriptor(NativeServiceRegistration, [
			{
				app: {
					isPackaged: true,
					isReady: () => true,
					getLoginItemSettings: () => ({ status: 'not-registered' }),
					setLoginItemSettings: () => {
						writes++;
					}
				},
				platform: 'darwin',
				darwinMajor: 22,
				isSetupBlocked: () => service === undefined || service.isServiceSetupBlocked()
			}
		])
	);
	const instantiation = new InstantiationService(services, true);
	service = instantiation.createInstance(NativeSecurityService);
	const broker = instantiation.invokeFunction((accessor) =>
		accessor.get(INativePermissionBroker)
	);
	return { service, processService, broker, instantiation, writes: () => writes };
}

void test('decorated services share one isolated graph and setup stays explicit', async (t) => {
	const first = fixture();
	const second = fixture();
	t.after(() => {
		first.service.dispose();
		second.service.dispose();
	});
	assert.equal(first.writes(), 0);
	assert.notEqual(first.broker, second.broker);
	assert.equal(
		first.broker,
		first.instantiation.invokeFunction((accessor) => accessor.get(INativePermissionBroker))
	);
	const pending = first.service.inspectPermissionPreflight(selection);
	assert.throws(
		() => first.service.registerServiceDuringSetup(),
		(error: unknown) =>
			error instanceof NativeServiceRegistrationError && error.code === 'setup_blocked'
	);
	second.service.registerServiceDuringSetup();
	assert.equal(second.writes(), 1);
	await pending;
	first.service.cancelPermissionPreflight();
	first.service.registerServiceDuringSetup();
	assert.equal(first.writes(), 1);
});

void test('normal shutdown passes the receipt unchanged and releases only its generation', async (t) => {
	const value = fixture();
	t.after(() => value.service.dispose());
	await value.service.sealPermissionPreflight(selection);
	const launched = await value.service.launchSecurityUtility(launchOptions);
	assert.equal(value.processService.launched, 1);
	assert.equal(await launched.connection.shutdown(candidate), finalStop);
	await assert.rejects(
		launched.connection.shutdown(candidate),
		(error: unknown) =>
			error instanceof NativeSecurityCompositionError &&
			error.code === 'security_utility_not_active'
	);
	await value.service.sealPermissionPreflight(selection);
	const next = await value.service.launchSecurityUtility(launchOptions);
	assert.equal(value.processService.launched, 2);
	await next.connection.shutdown(candidate);
	assert.equal(value.processService.aborted, 0);
});

void test('a failed utility retains its seal and never authorizes another generation', async (t) => {
	const value = fixture();
	t.after(() => value.service.dispose());
	await value.service.sealPermissionPreflight(selection);
	const launched = await value.service.launchSecurityUtility(launchOptions);
	value.processService.failures?.('process_exit');
	await assert.rejects(
		value.service.launchSecurityUtility(launchOptions),
		(error: unknown) =>
			error instanceof NativeSecurityCompositionError &&
			error.code === 'security_utility_active'
	);
	await assert.rejects(
		value.broker.inspectPreflight(['candidate-window']),
		(error: unknown) =>
			error instanceof NativePermissionBrokerError && error.code === 'preflight_sealed'
	);
	await assert.rejects(launched.connection.shutdown(candidate));
});

void test('disposing during pending launch cancels it and aborts late acquired ownership', async () => {
	const value = fixture();
	const gate = Promise.withResolvers<void>();
	value.processService.launchGate = gate.promise;
	await value.service.sealPermissionPreflight(selection);
	const pending = value.service.launchSecurityUtility(launchOptions);
	value.service.dispose();
	assert.equal(value.processService.cancelled, 1);
	gate.resolve();
	await assert.rejects(
		pending,
		(error: unknown) =>
			error instanceof NativeSecurityCompositionError && error.code === 'disposed'
	);
	assert.equal(value.processService.aborted, 1);
	await assert.rejects(
		value.broker.inspectPreflight(['candidate-window']),
		(error: unknown) =>
			error instanceof NativePermissionBrokerError && error.code === 'disposed'
	);
	assert.throws(() => value.instantiation.invokeFunction(() => {}));
	value.service.dispose();
	assert.equal(value.processService.aborted, 1);
});

void test('disposing an active connection fences calls even without process failure feedback', async () => {
	const value = fixture();
	value.processService.reportAbortFailure = false;
	await value.service.sealPermissionPreflight(selection);
	const launched = await value.service.launchSecurityUtility(launchOptions);
	value.service.dispose();
	await assert.rejects(launched.connection.shutdown(candidate));
	assert.equal(value.processService.shutdowns, 0);
	assert.equal(value.processService.aborted, 1);
	assert.throws(
		() => value.service.inspectServiceRegistration(),
		(error: unknown) =>
			error instanceof NativeSecurityCompositionError && error.code === 'disposed'
	);
});

void test('a normal-stop result arriving after disposal cannot release the permission seal', async () => {
	const value = fixture();
	const gate = Promise.withResolvers<void>();
	value.processService.stopGate = gate.promise;
	await value.service.sealPermissionPreflight(selection);
	const launched = await value.service.launchSecurityUtility(launchOptions);
	const stopped = launched.connection.shutdown(candidate);
	value.service.dispose();
	gate.resolve();
	await assert.rejects(
		stopped,
		(error: unknown) =>
			error instanceof NativeSecurityCompositionError && error.code === 'disposed'
	);
	assert.equal(value.processService.aborted, 1);
});
