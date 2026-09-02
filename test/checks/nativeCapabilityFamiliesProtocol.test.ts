import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	NATIVE_SOURCE_CATEGORY_ORDER,
	isClipboardState,
	isHelperClientMessage,
	isHelperHandshake,
	isHelperObservation,
	isHelperServerMessage,
	isHelperSourceFailure,
	isHelperSourceOpen,
	isHelperSourceSnapshot,
	isInteractiveSessionState,
	isMediaDeviceState,
	isNetworkConfigurationState,
	isPrintSpoolerState,
	isRemovableStorageState,
	isVirtualizationState
} from '../../src/prctr/platform/native/common/nativeObservation.generated.ts';

const helperNonce = '0123456789abcdef'.repeat(4);

void test('native source category order is generated from the shared protocol authority', () => {
	assert.deepEqual(NATIVE_SOURCE_CATEGORY_ORDER, [
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
	]);
});

void test('unavailable family states are explicit and cannot carry partial facts', () => {
	assert.equal(
		isInteractiveSessionState({
			coverage: 'unavailable',
			certainty: 'unknown',
			console_ownership: 'unknown',
			lock_state: 'unknown',
			remote_attachment: 'unknown',
			other_human_session_count: 0
		}),
		true
	);
	assert.equal(
		isInteractiveSessionState({
			coverage: 'unavailable',
			certainty: 'unknown',
			console_ownership: 'candidate',
			lock_state: 'unknown',
			remote_attachment: 'unknown',
			other_human_session_count: 0
		}),
		false
	);

	assert.equal(
		isClipboardState({
			coverage: 'unavailable',
			certainty: 'unknown',
			change_generation: 0
		}),
		true
	);
	assert.equal(
		isClipboardState({
			coverage: 'unavailable',
			certainty: 'unknown',
			change_generation: 1
		}),
		false
	);

	assert.equal(
		isPrintSpoolerState({
			coverage: 'unavailable',
			certainty: 'unknown',
			candidate_job_count: 0,
			other_job_count: 0,
			unknown_job_count: 0
		}),
		true
	);
	assert.equal(
		isPrintSpoolerState({
			coverage: 'unavailable',
			certainty: 'unknown',
			candidate_job_count: 1,
			other_job_count: 0,
			unknown_job_count: 0
		}),
		false
	);

	assert.equal(
		isRemovableStorageState({
			coverage: 'unavailable',
			certainty: 'unknown',
			attached_functions: []
		}),
		true
	);
	assert.equal(
		isRemovableStorageState({
			coverage: 'unavailable',
			certainty: 'unknown',
			attached_functions: [
				{
					function_instance_id: 'storage-function-0001',
					kind: 'block_storage',
					transport: 'usb',
					writability: 'writable',
					attachment: 'mounted'
				}
			]
		}),
		false
	);

	assert.equal(
		isVirtualizationState({
			coverage: 'unavailable',
			certainty: 'unknown',
			classification: 'unknown'
		}),
		true
	);
	assert.equal(
		isVirtualizationState({
			coverage: 'unavailable',
			certainty: 'unknown',
			classification: 'recognized_guest'
		}),
		false
	);

	assert.equal(
		isNetworkConfigurationState({
			coverage: 'unavailable',
			certainty: 'unknown',
			system_proxy: 'unknown',
			managed_vpn: 'unknown',
			tunnel_interfaces: [],
			route_generation: 0
		}),
		true
	);
	assert.equal(
		isNetworkConfigurationState({
			coverage: 'unavailable',
			certainty: 'unknown',
			system_proxy: 'active',
			managed_vpn: 'unknown',
			tunnel_interfaces: [],
			route_generation: 0
		}),
		false
	);
});

void test('complete family states reject internal uncertainty and duplicate identities', () => {
	assert.equal(
		isInteractiveSessionState({
			coverage: 'full_lifecycle',
			certainty: 'complete',
			console_ownership: 'candidate',
			lock_state: 'unlocked',
			remote_attachment: 'absent',
			other_human_session_count: 0
		}),
		true
	);
	assert.equal(
		isInteractiveSessionState({
			coverage: 'full_lifecycle',
			certainty: 'complete',
			console_ownership: 'candidate',
			lock_state: 'unknown',
			remote_attachment: 'absent',
			other_human_session_count: 0
		}),
		false
	);

	const storageFunction = {
		function_instance_id: 'storage-function-0001',
		kind: 'block_storage',
		transport: 'usb',
		writability: 'writable',
		attachment: 'mounted'
	} as const;
	assert.equal(
		isRemovableStorageState({
			coverage: 'block_only',
			certainty: 'complete',
			attached_functions: [storageFunction]
		}),
		true
	);
	assert.equal(
		isRemovableStorageState({
			coverage: 'block_only',
			certainty: 'complete',
			attached_functions: [storageFunction, storageFunction]
		}),
		false
	);
	assert.equal(
		isRemovableStorageState({
			coverage: 'block_only',
			certainty: 'complete',
			attached_functions: [
				{
					function_instance_id: 'portable-function-0001',
					kind: 'portable_mtp',
					transport: 'portable',
					writability: 'unknown',
					attachment: 'unknown'
				}
			]
		}),
		false
	);

	assert.equal(
		isPrintSpoolerState({
			coverage: 'monitored_scheduler',
			certainty: 'complete',
			candidate_job_count: 0,
			other_job_count: 0,
			unknown_job_count: 1
		}),
		false
	);
	assert.equal(
		isNetworkConfigurationState({
			coverage: 'full_configuration',
			certainty: 'complete',
			system_proxy: 'unknown',
			managed_vpn: 'inactive',
			tunnel_interfaces: [],
			route_generation: 1
		}),
		false
	);
});

void test('media facts describe readiness without accepting hidden content or overstated coverage', () => {
	const unavailableEndpoint = {
		coverage: 'unavailable',
		certainty: 'unknown',
		permission: 'unavailable',
		readiness: 'unknown',
		endpoint_count: 0,
		other_application_use: 'unknown'
	} as const;
	const readyEndpoint = {
		coverage: 'readiness_only',
		certainty: 'complete',
		permission: 'granted',
		readiness: 'ready',
		endpoint_count: 1,
		other_application_use: 'unknown'
	} as const;
	assert.equal(
		isMediaDeviceState({
			camera: unavailableEndpoint,
			microphone: readyEndpoint
		}),
		true
	);
	assert.equal(
		isMediaDeviceState({
			camera: { ...readyEndpoint, other_application_use: 'active' },
			microphone: readyEndpoint
		}),
		false
	);
	assert.equal(
		isMediaDeviceState({
			camera: { ...readyEndpoint, frame: 'forbidden-content' },
			microphone: readyEndpoint
		}),
		false
	);
});

void test('helper protocol is fixed, nonce-bound, policy-blind, and source-specific', () => {
	const interactiveState = {
		coverage: 'full_lifecycle',
		certainty: 'complete',
		console_ownership: 'candidate',
		lock_state: 'unlocked',
		remote_attachment: 'absent',
		other_human_session_count: 0
	} as const;
	assert.equal(
		isHelperHandshake({
			protocol_version: 1,
			channel_nonce: helperNonce,
			helper_kind: 'macos_endpoint_security_helper',
			helper_build_id: 'helper-build-0001',
			capabilities: ['process_application', 'interactive_session']
		}),
		true
	);
	assert.equal(
		isHelperHandshake({
			protocol_version: 1,
			channel_nonce: helperNonce.toUpperCase(),
			helper_kind: 'macos_endpoint_security_helper',
			helper_build_id: 'helper-build-0001',
			capabilities: ['process_application']
		}),
		false
	);
	assert.equal(
		isHelperSourceOpen({
			protocol_version: 1,
			channel_nonce: helperNonce,
			helper_source_instance_id: 'helper-source-0001',
			source_kind: 'interactive_session',
			schema_version: 1,
			queue_capacity: 16,
			event_classes: ['process_lifecycle']
		}),
		false
	);
	const helperOpen = {
		protocol_version: 1,
		channel_nonce: helperNonce,
		helper_source_instance_id: 'helper-source-0001',
		source_kind: 'interactive_session',
		schema_version: 1,
		queue_capacity: 16,
		event_classes: ['interactive_session_lifecycle']
	} as const;
	assert.equal(isHelperClientMessage({ kind: 'open', open: helperOpen }), true);
	assert.equal(
		isHelperClientMessage({
			kind: 'close',
			open: helperOpen,
			close: {
				protocol_version: 1,
				channel_nonce: helperNonce,
				helper_source_instance_id: 'helper-source-0001'
			}
		}),
		false
	);
	assert.equal(
		isHelperSourceSnapshot({
			protocol_version: 1,
			channel_nonce: helperNonce,
			helper_source_instance_id: 'helper-source-0001',
			source_kind: 'interactive_session',
			schema_version: 1,
			last_sequence: 0,
			monotonic_time_ns: 1,
			interactive_session_state: interactiveState
		}),
		true
	);
	assert.equal(
		isHelperServerMessage({
			kind: 'snapshot',
			snapshot: {
				protocol_version: 1,
				channel_nonce: helperNonce,
				helper_source_instance_id: 'helper-source-0001',
				source_kind: 'interactive_session',
				schema_version: 1,
				last_sequence: 0,
				monotonic_time_ns: 1,
				interactive_session_state: interactiveState
			}
		}),
		true
	);
	assert.equal(
		isHelperServerMessage({
			kind: 'snapshot',
			snapshot: {
				protocol_version: 1,
				channel_nonce: helperNonce,
				helper_source_instance_id: 'helper-source-0001',
				source_kind: 'interactive_session',
				schema_version: 1,
				last_sequence: 0,
				monotonic_time_ns: 1,
				interactive_session_state: interactiveState
			},
			failure: {
				protocol_version: 1,
				channel_nonce: helperNonce,
				helper_source_instance_id: 'helper-source-0001',
				source_kind: 'interactive_session',
				failure_code: 'backend',
				last_sequence: 0,
				monotonic_time_ns: 2
			}
		}),
		false
	);
	assert.equal(
		isHelperSourceSnapshot({
			protocol_version: 1,
			channel_nonce: helperNonce,
			helper_source_instance_id: 'helper-source-0001',
			source_kind: 'interactive_session',
			schema_version: 1,
			last_sequence: 0,
			monotonic_time_ns: 1,
			process_state: {
				coverage: 'full_lifecycle',
				certainty: 'complete',
				processes: []
			}
		}),
		false
	);
	assert.equal(
		isHelperSourceFailure({
			protocol_version: 1,
			channel_nonce: helperNonce,
			helper_source_instance_id: 'helper-source-0001',
			source_kind: 'interactive_session',
			failure_code: 'native_event_loss',
			last_sequence: 0,
			lost_event_count: 2,
			monotonic_time_ns: 2
		}),
		true
	);
	assert.equal(
		isHelperSourceFailure({
			protocol_version: 1,
			channel_nonce: helperNonce,
			helper_source_instance_id: 'helper-source-0001',
			source_kind: 'interactive_session',
			failure_code: 'backend',
			last_sequence: 0,
			lost_event_count: 2,
			monotonic_time_ns: 2
		}),
		false
	);
	assert.equal(
		isHelperObservation({
			protocol_version: 1,
			channel_nonce: helperNonce,
			helper_source_instance_id: 'helper-source-0001',
			source_kind: 'interactive_session',
			sequence: 1,
			monotonic_time_ns: 1,
			interactive_session_event: {
				kind: 'changed',
				state: interactiveState
			}
		}),
		true
	);
	assert.equal(
		isHelperObservation({
			protocol_version: 1,
			channel_nonce: helperNonce,
			helper_source_instance_id: 'helper-source-0001',
			source_kind: 'interactive_session',
			sequence: 1,
			monotonic_time_ns: 1,
			attempt_id: 'forbidden-context'
		}),
		false
	);
});
