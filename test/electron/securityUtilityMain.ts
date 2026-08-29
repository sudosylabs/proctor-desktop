import { app } from 'electron';
import {
  launchSecurityUtility,
  type SecurityUtilityConnection
} from '../../src/prctr/code/electron-main/securityUtilityComposition.js';
import type { CandidateWindowState } from '../../src/prctr/platform/native/common/nativeObservation.generated.js';

const candidateWindow: CandidateWindowState = {
  certainty: 'complete',
  presence: 'present',
  focus: 'focused',
  visibility: 'visible',
  placement: 'maximized',
  bounds: { x: 0, y: 0, width: 1_440, height: 900 },
  display_target_id: 'electron-test-display'
};

let connection: SecurityUtilityConnection | undefined;
const failures: string[] = [];
let phase = 'module_loaded';
const harnessTimeout = setTimeout(() => {
  process.stdout.write(`${JSON.stringify({ error: 'electron_harness_timeout', phase, failures })}\n`);
  app.exit(1);
}, 10_000);

phase = 'waiting_for_app';
void app.whenReady().then(runHarness).catch(() => failHarness());

async function runHarness(): Promise<void> {
  try {
    phase = 'launching_utility';
    const launched = await launchSecurityUtility({
      participationGeneration: 'participation-generation-test-0001',
      collectionSessionId: 'collection-session-test-0001',
      queueCapacity: 32,
      initialCandidateWindow: candidateWindow,
      onPoll: () => undefined,
      onFailure: failure => failures.push(failure)
    });
    phase = 'utility_ready';
    connection = launched.connection;
    connection.sendCandidateWindowEvent({ kind: 'close_attempt' });
    await new Promise(resolve => setTimeout(resolve, 250));
    const stopped = await connection.shutdown(candidateWindow);
    phase = 'utility_stopped';
    process.stdout.write(`${JSON.stringify({
      ready: launched.ready.kind,
      sources: Object.keys(launched.ready.snapshots).sort(),
      stopped: stopped.state,
      process_replacement_required: stopped.process_replacement_required,
      failures
    })}\n`);
    clearTimeout(harnessTimeout);
    app.exit(failures.length === 0 ? 0 : 1);
  } catch {
    failHarness();
  }
}

function failHarness(): void {
  clearTimeout(harnessTimeout);
  process.stdout.write(`${JSON.stringify({ error: 'electron_harness_failed', phase, failures })}\n`);
  app.exit(1);
}
