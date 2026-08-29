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

const timestamp = { wall_time_unix_ms: 1, monotonic_time_ns: 1 } as const;
const snapshots = {
  display_topology: {
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
      targets: [{
        target_id: 'security-test-display',
        active: true,
        primary_state: 'primary',
        builtin: true,
        power_state: 'awake',
        kind: 'physical',
        pixel_width: 1_440,
        pixel_height: 900
      }]
    }
  },
  candidate_window: {
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
  },
  capture_session: {
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
      screen_capture: { support: 'unsupported', activity: 'unknown', certainty: 'unknown' },
      native_remote_session: { support: 'unsupported', activity: 'unknown', certainty: 'unknown' }
    }
  }
} as const;

test('private bootstrap validator rejects unknown fields and manifest drift', () => {
  const bootstrap = {
    kind: 'bootstrap',
    protocol_version: 1,
    challenge: 'a'.repeat(43),
    build_identity: 'proctor-build-identity-0001',
    source_manifest_version: 1,
    source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST,
    participation_generation: 'participation-generation-0001',
    collection_session_id: 'collection-session-0001',
    queue_capacity: 32,
    initial_candidate_window: candidateWindow
  };
  assert.equal(isSecurityUtilityBootstrap(bootstrap), true);
  assert.equal(isSecurityUtilityBootstrap({ ...bootstrap, unexpected: true }), false);
  assert.equal(isSecurityUtilityBootstrap({
    ...bootstrap,
    source_manifest: [...SECURITY_UTILITY_SOURCE_MANIFEST].reverse()
  }), false);
});

test('native bridge admission compares the generated per-source schema manifest', () => {
  const manifest = {
    bridge_version: 1,
    source_manifest_version: 1,
    source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST
  };
  assert.equal(isNativeBridgeManifest(manifest), true);
  assert.equal(isNativeBridgeManifest({
    ...manifest,
    source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST.map((source, index) => (
      index === 1 ? { ...source, schema_version: source.schema_version + 1 } : source
    ))
  }), false);
});

test('outer lifecycle budgets cover full native work and transport margin', () => {
  assert.equal(SECURITY_UTILITY_SOURCE_COUNT, SECURITY_UTILITY_SOURCE_MANIFEST.length);
  assert.equal(
    SECURITY_UTILITY_STARTUP_TIMEOUT_MS,
    (SECURITY_UTILITY_SOURCE_COUNT * 2 - 1)
      * SECURITY_UTILITY_NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS
      + SECURITY_UTILITY_LIFECYCLE_MARGIN_MS
  );
  assert.equal(
    SECURITY_UTILITY_SHUTDOWN_TIMEOUT_MS,
    SECURITY_UTILITY_SOURCE_COUNT * SECURITY_UTILITY_NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS
      + SECURITY_UTILITY_MAX_SHUTDOWN_INGRESS_ROUND_TRIPS
      * SECURITY_UTILITY_HEARTBEAT_TIMEOUT_MS
      + SECURITY_UTILITY_LIFECYCLE_MARGIN_MS
  );
});

test('main and utility complete the authenticated lifecycle over a private port', async () => {
  const [mainPort, utilityPort] = memoryPortPair();
  const acceptedEvents: unknown[] = [];
  const driver: NativeBaselineDriver = {
    manifest: () => ({
      bridge_version: 1,
      source_manifest_version: 1,
      source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST
    }),
    openBaseline: () => ({ snapshots }),
    candidateWindowEvent: event => {
      acceptedEvents.push(event);
      return 'accepted';
    },
    candidateWindowEventsLost: () => 'accepted',
    pollBaseline: () => ({
      state: 'healthy',
      opened_snapshots: [],
      batches: [],
      transitions: []
    }),
    stopBaseline: () => ({
      state: 'stopped',
      batches: [],
      process_replacement_required: false
    })
  };
  let utilityExitCode: number | undefined;
  const host = new SecurityUtilityHost({
    port: utilityPort,
    driver,
    buildIdentity: 'proctor-build-identity-0001',
    terminate: code => { utilityExitCode = code; }
  });
  const failures: string[] = [];
  const client = new SecurityUtilityClient({
    port: mainPort,
    challenge: 'a'.repeat(43),
    buildIdentity: 'proctor-build-identity-0001',
    participationGeneration: 'participation-generation-0001',
    collectionSessionId: 'collection-session-0001',
    queueCapacity: 32,
    initialCandidateWindow: candidateWindow,
    onPoll: () => undefined,
    onFailure: failure => failures.push(failure)
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

test('candidate ingress stays bounded and reports the exact sender-side loss count', async () => {
  const [mainPort, utilityPort] = memoryPortPair();
  const acceptedEvents: unknown[] = [];
  const lostCounts: number[] = [];
  const driver: NativeBaselineDriver = {
    manifest: () => ({
      bridge_version: 1,
      source_manifest_version: 1,
      source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST
    }),
    openBaseline: () => ({ snapshots }),
    candidateWindowEvent: event => {
      acceptedEvents.push(event);
      return 'accepted';
    },
    candidateWindowEventsLost: lostCount => {
      lostCounts.push(lostCount);
      return 'accepted';
    },
    pollBaseline: () => ({
      state: 'healthy',
      opened_snapshots: [],
      batches: [],
      transitions: []
    }),
    stopBaseline: () => ({
      state: 'stopped',
      batches: [],
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
    initialCandidateWindow: candidateWindow,
    onPoll: () => undefined,
    onFailure: failure => failures.push(failure)
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

test('shutdown compacts the maximum pending ingress into one exact loss marker', async () => {
  const [mainPort, utilityPort] = memoryPortPair();
  const lostCounts: number[] = [];
  let eventCalls = 0;
  const driver: NativeBaselineDriver = {
    manifest: () => ({
      bridge_version: 1,
      source_manifest_version: 1,
      source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST
    }),
    openBaseline: () => ({ snapshots }),
    candidateWindowEvent: () => {
      eventCalls += 1;
      return 'accepted';
    },
    candidateWindowEventsLost: lostCount => {
      lostCounts.push(lostCount);
      return 'accepted';
    },
    pollBaseline: () => ({
      state: 'healthy',
      opened_snapshots: [],
      batches: [],
      transitions: []
    }),
    stopBaseline: () => ({
      state: 'stopped',
      batches: [],
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

test('native ingress drops remain ordered so a later event can expose the exact gap', async () => {
  const [mainPort, utilityPort] = memoryPortPair();
  const outcomes = ['dropped', 'accepted'] as const;
  let calls = 0;
  const driver: NativeBaselineDriver = {
    manifest: () => ({
      bridge_version: 1,
      source_manifest_version: 1,
      source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST
    }),
    openBaseline: () => ({ snapshots }),
    candidateWindowEvent: () => outcomes[calls++] ?? 'accepted',
    candidateWindowEventsLost: () => 'accepted',
    pollBaseline: () => ({
      state: 'healthy',
      opened_snapshots: [],
      batches: [],
      transitions: []
    }),
    stopBaseline: () => ({
      state: 'stopped',
      batches: [],
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
    initialCandidateWindow: candidateWindow,
    onPoll: () => undefined,
    onFailure: failure => failures.push(failure)
  });
  host.start();
  await client.start();
  client.sendCandidateWindowEvent({ kind: 'close_attempt' });
  client.sendCandidateWindowEvent({ kind: 'close_attempt' });
  await waitUntil(() => calls === 2);
  await client.shutdown(candidateWindow);

  assert.deepEqual(failures, []);
});

test('supervisor polls do not conceal a missing utility heartbeat', async () => {
  const [mainPort, utilityPort] = memoryPortPair();
  let nextSequence = 1;
  utilityPort.onMessage(message => {
    if (typeof message !== 'object' || message === null
      || Reflect.get(message, 'kind') !== 'bootstrap') return;
    utilityPort.postMessage({
      kind: 'ready',
      protocol_version: 1,
      message_sequence: 0,
      challenge_response: 'a'.repeat(43),
      build_identity: 'proctor-build-identity-0001',
      source_manifest_version: 1,
      source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST,
      participation_generation: 'participation-generation-0001',
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
    initialCandidateWindow: candidateWindow,
    onPoll: () => undefined,
    onFailure: failure => failures.push(failure)
  });
  await client.start();
  const pollTimer = setInterval(() => {
    utilityPort.postMessage({
      kind: 'native_poll',
      protocol_version: 1,
      message_sequence: nextSequence,
      participation_generation: 'participation-generation-0001',
      poll: { state: 'healthy', opened_snapshots: [], batches: [], transitions: [] }
    });
    nextSequence += 1;
  }, 100);
  try {
    await waitUntil(() => failures.includes('heartbeat_timeout'), 3_000);
  } finally {
    clearInterval(pollTimer);
  }
});

test('utility fails closed when the main side does not acknowledge bounded output', async () => {
  const [mainPort, utilityPort] = memoryPortPair();
  let healthy = false;
  const driver: NativeBaselineDriver = {
    manifest: () => ({
      bridge_version: 1,
      source_manifest_version: 1,
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
        batches: [],
        transitions: []
      };
    },
    stopBaseline: () => ({
      state: 'stopped',
      batches: [],
      process_replacement_required: false
    })
  };
  const childMessages: unknown[] = [];
  let utilityExitCode: number | undefined;
  mainPort.onMessage(message => childMessages.push(message));
  mainPort.start();
  const host = new SecurityUtilityHost({
    port: utilityPort,
    driver,
    buildIdentity: 'proctor-build-identity-0001',
    terminate: code => { utilityExitCode = code; }
  });
  host.start();
  mainPort.postMessage(validBootstrap());
  await waitUntil(() => childMessages.some(message => isFatalCode(message, 'outbound_backpressure')));
  assert.equal(utilityExitCode, 70);
});

test('main fails closed when a supervisor poll cannot be delivered', async () => {
  const [mainPort, utilityPort] = memoryPortPair();
  const driver: NativeBaselineDriver = {
    manifest: () => ({
      bridge_version: 1,
      source_manifest_version: 1,
      source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST
    }),
    openBaseline: () => ({ snapshots }),
    candidateWindowEvent: () => 'accepted',
    candidateWindowEventsLost: () => 'accepted',
    pollBaseline: () => ({
      state: 'healthy',
      opened_snapshots: [],
      batches: [],
      transitions: []
    }),
    stopBaseline: () => ({
      state: 'stopped',
      batches: [],
      process_replacement_required: false
    })
  };
  let utilityExitCode: number | undefined;
  const host = new SecurityUtilityHost({
    port: utilityPort,
    driver,
    buildIdentity: 'proctor-build-identity-0001',
    terminate: code => { utilityExitCode = code; }
  });
  const failures: string[] = [];
  const client = new SecurityUtilityClient({
    port: mainPort,
    challenge: 'a'.repeat(43),
    buildIdentity: 'proctor-build-identity-0001',
    participationGeneration: 'participation-generation-0001',
    collectionSessionId: 'collection-session-0001',
    queueCapacity: 32,
    initialCandidateWindow: candidateWindow,
    onPoll: () => { throw new Error('coordinator rejected poll'); },
    onFailure: failure => failures.push(failure)
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
    queueMicrotask(() => remote?.#remoteClosed());
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
  return new Promise(resolve => setTimeout(resolve, 10));
}

function validBootstrap(): unknown {
  return {
    kind: 'bootstrap',
    protocol_version: 1,
    challenge: 'a'.repeat(43),
    build_identity: 'proctor-build-identity-0001',
    source_manifest_version: 1,
    source_manifest: SECURITY_UTILITY_SOURCE_MANIFEST,
    participation_generation: 'participation-generation-0001',
    collection_session_id: 'collection-session-0001',
    queue_capacity: 32,
    initial_candidate_window: candidateWindow
  };
}

function isFatalCode(value: unknown, code: string): boolean {
  return typeof value === 'object' && value !== null
    && Reflect.get(value, 'kind') === 'fatal'
    && Reflect.get(value, 'code') === code;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for utility failure');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await eventLoopTurn();
}
