import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCaptureSessionDrain,
  isCaptureSessionObservation,
  isCaptureSessionState
} from '../../src/prctr/platform/native/common/nativeObservation.generated.ts';

const unsupported = {
  support: 'unsupported',
  activity: 'unknown',
  certainty: 'unknown'
};

const inactiveRemote = {
  support: 'supported',
  activity: 'inactive',
  certainty: 'complete'
};

const state = {
  screen_capture: unsupported,
  native_remote_session: inactiveRemote
};

test('generated capture-session validator accepts explicit mixed OS coverage', () => {
  assert.equal(isCaptureSessionState(state), true);
  assert.equal(isCaptureSessionState({
    screen_capture: unsupported,
    native_remote_session: unsupported
  }), true);
});

test('unsupported and complete signals cannot overstate activity or certainty', () => {
  assert.equal(isCaptureSessionState({
    ...state,
    screen_capture: { support: 'unsupported', activity: 'active', certainty: 'complete' }
  }), false);
  assert.equal(isCaptureSessionState({
    ...state,
    native_remote_session: { support: 'supported', activity: 'unknown', certainty: 'complete' }
  }), false);
  assert.equal(isCaptureSessionState({
    ...state,
    native_remote_session: { support: 'supported', activity: 'active', certainty: 'unknown' }
  }), false);
});

test('capture-session observations require exact adjacent gap boundaries', () => {
  const observation = {
    source_instance_id: 'capture-session-source-0001',
    sequence: 3,
    observed_at: { monotonic_time_ns: 1 },
    gap: { first_missing: 1, last_missing: 2 },
    state
  };
  assert.equal(isCaptureSessionObservation(observation), true);
  assert.equal(isCaptureSessionObservation({
    ...observation,
    gap: { first_missing: 1, last_missing: 1 }
  }), false);
});

test('capture-session drains fence source identity and terminal health', () => {
  const observation = {
    source_instance_id: 'capture-session-source-0001',
    sequence: 1,
    observed_at: { monotonic_time_ns: 1 },
    state
  };
  const drain = {
    source_instance_id: 'capture-session-source-0001',
    health: 'healthy',
    observations: [observation],
    resets: []
  };
  assert.equal(isCaptureSessionDrain(drain), true);
  assert.equal(isCaptureSessionDrain({
    ...drain,
    source_instance_id: 'different-source-0000001'
  }), false);
  assert.equal(isCaptureSessionDrain({
    ...drain,
    health: 'failed'
  }), false);
});
