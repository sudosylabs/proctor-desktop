import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CandidateWindowState } from '../../src/prctr/platform/native/common/nativeObservation.generated.ts';
import {
	SECURITY_UTILITY_LIFECYCLE_MARGIN_MS,
	SECURITY_UTILITY_MAX_SHUTDOWN_INGRESS_ROUND_TRIPS,
	SECURITY_UTILITY_NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS,
	SECURITY_UTILITY_SHUTDOWN_TIMEOUT_MS,
	SECURITY_UTILITY_SOURCE_COUNT,
	SECURITY_UTILITY_SOURCE_MANIFEST,
	SECURITY_UTILITY_STARTUP_TIMEOUT_MS,
	SECURITY_UTILITY_HEARTBEAT_TIMEOUT_MS,
	isNativeBridgeManifest,
	isNativeSupervisorPoll,
	isNativeSupervisorStop,
	isSecurityUtilityBootstrap,
	type NativeBaselineDriver
} from '../../src/prctr/platform/native/common/securityUtilityProtocol.ts';
import type { SecurityUtilityPort } from '../../src/prctr/platform/native/common/securityUtilityPort.ts';
import { SecurityUtilityClient } from '../../src/prctr/platform/native/electron-main/securityUtilityClient.ts';
import { SecurityUtilityHost } from '../../src/prctr/platform/native/electron-utility/securityUtilityHost.ts';

const candidateWindow: CandidateWindowState = {
	certainty: 'complete',
	presence: 'present',
	focus: 'focused',
	visibility: 'visible',
	placement: 'maximized',
	bounds: { x: 0, y: 0, width: 1_440, height: 900 },
	display_target_id: 'security-test-display'
};

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

const timestamp = { monotonic_time_ns: 1 } as const;
const snapshots = [
	{
		source: 'display-topology',
		snapshot: {
			source_instance_id: 'display-source-0001',
			source_version: '0.1.0',
			adapter_version: 'test-v1',
			schema_version: 1,
			platform: 'macos',
			permission: 'granted',
			health: 'healthy',
			sequence: 0,
			observed_at: timestamp,
			topology: {
				certainty: 'complete',
				targets: [
					{
						target_id: 'security-test-display',
						active: true,
						primary_state: 'primary',
						builtin: true,
						power_state: 'awake',
						kind: 'physical',
						pixel_width: 1_440,
						pixel_height: 900
					}
				]
			}
		}
	},
	{
		source: 'candidate-window',
		snapshot: {
			source_instance_id: 'candidate-source-001',
			source_version: '0.1.0',
			adapter_version: 'test-v1',
			schema_version: 1,
			platform: 'macos',
			permission: 'granted',
			health: 'healthy',
			sequence: 0,
			observed_at: timestamp,
			window: candidateWindow
		}
	},
	{
		source: 'capture-session',
		snapshot: {
			source_instance_id: 'capture-source-0001',
			source_version: '0.1.0',
			adapter_version: 'test-v1',
			schema_version: 1,
			platform: 'macos',
			permission: 'unavailable',
			health: 'degraded',
			sequence: 0,
			observed_at: timestamp,
			state: {
				screen_capture: {
					support: 'unsupported',
					activity: 'unknown',
					certainty: 'unknown'
				},
				native_remote_session: {
					support: 'unsupported',
					activity: 'unknown',
					certainty: 'unknown'
				}
			}
		}
	},
	{
		source: 'process-application',
		snapshot: {
			source_instance_id: 'process-source-0001',
			source_version: '0.1.0',
			adapter_version: 'test-v1',
			schema_version: 1,
			platform: 'macos',
			permission: 'unavailable',
			health: 'degraded',
			sequence: 0,
			observed_at: timestamp,
			state: {
				coverage: 'unavailable',
				certainty: 'unknown',
				processes: []
			}
		}
	},
	{
		source: 'interactive-session',
		snapshot: {
			source_instance_id: 'interactive-source-0001',
			source_version: '0.1.0',
			adapter_version: 'test-v1',
			schema_version: 1,
			platform: 'macos',
			permission: 'unavailable',
			health: 'degraded',
			sequence: 0,
			observed_at: timestamp,
			state: {
				coverage: 'unavailable',
				certainty: 'unknown',
				console_ownership: 'unknown',
				lock_state: 'unknown',
				remote_attachment: 'unknown',
				other_human_session_count: 0
			}
		}
	},
	{
		source: 'clipboard',
		snapshot: {
			source_instance_id: 'clipboard-source-0001',
			source_version: '0.1.0',
			adapter_version: 'test-v1',
			schema_version: 1,
			platform: 'macos',
			permission: 'unavailable',
			health: 'degraded',
			sequence: 0,
			observed_at: timestamp,
			state: { coverage: 'unavailable', certainty: 'unknown', change_generation: 0 }
		}
	},
	{
		source: 'print-spooler',
		snapshot: {
			source_instance_id: 'print-source-000001',
			source_version: '0.1.0',
			adapter_version: 'test-v1',
			schema_version: 1,
			platform: 'macos',
			permission: 'unavailable',
			health: 'degraded',
			sequence: 0,
			observed_at: timestamp,
			state: {
				coverage: 'unavailable',
				certainty: 'unknown',
				candidate_job_count: 0,
				other_job_count: 0,
				unknown_job_count: 0
			}
		}
	},
	{
		source: 'removable-storage',
		snapshot: {
			source_instance_id: 'storage-source-0001',
			source_version: '0.1.0',
			adapter_version: 'test-v1',
			schema_version: 1,
			platform: 'macos',
			permission: 'unavailable',
			health: 'degraded',
			sequence: 0,
			observed_at: timestamp,
			state: { coverage: 'unavailable', certainty: 'unknown', attached_functions: [] }
		}
	},
	{
		source: 'virtualization',
		snapshot: {
			source_instance_id: 'virtual-source-0001',
			source_version: '0.1.0',
			adapter_version: 'test-v1',
			schema_version: 1,
			platform: 'macos',
			permission: 'unavailable',
			health: 'degraded',
			sequence: 0,
			observed_at: timestamp,
			state: { coverage: 'unavailable', certainty: 'unknown', classification: 'unknown' }
		}
	},
	{
		source: 'network-configuration',
		snapshot: {
			source_instance_id: 'network-source-0001',
			source_version: '0.1.0',
			adapter_version: 'test-v1',
			schema_version: 1,
			platform: 'macos',
			permission: 'unavailable',
			health: 'degraded',
			sequence: 0,
			observed_at: timestamp,
			state: {
				coverage: 'unavailable',
				certainty: 'unknown',
				system_proxy: 'unknown',
				managed_vpn: 'unknown',
				tunnel_interfaces: [],
				route_generation: 0
			}
		}
	},
	{
		source: 'media-device',
		snapshot: {
			source_instance_id: 'media-source-00001',
			source_version: '0.1.0',
			adapter_version: 'test-v1',
			schema_version: 1,
			platform: 'macos',
			permission: 'unavailable',
			health: 'degraded',
			sequence: 0,
			observed_at: timestamp,
			state: {
				camera: {
					coverage: 'unavailable',
					certainty: 'unknown',
					permission: 'unavailable',
					readiness: 'unknown',
					endpoint_count: 0,
					other_application_use: 'unknown'
				},
				microphone: {
					coverage: 'unavailable',
					certainty: 'unknown',
					permission: 'unavailable',
					readiness: 'unknown',
					endpoint_count: 0,
					other_application_use: 'unknown'
				}
			}
		}
	}
] as const;

void test('main client honors a smaller remaining startup budget', async () => {
	const [mainPort] = memoryPortPair();
	const failures: string[] = [];
	const client = new SecurityUtilityClient({
		port: mainPort,
		challenge: 'a'.repeat(43),
		buildIdentity: 'proctor-build-identity-0001',
		participationGeneration: 'participation-generation-0001',
		collectionSessionId: 'collection-session-0001',
		queueCapacity: 32,
		selectedSources,
		selectedSourceCategories,
		initialCandidateWindow: candidateWindow,
		onPoll: () => undefined,
		onFailure: (failure) => failures.push(failure)
	});

	await assert.rejects(client.start(10), /startup_timeout/u);
	assert.deepEqual(failures, ['startup_timeout']);
});

void test('private bootstrap validator rejects unknown fields and manifest drift', () => {
	const bootstrap = {
		kind: 'bootstrap',
		protocol_version: 1,
		challenge: 'a'.repeat(43),
		build_identity: 'proctor-build-identity-0001',
		source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST,
		participation_generation: 'participation-generation-0001',
		collection_session_id: 'collection-session-0001',
		queue_capacity: 32,
		selected_sources: selectedSources,
		selected_source_categories: selectedSourceCategories,
		initial_candidate_window: candidateWindow
	};
	assert.equal(isSecurityUtilityBootstrap(bootstrap), true);
	assert.equal(isSecurityUtilityBootstrap({ ...bootstrap, unexpected: true }), false);
	assert.equal(isSecurityUtilityBootstrap({ ...bootstrap, selected_sources: [] }), false);
	assert.equal(
		isSecurityUtilityBootstrap({
			...bootstrap,
			selected_sources: ['clipboard', 'clipboard']
		}),
		false
	);
	assert.equal(
		isSecurityUtilityBootstrap({
			...bootstrap,
			selected_sources: ['clipboard', 'candidate-window']
		}),
		false
	);
	assert.equal(
		isSecurityUtilityBootstrap({
			...bootstrap,
			selected_source_categories: ['camera']
		}),
		false
	);
	assert.equal(
		isSecurityUtilityBootstrap({
			...bootstrap,
			selected_source_categories: selectedSourceCategories.filter(
				(category) => category !== 'removable-block-storage' && category !== 'portable-mtp'
			)
		}),
		false
	);
	assert.equal(
		isSecurityUtilityBootstrap({
			...bootstrap,
			selected_source_categories: selectedSourceCategories.filter(
				(category) =>
					![
						'system-proxy-state',
						'os-managed-vpn-state',
						'tunnel-interface-state',
						'route-change',
						'network-source-health'
					].includes(category)
			)
		}),
		false
	);
	assert.equal(
		isSecurityUtilityBootstrap({
			...bootstrap,
			selected_sources: selectedSources.filter((source) => source !== 'network-configuration')
		}),
		false
	);
	assert.equal(
		isSecurityUtilityBootstrap({
			...bootstrap,
			selected_source_categories: ['microphone', 'camera']
		}),
		false
	);
	assert.equal(
		isSecurityUtilityBootstrap({
			...bootstrap,
			source_manifest: [...SECURITY_UTILITY_SOURCE_MANIFEST].reverse()
		}),
		false
	);
});

void test('native bridge admission compares the generated per-source schema manifest', () => {
	const manifest = {
		bridge_version: 1,
		source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST
	};
	assert.equal(isNativeBridgeManifest(manifest), true);
	assert.equal(
		isNativeBridgeManifest({
			...manifest,
			source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST.map((source, index) =>
				index === 1 ? { ...source, schema_version: source.schema_version + 1 } : source
			)
		}),
		false
	);
});

void test('outer lifecycle budgets cover full native work and transport margin', () => {
	assert.equal(SECURITY_UTILITY_SOURCE_COUNT, SECURITY_UTILITY_SOURCE_MANIFEST.length);
	assert.equal(
		SECURITY_UTILITY_STARTUP_TIMEOUT_MS,
		(SECURITY_UTILITY_SOURCE_COUNT * 2 - 1) *
			SECURITY_UTILITY_NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS +
			SECURITY_UTILITY_LIFECYCLE_MARGIN_MS
	);
	assert.equal(
		SECURITY_UTILITY_SHUTDOWN_TIMEOUT_MS,
		SECURITY_UTILITY_SOURCE_COUNT * SECURITY_UTILITY_NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS +
			SECURITY_UTILITY_MAX_SHUTDOWN_INGRESS_ROUND_TRIPS *
				SECURITY_UTILITY_HEARTBEAT_TIMEOUT_MS +
			SECURITY_UTILITY_LIFECYCLE_MARGIN_MS
	);
});

void test('main rejects a ready echo with a different valid source selection', async () => {
	const [mainPort, utilityPort] = memoryPortPair();
	const failures: string[] = [];
	utilityPort.onMessage((message) => {
		if (
			typeof message !== 'object' ||
			message === null ||
			Reflect.get(message, 'kind') !== 'bootstrap'
		)
			return;
		utilityPort.postMessage({
			kind: 'ready',
			protocol_version: 1,
			message_sequence: 0,
			challenge_response: 'a'.repeat(43),
			build_identity: 'proctor-build-identity-0001',
			source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST,
			selected_sources: selectedSources.slice(0, -1),
			selected_source_categories: [
				'os-clipboard-change',
				'removable-block-storage',
				'portable-mtp',
				'system-proxy-state',
				'os-managed-vpn-state',
				'tunnel-interface-state',
				'route-change',
				'network-source-health'
			],
			participation_generation: 'participation-generation-0001',
			delivered_at_wall_time_unix_ms: 1,
			snapshots: snapshots.slice(0, -1)
		});
	});
	utilityPort.start();
	const client = new SecurityUtilityClient({
		port: mainPort,
		challenge: 'a'.repeat(43),
		buildIdentity: 'proctor-build-identity-0001',
		participationGeneration: 'participation-generation-0001',
		collectionSessionId: 'collection-session-0001',
		queueCapacity: 32,
		selectedSources,
		selectedSourceCategories,
		initialCandidateWindow: candidateWindow,
		onPoll: () => undefined,
		onFailure: (failure) => failures.push(failure)
	});

	await assert.rejects(client.start());
	assert.deepEqual(failures, ['unexpected_message']);
});

void test('main rejects later utility output from a source outside the sealed subset', async () => {
	const [mainPort, utilityPort] = memoryPortPair();
	const failures: string[] = [];
	utilityPort.onMessage((message) => {
		if (
			typeof message !== 'object' ||
			message === null ||
			Reflect.get(message, 'kind') !== 'bootstrap'
		)
			return;
		utilityPort.postMessage({
			kind: 'ready',
			protocol_version: 1,
			message_sequence: 0,
			challenge_response: 'a'.repeat(43),
			build_identity: 'proctor-build-identity-0001',
			source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST,
			selected_sources: ['display-topology'],
			selected_source_categories: [],
			participation_generation: 'participation-generation-0001',
			delivered_at_wall_time_unix_ms: 1,
			snapshots: [snapshots[0]]
		});
	});
	utilityPort.start();
	const client = new SecurityUtilityClient({
		port: mainPort,
		challenge: 'a'.repeat(43),
		buildIdentity: 'proctor-build-identity-0001',
		participationGeneration: 'participation-generation-0001',
		collectionSessionId: 'collection-session-0001',
		queueCapacity: 32,
		selectedSources: ['display-topology'],
		selectedSourceCategories: [],
		initialCandidateWindow: candidateWindow,
		onPoll: () => assert.fail('out-of-scope poll must not be delivered'),
		onFailure: (failure) => failures.push(failure)
	});
	await client.start();

	utilityPort.postMessage({
		kind: 'native_poll',
		protocol_version: 1,
		message_sequence: 1,
		participation_generation: 'participation-generation-0001',
		delivered_at_wall_time_unix_ms: 2,
		poll: {
			state: 'healthy',
			opened_snapshots: [snapshots[1]],
			final_snapshots: [],
			batches: [],
			transitions: []
		}
	});
	await waitUntil(() => failures.length > 0);
	assert.deepEqual(failures, ['unexpected_message']);
});

void test('main and utility complete the authenticated lifecycle over a private port', async () => {
	const [mainPort, utilityPort] = memoryPortPair();
	const acceptedEvents: unknown[] = [];
	const driver: NativeBaselineDriver = {
		manifest: () => ({
			bridge_version: 1,
			source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST
		}),
		openBaseline: () => ({ snapshots }),
		candidateWindowEvent: (event) => {
			acceptedEvents.push(event);
			return 'accepted';
		},
		candidateWindowEventsLost: () => 'accepted',
		pollBaseline: () => ({
			state: 'healthy',
			opened_snapshots: [],
			final_snapshots: [],
			batches: [],
			transitions: []
		}),
		stopBaseline: () => ({
			state: 'stopped',
			batches: [],
			final_snapshots: [],
			process_replacement_required: false
		})
	};
	let utilityExitCode: number | undefined;
	const host = new SecurityUtilityHost({
		port: utilityPort,
		driver,
		buildIdentity: 'proctor-build-identity-0001',
		terminate: (code) => {
			utilityExitCode = code;
		}
	});
	const failures: string[] = [];
	const client = new SecurityUtilityClient({
		port: mainPort,
		challenge: 'a'.repeat(43),
		buildIdentity: 'proctor-build-identity-0001',
		participationGeneration: 'participation-generation-0001',
		collectionSessionId: 'collection-session-0001',
		queueCapacity: 32,
		selectedSources,
		selectedSourceCategories,
		initialCandidateWindow: candidateWindow,
		onPoll: () => undefined,
		onFailure: (failure) => failures.push(failure)
	});
	host.start();
	const ready = await client.start();
	assert.equal(ready.challenge_response, 'a'.repeat(43));
	client.sendCandidateWindowEvent({ kind: 'close_attempt' });
	await eventLoopTurn();
	assert.deepEqual(acceptedEvents, [{ kind: 'close_attempt' }]);
	const stopped = await client.shutdown(candidateWindow);
	await eventLoopTurn();
	assert.equal(stopped.state, 'stopped');
	assert.equal(utilityExitCode, 0);
	assert.deepEqual(failures, []);
});

void test('candidate ingress stays bounded and reports the exact sender-side loss count', async () => {
	const [mainPort, utilityPort] = memoryPortPair();
	const acceptedEvents: unknown[] = [];
	const lostCounts: number[] = [];
	const driver: NativeBaselineDriver = {
		manifest: () => ({
			bridge_version: 1,
			source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST
		}),
		openBaseline: () => ({ snapshots }),
		candidateWindowEvent: (event) => {
			acceptedEvents.push(event);
			return 'accepted';
		},
		candidateWindowEventsLost: (lostCount) => {
			lostCounts.push(lostCount);
			return 'accepted';
		},
		pollBaseline: () => ({
			state: 'healthy',
			opened_snapshots: [],
			final_snapshots: [],
			batches: [],
			transitions: []
		}),
		stopBaseline: () => ({
			state: 'stopped',
			batches: [],
			final_snapshots: [],
			process_replacement_required: false
		})
	};
	const host = new SecurityUtilityHost({
		port: utilityPort,
		driver,
		buildIdentity: 'proctor-build-identity-0001',
		terminate: () => undefined
	});
	const failures: string[] = [];
	const client = new SecurityUtilityClient({
		port: mainPort,
		challenge: 'a'.repeat(43),
		buildIdentity: 'proctor-build-identity-0001',
		participationGeneration: 'participation-generation-0001',
		collectionSessionId: 'collection-session-0001',
		queueCapacity: 2,
		selectedSources,
		selectedSourceCategories,
		initialCandidateWindow: candidateWindow,
		onPoll: () => undefined,
		onFailure: (failure) => failures.push(failure)
	});
	host.start();
	await client.start();
	for (let attempt = 0; attempt < 5; attempt += 1) {
		client.sendCandidateWindowEvent({ kind: 'close_attempt' });
	}
	await waitUntil(() => lostCounts.length === 1);
	const stopped = await client.shutdown(candidateWindow);

	assert.equal(stopped.state, 'stopped');
	assert.equal(acceptedEvents.length, 2);
	assert.deepEqual(lostCounts, [3]);
	assert.deepEqual(failures, []);
});

void test('shutdown compacts the maximum pending ingress into one exact loss marker', async () => {
	const [mainPort, utilityPort] = memoryPortPair();
	const lostCounts: number[] = [];
	let eventCalls = 0;
	const driver: NativeBaselineDriver = {
		manifest: () => ({
			bridge_version: 1,
			source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST
		}),
		openBaseline: () => ({ snapshots }),
		candidateWindowEvent: () => {
			eventCalls += 1;
			return 'accepted';
		},
		candidateWindowEventsLost: (lostCount) => {
			lostCounts.push(lostCount);
			return 'accepted';
		},
		pollBaseline: () => ({
			state: 'healthy',
			opened_snapshots: [],
			final_snapshots: [],
			batches: [],
			transitions: []
		}),
		stopBaseline: () => ({
			state: 'stopped',
			batches: [],
			final_snapshots: [],
			process_replacement_required: false
		})
	};
	const host = new SecurityUtilityHost({
		port: utilityPort,
		driver,
		buildIdentity: 'proctor-build-identity-0001',
		terminate: () => undefined
	});
	const client = new SecurityUtilityClient({
		port: mainPort,
		challenge: 'a'.repeat(43),
		buildIdentity: 'proctor-build-identity-0001',
		participationGeneration: 'participation-generation-0001',
		collectionSessionId: 'collection-session-0001',
		queueCapacity: 1_024,
		selectedSources,
		selectedSourceCategories,
		initialCandidateWindow: candidateWindow,
		onPoll: () => undefined,
		onFailure: () => undefined
	});
	host.start();
	await client.start();
	for (let attempt = 0; attempt < 1_025; attempt += 1) {
		client.sendCandidateWindowEvent({ kind: 'close_attempt' });
	}
	const stopped = await client.shutdown(candidateWindow);

	assert.equal(stopped.state, 'stopped');
	assert.equal(eventCalls, 1);
	assert.deepEqual(lostCounts, [1_024]);
});

void test('native ingress drops remain ordered so a later event can expose the exact gap', async () => {
	const [mainPort, utilityPort] = memoryPortPair();
	const outcomes = ['dropped', 'accepted'] as const;
	let calls = 0;
	const driver: NativeBaselineDriver = {
		manifest: () => ({
			bridge_version: 1,
			source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST
		}),
		openBaseline: () => ({ snapshots }),
		candidateWindowEvent: () => outcomes[calls++] ?? 'accepted',
		candidateWindowEventsLost: () => 'accepted',
		pollBaseline: () => ({
			state: 'healthy',
			opened_snapshots: [],
			final_snapshots: [],
			batches: [],
			transitions: []
		}),
		stopBaseline: () => ({
			state: 'stopped',
			batches: [],
			final_snapshots: [],
			process_replacement_required: false
		})
	};
	const failures: string[] = [];
	const host = new SecurityUtilityHost({
		port: utilityPort,
		driver,
		buildIdentity: 'proctor-build-identity-0001',
		terminate: () => undefined
	});
	const client = new SecurityUtilityClient({
		port: mainPort,
		challenge: 'a'.repeat(43),
		buildIdentity: 'proctor-build-identity-0001',
		participationGeneration: 'participation-generation-0001',
		collectionSessionId: 'collection-session-0001',
		queueCapacity: 2,
		selectedSources,
		selectedSourceCategories,
		initialCandidateWindow: candidateWindow,
		onPoll: () => undefined,
		onFailure: (failure) => failures.push(failure)
	});
	host.start();
	await client.start();
	client.sendCandidateWindowEvent({ kind: 'close_attempt' });
	client.sendCandidateWindowEvent({ kind: 'close_attempt' });
	await waitUntil(() => calls === 2);
	await client.shutdown(candidateWindow);

	assert.deepEqual(failures, []);
});

void test('supervisor polls do not conceal a missing utility heartbeat', async () => {
	const [mainPort, utilityPort] = memoryPortPair();
	let nextSequence = 1;
	utilityPort.onMessage((message) => {
		if (
			typeof message !== 'object' ||
			message === null ||
			Reflect.get(message, 'kind') !== 'bootstrap'
		)
			return;
		utilityPort.postMessage({
			kind: 'ready',
			protocol_version: 1,
			message_sequence: 0,
			challenge_response: 'a'.repeat(43),
			build_identity: 'proctor-build-identity-0001',
			source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST,
			selected_sources: selectedSources,
			selected_source_categories: selectedSourceCategories,
			participation_generation: 'participation-generation-0001',
			delivered_at_wall_time_unix_ms: 1,
			snapshots
		});
	});
	utilityPort.start();
	const failures: string[] = [];
	const client = new SecurityUtilityClient({
		port: mainPort,
		challenge: 'a'.repeat(43),
		buildIdentity: 'proctor-build-identity-0001',
		participationGeneration: 'participation-generation-0001',
		collectionSessionId: 'collection-session-0001',
		queueCapacity: 2,
		selectedSources,
		selectedSourceCategories,
		initialCandidateWindow: candidateWindow,
		onPoll: () => undefined,
		onFailure: (failure) => failures.push(failure)
	});
	await client.start();
	const pollTimer = setInterval(() => {
		utilityPort.postMessage({
			kind: 'native_poll',
			protocol_version: 1,
			message_sequence: nextSequence,
			participation_generation: 'participation-generation-0001',
			delivered_at_wall_time_unix_ms: 1,
			poll: {
				state: 'healthy',
				opened_snapshots: [],
				batches: [],
				final_snapshots: [],
				transitions: []
			}
		});
		nextSequence += 1;
	}, 100);
	try {
		await waitUntil(() => failures.includes('heartbeat_timeout'), 3_000);
	} finally {
		clearInterval(pollTimer);
	}
});

void test('utility fails closed when the main side does not acknowledge bounded output', async () => {
	const [mainPort, utilityPort] = memoryPortPair();
	let healthy = false;
	const driver: NativeBaselineDriver = {
		manifest: () => ({
			bridge_version: 1,
			source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST
		}),
		openBaseline: () => ({ snapshots }),
		candidateWindowEvent: () => 'accepted',
		candidateWindowEventsLost: () => 'accepted',
		pollBaseline: () => {
			healthy = !healthy;
			return {
				state: healthy ? 'healthy' : 'degraded',
				opened_snapshots: [],
				final_snapshots: [],
				batches: [],
				transitions: []
			};
		},
		stopBaseline: () => ({
			state: 'stopped',
			batches: [],
			final_snapshots: [],
			process_replacement_required: false
		})
	};
	const childMessages: unknown[] = [];
	let utilityExitCode: number | undefined;
	mainPort.onMessage((message) => childMessages.push(message));
	mainPort.start();
	const host = new SecurityUtilityHost({
		port: utilityPort,
		driver,
		buildIdentity: 'proctor-build-identity-0001',
		terminate: (code) => {
			utilityExitCode = code;
		}
	});
	host.start();
	mainPort.postMessage(validBootstrap());
	await waitUntil(() =>
		childMessages.some((message) => isFatalCode(message, 'outbound_backpressure'))
	);
	assert.equal(utilityExitCode, 70);
});

void test('main fails closed when a supervisor poll cannot be delivered', async () => {
	const [mainPort, utilityPort] = memoryPortPair();
	const driver: NativeBaselineDriver = {
		manifest: () => ({
			bridge_version: 1,
			source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST
		}),
		openBaseline: () => ({ snapshots }),
		candidateWindowEvent: () => 'accepted',
		candidateWindowEventsLost: () => 'accepted',
		pollBaseline: () => ({
			state: 'healthy',
			opened_snapshots: [],
			final_snapshots: [],
			batches: [],
			transitions: []
		}),
		stopBaseline: () => ({
			state: 'stopped',
			batches: [],
			final_snapshots: [],
			process_replacement_required: false
		})
	};
	let utilityExitCode: number | undefined;
	const host = new SecurityUtilityHost({
		port: utilityPort,
		driver,
		buildIdentity: 'proctor-build-identity-0001',
		terminate: (code) => {
			utilityExitCode = code;
		}
	});
	const failures: string[] = [];
	const client = new SecurityUtilityClient({
		port: mainPort,
		challenge: 'a'.repeat(43),
		buildIdentity: 'proctor-build-identity-0001',
		participationGeneration: 'participation-generation-0001',
		collectionSessionId: 'collection-session-0001',
		queueCapacity: 32,
		selectedSources,
		selectedSourceCategories,
		initialCandidateWindow: candidateWindow,
		onPoll: () => {
			throw new Error('coordinator rejected poll');
		},
		onFailure: (failure) => failures.push(failure)
	});
	host.start();
	await client.start();
	await waitUntil(() => failures.includes('poll_delivery_failed'));
	assert.equal(utilityExitCode, 70);
});

function memoryPortPair(): readonly [SecurityUtilityPort, SecurityUtilityPort] {
	const left = new MemoryPort();
	const right = new MemoryPort();
	left.connect(right);
	right.connect(left);
	return [left, right];
}

class MemoryPort implements SecurityUtilityPort {
	readonly #messageListeners = new Set<(message: unknown) => void>();
	readonly #closeListeners = new Set<() => void>();
	#remote: MemoryPort | undefined;
	#closed = false;

	public connect(remote: MemoryPort): void {
		this.#remote = remote;
	}

	public postMessage(message: unknown): void {
		if (this.#closed || this.#remote === undefined) throw new Error('closed port');
		const remote = this.#remote;
		queueMicrotask(() => remote.#deliver(message));
	}

	public onMessage(listener: (message: unknown) => void): { readonly dispose: () => void } {
		this.#messageListeners.add(listener);
		return { dispose: () => this.#messageListeners.delete(listener) };
	}

	public onClose(listener: () => void): { readonly dispose: () => void } {
		this.#closeListeners.add(listener);
		return { dispose: () => this.#closeListeners.delete(listener) };
	}

	public start(): void {}

	public close(): void {
		if (this.#closed) return;
		this.#closed = true;
		const remote = this.#remote;
		queueMicrotask(() => {
			if (remote) remote.#remoteClosed();
		});
	}

	#deliver(message: unknown): void {
		if (this.#closed) return;
		for (const listener of this.#messageListeners) listener(message);
	}

	#remoteClosed(): void {
		for (const listener of this.#closeListeners) listener();
	}
}

function eventLoopTurn(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 10));
}

function validBootstrap(): unknown {
	return {
		kind: 'bootstrap',
		protocol_version: 1,
		challenge: 'a'.repeat(43),
		build_identity: 'proctor-build-identity-0001',
		source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST,
		participation_generation: 'participation-generation-0001',
		collection_session_id: 'collection-session-0001',
		queue_capacity: 32,
		selected_sources: selectedSources,
		selected_source_categories: selectedSourceCategories,
		initial_candidate_window: candidateWindow
	};
}

function isFatalCode(value: unknown, code: string): boolean {
	return (
		typeof value === 'object' &&
		value !== null &&
		Reflect.get(value, 'kind') === 'fatal' &&
		Reflect.get(value, 'code') === code
	);
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error('timed out waiting for utility failure');
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	await eventLoopTurn();
}

void test('supervisor final snapshots survive strict poll and stop validation', () => {
	const final = {
		...snapshots[0],
		snapshot: { ...snapshots[0].snapshot, health: 'stopped', sequence: 3 }
	};
	const poll = {
		state: 'degraded',
		opened_snapshots: [],
		final_snapshots: [final],
		batches: [],
		transitions: []
	};
	const stop = {
		state: 'stopped',
		final_snapshots: [final],
		batches: [],
		process_replacement_required: false
	};
	assert.equal(isNativeSupervisorPoll(poll), true);
	assert.equal(isNativeSupervisorStop(stop), true);
	for (const final_snapshots of [
		undefined,
		null,
		Array(SECURITY_UTILITY_SOURCE_COUNT + 1).fill(final),
		[{ ...final, snapshot: { ...final.snapshot, sequence: -1 } }]
	]) {
		assert.equal(isNativeSupervisorPoll({ ...poll, final_snapshots }), false);
		assert.equal(isNativeSupervisorStop({ ...stop, final_snapshots }), false);
	}
});

void test('a simultaneous failure poll retains both helper loss fences within its bounded envelope', () => {
	const batches = snapshots.flatMap(({ source, snapshot }) => {
		const drain = {
			source,
			batch: {
				source_instance_id: snapshot.source_instance_id,
				health: 'failed',
				terminal_error: 'backend',
				observations: [],
				resets: []
			}
		};
		if (source !== 'process-application' && source !== 'interactive-session') {
			return [drain, drain];
		}
		return [
			drain,
			{
				source,
				batch: {
					...drain.batch,
					resets: [
						{
							source_instance_id: snapshot.source_instance_id,
							sequence: 2,
							observed_at: timestamp,
							gap: { first_missing: 1, last_missing: 1 },
							reason: 'native-helper-event-loss'
						}
					]
				}
			},
			drain
		];
	});
	const poll = {
		state: 'degraded',
		opened_snapshots: [],
		final_snapshots: [],
		transitions: [],
		batches
	};
	assert.equal(batches.length, SECURITY_UTILITY_SOURCE_COUNT * 2 + 2);
	assert.equal(isNativeSupervisorPoll(poll), true);
	assert.equal(isNativeSupervisorPoll({ ...poll, batches: [...batches, batches[0]] }), false);
});
