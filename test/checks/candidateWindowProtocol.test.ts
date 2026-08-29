import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isCandidateWindowDrain,
  isCandidateWindowHostEvent,
  isCandidateWindowObservation,
  isCandidateWindowSourceSnapshot,
  isCandidateWindowState
} from '../../src/prctr/platform/native/common/nativeObservation.generated.ts';

const windowState = {
  certainty: 'complete',
  presence: 'present',
  focus: 'focused',
  visibility: 'visible',
  placement: 'maximized',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  display_target_id: 'display-1'
} as const;

const observedAt = {
  wall_time_unix_ms: 1,
  monotonic_time_ns: 1
} as const;

test('generated CandidateWindow validator accepts one coherent mechanical state', () => {
  assert.equal(isCandidateWindowState(windowState), true);
  assert.equal(isCandidateWindowSourceSnapshot({
    source_instance_id: 'source-instance-0001',
    source_version: '0.1.0',
    adapter_version: 'utility-post-ipc-v1',
    schema_version: 1,
    platform: 'macos',
    permission: 'granted',
    health: 'healthy',
    sequence: 0,
    observed_at: observedAt,
    window: windowState
  }), true);
});

test('generated CandidateWindow host-event validator keeps utility ingress mechanical and typed', () => {
  assert.equal(isCandidateWindowHostEvent({
    kind: 'state_transition',
    window: windowState
  }), true);
  assert.equal(isCandidateWindowHostEvent({
    kind: 'close_attempt'
  }), true);
  assert.equal(isCandidateWindowHostEvent({
    kind: 'close_attempt',
    window: windowState
  }), false);
  assert.equal(isCandidateWindowHostEvent({
    kind: 'state_refresh'
  }), false);
});

test('generated CandidateWindow validator rejects contradictory absence and unsafe bounds', () => {
  assert.equal(isCandidateWindowState({
    ...windowState,
    presence: 'absent'
  }), false);
  assert.equal(isCandidateWindowState({
    ...windowState,
    bounds: { x: 0, y: 0, width: 0, height: 1080 }
  }), false);
  assert.equal(isCandidateWindowState({
    ...windowState,
    focus: 'unknown'
  }), false);
  assert.equal(isCandidateWindowState({
    certainty: 'complete',
    presence: 'absent',
    focus: 'not_focused',
    visibility: 'not_visible',
    placement: 'unknown'
  }), true);
});

test('generated CandidateWindow observation validator requires exact gap adjacency', () => {
  const observation = {
    source_instance_id: 'source-instance-0001',
    sequence: 3,
    observed_at: observedAt,
    gap: { first_missing: 1, last_missing: 2 },
    event: {
      window: windowState,
      close_attempts_since_previous: 1
    }
  } as const;
  assert.equal(isCandidateWindowObservation(observation), true);
  assert.equal(isCandidateWindowObservation({
    ...observation,
    gap: { first_missing: 1, last_missing: 1 }
  }), false);
});

test('generated CandidateWindow drain validator fences identity, order, and terminal health', () => {
  const observation = {
    source_instance_id: 'source-instance-0001',
    sequence: 1,
    observed_at: observedAt,
    event: {
      window: windowState,
      close_attempts_since_previous: 0
    }
  } as const;
  assert.equal(isCandidateWindowDrain({
    source_instance_id: 'source-instance-0001',
    health: 'healthy',
    observations: [observation],
    resets: []
  }), true);
  assert.equal(isCandidateWindowDrain({
    source_instance_id: 'source-instance-0001',
    health: 'healthy',
    observations: [{ ...observation, source_instance_id: 'different-instance' }],
    resets: []
  }), false);
  assert.equal(isCandidateWindowDrain({
    source_instance_id: 'source-instance-0001',
    health: 'failed',
    observations: [],
    resets: []
  }), false);
  assert.equal(isCandidateWindowDrain({
    source_instance_id: 'source-instance-0001',
    health: 'failed',
    observations: [],
    resets: [],
    terminal_error: 'backend'
  }), true);
});

test('generated CandidateWindow arrays reject sparse and inherited entries', () => {
  const sparse = new Array(1);
  assert.equal(isCandidateWindowDrain({
    source_instance_id: 'source-instance-0001',
    health: 'healthy',
    observations: sparse,
    resets: []
  }), false);

  const inherited = Object.create({
    source_instance_id: 'source-instance-0001',
    health: 'healthy',
    observations: [],
    resets: []
  }) as unknown;
  assert.equal(isCandidateWindowDrain(inherited), false);
});
