import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	isDisplayTopologyDrain,
	isDisplayTopologyObservation,
	isHelperObservation,
	isHelperServiceRequest,
	isHelperServiceResponse,
	isHelperServiceWorkerBootstrap,
	isProcessApplicationObservation,
	isSourceOpenRequest,
	isSourceReset
} from '../../src/prctr/platform/native/common/nativeObservation.generated.ts';

void test('service lifecycle controls reject malformed and identity-bearing wire messages', () => {
	const envelope = { protocol_version: 1, channel_nonce: 'a0'.repeat(32) };
	for (const [validate, kinds] of [
		[isHelperServiceRequest, ['open', 'attach', 'stop']],
		[isHelperServiceResponse, ['ready', 'started', 'stopped']]
	] as const) {
		for (const kind of kinds) assert.equal(validate({ ...envelope, kind }), true);
		const valid = { ...envelope, kind: kinds[0] };
		for (const patch of [
			{ protocol_version: 0 },
			{ protocol_version: 2 },
			{ protocol_version: 1.5 },
			{ channel_nonce: 'A'.repeat(64) },
			{ channel_nonce: 'g'.repeat(64) },
			{ channel_nonce: 'a'.repeat(63) },
			{ channel_nonce: 'a'.repeat(65) },
			{ channel_nonce: null },
			{ kind: 'launch' },
			{ kind: null },
			{ pid: 42 },
			{ audit_session_id: 42 },
			{ uid: 501 },
			{ extra: true }
		])
			assert.equal(validate({ ...valid, ...patch }), false);
		for (const missing of Object.keys(valid)) {
			assert.equal(
				validate(
					Object.fromEntries(Object.entries(valid).filter(([key]) => key !== missing))
				),
				false
			);
		}
	}
});

void test('service worker bootstrap bounds the code requirement and admits no caller identity', () => {
	const valid = {
		protocol_version: 1,
		channel_nonce: '0a'.repeat(32),
		client_designated_requirement: 'anchor apple generic'
	};
	for (const requirement of ['a', 'a'.repeat(2048), '😀'.repeat(2048)]) {
		assert.equal(
			isHelperServiceWorkerBootstrap({
				...valid,
				client_designated_requirement: requirement
			}),
			true
		);
	}
	for (const patch of [
		{ protocol_version: 2 },
		{ channel_nonce: 'A'.repeat(64) },
		{ client_designated_requirement: '' },
		{ client_designated_requirement: 'a'.repeat(2049) },
		{ client_designated_requirement: '😀'.repeat(2049) },
		{ client_designated_requirement: null },
		{ client_designated_requirement: 42 },
		{ pid: 42 },
		{ audit_session_id: 42 },
		{ uid: 501 }
	])
		assert.equal(isHelperServiceWorkerBootstrap({ ...valid, ...patch }), false);
	for (const missing of Object.keys(valid)) {
		assert.equal(
			isHelperServiceWorkerBootstrap(
				Object.fromEntries(Object.entries(valid).filter(([key]) => key !== missing))
			),
			false
		);
	}
});

void test('deferred process facts preserve bounded capture delay in source and helper clocks', () => {
	const event = { kind: 'exited', process_instance_id: 'process-instance-0001' };
	const source = {
		source_instance_id: 'process-source-0001',
		sequence: 1,
		observed_at: { monotonic_time_ns: 10 },
		event
	};
	const helper = {
		protocol_version: 1,
		channel_nonce: 'a'.repeat(64),
		helper_source_instance_id: 'process-source-0001',
		source_kind: 'process_application',
		sequence: 1,
		monotonic_time_ns: 10,
		process_event: event
	};
	assert.equal(isProcessApplicationObservation(source), true);
	assert.equal(isHelperObservation(helper), true);
	for (const delay of [0, 7, 10, 11, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, undefined]) {
		const delayedEvent = { ...event, capture_delay_ns: delay };
		const expected = typeof delay === 'number' && [0, 7, 10].includes(delay);
		assert.equal(isProcessApplicationObservation({ ...source, event: delayedEvent }), expected);
		assert.equal(isHelperObservation({ ...helper, process_event: delayedEvent }), expected);
	}
});

const topology = {
	certainty: 'complete',
	targets: [
		{
			target_id: 'display-1',
			active: true,
			primary_state: 'primary',
			builtin: true,
			power_state: 'awake',
			kind: 'physical',
			pixel_width: 1920,
			pixel_height: 1080
		}
	]
} as const;

void test('generated source-open validator enforces wire shape and Unicode length', () => {
	assert.equal(
		isSourceOpenRequest({
			collection_session_id: 'collection-session-0001',
			requested_schema_version: 1,
			queue_capacity: 16
		}),
		true
	);
	assert.equal(
		isSourceOpenRequest({
			collection_session_id: '🦀🦀🦀🦀🦀🦀🦀🦀',
			requested_schema_version: 1,
			queue_capacity: 16
		}),
		false
	);
	const inherited = Object.create({
		collection_session_id: 'collection-session-0001',
		requested_schema_version: 1,
		queue_capacity: 16
	}) as unknown;
	assert.equal(isSourceOpenRequest(inherited), false);
	assert.equal(
		isSourceOpenRequest({
			collection_session_id: 'collection-session-0001',
			requested_schema_version: 1,
			queue_capacity: 16,
			unexpected: true
		}),
		false
	);
	assert.equal(
		isSourceOpenRequest({
			collection_session_id: 'x'.repeat(1_000_000),
			requested_schema_version: 1,
			queue_capacity: 16
		}),
		false
	);
	const propertyStorm: Record<string, unknown> = {
		collection_session_id: 'collection-session-0001',
		requested_schema_version: 1,
		queue_capacity: 16
	};
	for (let index = 0; index < 10_000; index += 1) propertyStorm[`unexpected_${index}`] = true;
	assert.equal(isSourceOpenRequest(propertyStorm), false);
});

void test('generated observation validator checks nested values and safe integers', () => {
	const valid = {
		source_instance_id: 'source-instance-0001',
		sequence: 1,
		observed_at: { monotonic_time_ns: 1 },
		topology
	};
	assert.equal(isDisplayTopologyObservation(valid), true);
	assert.equal(
		isDisplayTopologyObservation({
			...valid,
			sequence: Number.MAX_SAFE_INTEGER + 1
		}),
		false
	);
	assert.equal(
		isDisplayTopologyObservation({
			...valid,
			topology: { ...topology, targets: new Array(1) }
		}),
		false
	);
	assert.equal(
		isDisplayTopologyObservation({
			...valid,
			topology: {
				...topology,
				targets: Object.assign([...topology.targets], { unexpected: true })
			}
		}),
		false
	);
	assert.equal(
		isDisplayTopologyObservation({
			...valid,
			sequence: 4,
			gap: { first_missing: 3, last_missing: 4 }
		}),
		false
	);
	assert.equal(
		isDisplayTopologyObservation({
			...valid,
			sequence: 4,
			gap: { first_missing: 1, last_missing: 2 }
		}),
		false
	);
	assert.equal(
		isDisplayTopologyObservation({
			...valid,
			topology: {
				...topology,
				targets: [{ ...topology.targets[0], pixel_width: 262_145 }]
			}
		}),
		false
	);
	assert.equal(
		isDisplayTopologyObservation({
			...valid,
			gap: { first_missing: 4, last_missing: 3 }
		}),
		false
	);
	assert.equal(
		isDisplayTopologyObservation({
			...valid,
			topology: {
				...topology,
				targets: [topology.targets[0], topology.targets[0]]
			}
		}),
		false
	);
	assert.equal(
		isDisplayTopologyObservation({
			...valid,
			topology: {
				...topology,
				targets: [{ ...topology.targets[0], mirror_primary_id: 'missing-display' }]
			}
		}),
		false
	);
});

void test('generated reset validator rejects optional-field and reason violations', () => {
	const valid = {
		source_instance_id: 'source-instance-0001',
		sequence: 2,
		observed_at: { monotonic_time_ns: 2 },
		reason: 'adapter restarted'
	};
	assert.equal(isSourceReset(valid), true);
	assert.equal(isSourceReset({ ...valid, gap: undefined }), false);
	assert.equal(isSourceReset({ ...valid, reason: 'x'.repeat(129) }), false);
});

void test('generated drain validator bounds dynamic health and terminal state', () => {
	const observation = {
		source_instance_id: 'source-instance-0001',
		sequence: 2,
		observed_at: { monotonic_time_ns: 2 },
		topology
	};
	const reset = {
		source_instance_id: 'source-instance-0001',
		sequence: 1,
		observed_at: { monotonic_time_ns: 1 },
		reason: 'adapter restarted'
	};
	const valid = {
		source_instance_id: 'source-instance-0001',
		health: 'failed',
		observations: [observation],
		resets: [reset],
		terminal_error: 'queue_overflow'
	};
	assert.equal(isDisplayTopologyDrain(valid), true);
	assert.equal(
		isDisplayTopologyDrain({ ...valid, terminal_error: 'raw backend details' }),
		false
	);
	assert.equal(
		isDisplayTopologyDrain({ ...valid, observations: Array.from({ length: 1025 }) }),
		false
	);
	assert.equal(isDisplayTopologyDrain({ ...valid, observations: new Array(1) }), false);
	assert.equal(isDisplayTopologyDrain({ ...valid, health: 'healthy' }), false);
	assert.equal(isDisplayTopologyDrain({ ...valid, terminal_error: undefined }), false);
	assert.equal(
		isDisplayTopologyDrain({
			...valid,
			observations: [{ ...observation, source_instance_id: 'different-instance' }]
		}),
		false
	);
	assert.equal(
		isDisplayTopologyDrain({
			...valid,
			observations: [{ ...observation, sequence: 1 }]
		}),
		false
	);
	assert.equal(
		isDisplayTopologyDrain({
			...valid,
			observations: [
				{ ...observation, sequence: 3 },
				{ ...observation, sequence: 2 }
			]
		}),
		false
	);
	assert.equal(
		isDisplayTopologyDrain({
			...valid,
			resets: [],
			observations: [
				{ ...observation, sequence: 1 },
				{ ...observation, sequence: 3 }
			]
		}),
		false
	);
	assert.equal(
		isDisplayTopologyDrain({
			...valid,
			resets: [],
			observations: [
				{ ...observation, sequence: 1 },
				{ ...observation, sequence: 3, gap: { first_missing: 2, last_missing: 2 } }
			]
		}),
		true
	);
});
