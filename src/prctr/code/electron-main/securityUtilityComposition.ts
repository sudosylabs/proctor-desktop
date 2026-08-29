import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MessageChannelMain,
  utilityProcess,
  type UtilityProcess
} from 'electron';
import type {
  CandidateWindowHostEvent,
  CandidateWindowState
} from '../../platform/native/common/nativeObservation.generated.js';
import {
  SECURITY_UTILITY_STARTUP_TIMEOUT_MS,
  type NativeSupervisorPoll,
  type NativeSupervisorStop,
  type SecurityUtilityReady
} from '../../platform/native/common/securityUtilityProtocol.js';
import { electronSecurityUtilityPort } from '../../platform/native/electron-main/electronSecurityUtilityPort.js';
import {
  SecurityUtilityClient,
  type SecurityUtilityClientFailure
} from '../../platform/native/electron-main/securityUtilityClient.js';

declare const __PRCTR_SECURITY_UTILITY_BUILD_IDENTITY__: string;
declare const __PRCTR_ALLOW_UNSIGNED_SECURITY_UTILITY_NATIVE__: boolean;
declare const __PRCTR_SECURITY_UTILITY_TEST_DIAGNOSTICS__: boolean;

const UTILITY_ENTRYPOINT = fileURLToPath(new URL('./security-utility.js', import.meta.url));

export interface LaunchSecurityUtilityOptions {
  readonly participationGeneration: string;
  readonly collectionSessionId: string;
  readonly queueCapacity: number;
  readonly initialCandidateWindow: CandidateWindowState;
  readonly onPoll: (poll: NativeSupervisorPoll) => void;
  readonly onFailure: (failure: SecurityUtilityClientFailure) => void;
}

export interface SecurityUtilityConnection {
  readonly sendCandidateWindowEvent: (event: CandidateWindowHostEvent) => void;
  readonly shutdown: (finalCandidateWindow: CandidateWindowState) => Promise<NativeSupervisorStop>;
}

class SecurityUtilityProcessConnection implements SecurityUtilityConnection {
  readonly #child: UtilityProcess;
  readonly #client: SecurityUtilityClient;
  #stopped = false;

  public constructor(child: UtilityProcess, client: SecurityUtilityClient) {
    this.#child = child;
    this.#client = client;
  }

  public sendCandidateWindowEvent(event: CandidateWindowHostEvent): void {
    this.#client.sendCandidateWindowEvent(event);
  }

  public async shutdown(finalCandidateWindow: CandidateWindowState): Promise<NativeSupervisorStop> {
    const result = await this.#client.shutdown(finalCandidateWindow);
    this.#stopped = true;
    return result;
  }

  public processExited(): void {
    if (!this.#stopped) this.#client.abort('process_exit');
  }

  public processErrored(): void {
    this.#client.abort('process_error');
  }

  public killAfterFailure(): void {
    if (!this.#stopped) this.#child.kill();
  }
}

export async function launchSecurityUtility(
  options: LaunchSecurityUtilityOptions
): Promise<{ readonly connection: SecurityUtilityConnection; readonly ready: SecurityUtilityReady }> {
  const child = utilityProcess.fork(UTILITY_ENTRYPOINT, [], {
    allowLoadingUnsignedLibraries: __PRCTR_ALLOW_UNSIGNED_SECURITY_UTILITY_NATIVE__,
    cwd: dirname(UTILITY_ENTRYPOINT),
    env: {},
    execArgv: [],
    serviceName: 'Proctor Exam Security',
    stdio: __PRCTR_SECURITY_UTILITY_TEST_DIAGNOSTICS__ ? 'inherit' : 'ignore'
  });
  const channel = new MessageChannelMain();
  let connection: SecurityUtilityProcessConnection | undefined;
  const client = new SecurityUtilityClient({
    port: electronSecurityUtilityPort(channel.port1),
    challenge: randomBytes(32).toString('base64url'),
    buildIdentity: __PRCTR_SECURITY_UTILITY_BUILD_IDENTITY__,
    participationGeneration: options.participationGeneration,
    collectionSessionId: options.collectionSessionId,
    queueCapacity: options.queueCapacity,
    initialCandidateWindow: options.initialCandidateWindow,
    onPoll: options.onPoll,
    onFailure: failure => {
      connection?.killAfterFailure();
      options.onFailure(failure);
    }
  });
  connection = new SecurityUtilityProcessConnection(child, client);
  child.on('error', () => connection?.processErrored());
  child.on('exit', () => connection?.processExited());
  try {
    await waitForSpawn(child);
    child.postMessage(
      { kind: 'security-utility-port', protocol_version: 1 },
      [channel.port2]
    );
    const ready = await client.start();
    const processConnection = connection;
    const publicConnection: SecurityUtilityConnection = Object.freeze({
      sendCandidateWindowEvent: (event: CandidateWindowHostEvent) => {
        processConnection.sendCandidateWindowEvent(event);
      },
      shutdown: (finalCandidateWindow: CandidateWindowState) => {
        return processConnection.shutdown(finalCandidateWindow);
      }
    });
    return { connection: publicConnection, ready };
  } catch (error) {
    client.abort('process_error');
    throw error;
  }
}

function waitForSpawn(child: UtilityProcess): Promise<void> {
  if (child.pid !== undefined) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error('security utility spawn timed out')),
      SECURITY_UTILITY_STARTUP_TIMEOUT_MS
    );
    const spawned = (): void => finish();
    const exited = (): void => finish(new Error('security utility exited before spawn'));
    const errored = (): void => finish(new Error('security utility failed before spawn'));
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      child.off('spawn', spawned);
      child.off('exit', exited);
      child.off('error', errored);
      if (error === undefined) resolve();
      else reject(error);
    };
    child.once('spawn', spawned);
    child.once('exit', exited);
    child.once('error', errored);
  });
}
