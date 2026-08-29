import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isDisplayTopologyDrain,
  isDisplayTopologyObservation,
  isSourceOpenRequest,
  isSourceReset
} from '../../src/prctr/platform/native/common/nativeObservation.generated.ts';

const topology = {
  certainty: 'complete',
  targets: [{
    target_id: 'display-1',
    active: true,
    primary_state: 'primary',
    builtin: true,
    power_state: 'awake',
    kind: 'physical',
    pixel_width: 1920,
    pixel_height: 1080
  }]
} as const;

test('generated source-open validator enforces wire shape and Unicode length', () => {
  assert.equal(isSourceOpenRequest({
    collection_session_id: 'collection-session-0001',
    requested_schema_version: 1,
    queue_capacity: 16
  }), true);
  assert.equal(isSourceOpenRequest({
    collection_session_id: '🦀🦀🦀🦀🦀🦀🦀🦀',
    requested_schema_version: 1,
    queue_capacity: 16
  }), false);
  const inherited = Object.create({
    collection_session_id: 'collection-session-0001',
    requested_schema_version: 1,
    queue_capacity: 16
  }) as unknown;
  assert.equal(isSourceOpenRequest(inherited), false);
  assert.equal(isSourceOpenRequest({
    collection_session_id: 'collection-session-0001',
    requested_schema_version: 1,
    queue_capacity: 16,
    unexpected: true
  }), false);
  assert.equal(isSourceOpenRequest({
    collection_session_id: 'x'.repeat(1_000_000),
    requested_schema_version: 1,
    queue_capacity: 16
  }), false);
  const propertyStorm: Record<string, unknown> = {
    collection_session_id: 'collection-session-0001',
    requested_schema_version: 1,
    queue_capacity: 16
  };
  for (let index = 0; index < 10_000; index += 1) propertyStorm[`unexpected_${index}`] = true;
  assert.equal(isSourceOpenRequest(propertyStorm), false);
});

test('generated observation validator checks nested values and safe integers', () => {
  const valid = {
    source_instance_id: 'source-instance-0001',
    sequence: 1,
    observed_at: { wall_time_unix_ms: 1, monotonic_time_ns: 1 },
    topology
  };
  assert.equal(isDisplayTopologyObservation(valid), true);
  assert.equal(isDisplayTopologyObservation({
    ...valid,
    sequence: Number.MAX_SAFE_INTEGER + 1
  }), false);
  assert.equal(isDisplayTopologyObservation({
    ...valid,
    topology: { ...topology, targets: new Array(1) }
  }), false);
  assert.equal(isDisplayTopologyObservation({
    ...valid,
    topology: {
      ...topology,
      targets: Object.assign([...topology.targets], { unexpected: true })
    }
  }), false);
  assert.equal(isDisplayTopologyObservation({
    ...valid,
    sequence: 4,
    gap: { first_missing: 3, last_missing: 4 }
  }), false);
  assert.equal(isDisplayTopologyObservation({
    ...valid,
    sequence: 4,
    gap: { first_missing: 1, last_missing: 2 }
  }), false);
  assert.equal(isDisplayTopologyObservation({
    ...valid,
    topology: {
      ...topology,
      targets: [{ ...topology.targets[0], pixel_width: 262_145 }]
    }
  }), false);
  assert.equal(isDisplayTopologyObservation({
    ...valid,
    gap: { first_missing: 4, last_missing: 3 }
  }), false);
  assert.equal(isDisplayTopologyObservation({
    ...valid,
    topology: {
      ...topology,
      targets: [topology.targets[0], topology.targets[0]]
    }
  }), false);
  assert.equal(isDisplayTopologyObservation({
    ...valid,
    topology: {
      ...topology,
      targets: [{ ...topology.targets[0], mirror_primary_id: 'missing-display' }]
    }
  }), false);
});

test('generated reset validator rejects optional-field and reason violations', () => {
  const valid = {
    source_instance_id: 'source-instance-0001',
    sequence: 2,
    observed_at: { wall_time_unix_ms: 1, monotonic_time_ns: 2 },
    reason: 'adapter restarted'
  };
  assert.equal(isSourceReset(valid), true);
  assert.equal(isSourceReset({ ...valid, gap: undefined }), false);
  assert.equal(isSourceReset({ ...valid, reason: 'x'.repeat(129) }), false);
});

test('generated drain validator bounds dynamic health and terminal state', () => {
  const observation = {
    source_instance_id: 'source-instance-0001',
    sequence: 2,
    observed_at: { wall_time_unix_ms: 1, monotonic_time_ns: 2 },
    topology
  };
  const reset = {
    source_instance_id: 'source-instance-0001',
    sequence: 1,
    observed_at: { wall_time_unix_ms: 1, monotonic_time_ns: 1 },
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
  assert.equal(isDisplayTopologyDrain({ ...valid, terminal_error: 'raw backend details' }), false);
  assert.equal(isDisplayTopologyDrain({ ...valid, observations: Array.from({ length: 1025 }) }), false);
  assert.equal(isDisplayTopologyDrain({ ...valid, observations: new Array(1) }), false);
  assert.equal(isDisplayTopologyDrain({ ...valid, health: 'healthy' }), false);
  assert.equal(isDisplayTopologyDrain({ ...valid, terminal_error: undefined }), false);
  assert.equal(isDisplayTopologyDrain({
    ...valid,
    observations: [{ ...observation, source_instance_id: 'different-instance' }]
  }), false);
  assert.equal(isDisplayTopologyDrain({
    ...valid,
    observations: [{ ...observation, sequence: 1 }]
  }), false);
  assert.equal(isDisplayTopologyDrain({
    ...valid,
    observations: [{ ...observation, sequence: 3 }, { ...observation, sequence: 2 }]
  }), false);
  assert.equal(isDisplayTopologyDrain({
    ...valid,
    resets: [],
    observations: [{ ...observation, sequence: 1 }, { ...observation, sequence: 3 }]
  }), false);
  assert.equal(isDisplayTopologyDrain({
    ...valid,
    resets: [],
    observations: [
      { ...observation, sequence: 1 },
      { ...observation, sequence: 3, gap: { first_missing: 2, last_missing: 2 } }
    ]
  }), true);
});
