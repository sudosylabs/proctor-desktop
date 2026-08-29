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
  CandidateWindowState,
  PlatformFamily
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
import {
  NativePermissionBroker,
  createBaselineNativePermissionAdapters,
  type NativePermissionCapability,
  type NativePermissionFact,
  type NativePermissionPreflightReceipt,
  type NativePermissionPreflightSeal
} from '../../platform/native/electron-main/nativePermissionBroker.js';

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

export type NativeSecurityCompositionErrorCode =
  | 'permission_preflight_active'
  | 'permission_preflight_not_sealed'
  | 'security_utility_active'
  | 'security_utility_not_active';

export class NativeSecurityCompositionError extends Error {
  public readonly code: NativeSecurityCompositionErrorCode;

  public constructor(code: NativeSecurityCompositionErrorCode) {
    super(`native security composition failed: ${code}`);
    this.name = 'NativeSecurityCompositionError';
    this.code = code;
  }
}

export interface NativeSecurityComposition {
  readonly inspectPermissionPreflight: () => Promise<NativePermissionPreflightReceipt>;
  readonly requestPermissionDuringPreflight: (
    capability: NativePermissionCapability
  ) => Promise<NativePermissionFact>;
  readonly sealPermissionPreflight: () => Promise<NativePermissionPreflightReceipt>;
  readonly cancelPermissionPreflight: () => void;
  readonly launchSecurityUtility: (
    options: LaunchSecurityUtilityOptions
  ) => Promise<{ readonly connection: SecurityUtilityConnection; readonly ready: SecurityUtilityReady }>;
}

export function createNativeSecurityComposition(): NativeSecurityComposition {
  const composition = new ElectronMainNativeSecurityComposition();
  return Object.freeze({
    inspectPermissionPreflight: () => composition.inspectPermissionPreflight(),
    requestPermissionDuringPreflight: (capability: NativePermissionCapability) => (
      composition.requestPermissionDuringPreflight(capability)
    ),
    sealPermissionPreflight: () => composition.sealPermissionPreflight(),
    cancelPermissionPreflight: () => composition.cancelPermissionPreflight(),
    launchSecurityUtility: (options: LaunchSecurityUtilityOptions) => (
      composition.launchSecurityUtility(options)
    )
  });
}

class ElectronMainNativeSecurityComposition {
  readonly #permissionBroker = new NativePermissionBroker({
    adapters: createBaselineNativePermissionAdapters(currentPlatformFamily())
  });
  #permissionSeal: NativePermissionPreflightSeal | undefined;
  #utilityState: 'idle' | 'starting' | 'active' | 'stopping' | 'failed_closed' = 'idle';

  public inspectPermissionPreflight(): Promise<NativePermissionPreflightReceipt> {
    return this.#permissionBroker.inspectPreflight();
  }

  public requestPermissionDuringPreflight(
    capability: NativePermissionCapability
  ): Promise<NativePermissionFact> {
    return this.#permissionBroker.requestDuringPreflight(capability);
  }

  public async sealPermissionPreflight(): Promise<NativePermissionPreflightReceipt> {
    const sealed = await this.#permissionBroker.sealPreflight();
    this.#permissionSeal = sealed.seal;
    return sealed.receipt;
  }

  public cancelPermissionPreflight(): void {
    if (this.#utilityState !== 'idle') {
      throw new NativeSecurityCompositionError('permission_preflight_active');
    }
    this.#releasePermissionSeal();
  }

  public async launchSecurityUtility(
    options: LaunchSecurityUtilityOptions
  ): Promise<{ readonly connection: SecurityUtilityConnection; readonly ready: SecurityUtilityReady }> {
    if (this.#permissionSeal === undefined) {
      throw new NativeSecurityCompositionError('permission_preflight_not_sealed');
    }
    if (this.#utilityState !== 'idle') {
      throw new NativeSecurityCompositionError('security_utility_active');
    }
    this.#utilityState = 'starting';
    try {
      const launched = await launchSecurityUtilityProcess({
        ...options,
        onFailure: failure => {
          if (this.#utilityState === 'active') this.#utilityState = 'failed_closed';
          options.onFailure(failure);
        }
      });
      const connection = launched.connection;
      this.#utilityState = 'active';
      return Object.freeze({
        ready: launched.ready,
        connection: Object.freeze({
          sendCandidateWindowEvent: (event: CandidateWindowHostEvent) => {
            this.#assertUtilityActive();
            connection.sendCandidateWindowEvent(event);
          },
          shutdown: (finalCandidateWindow: CandidateWindowState) => (
            this.#shutdownNormally(connection, finalCandidateWindow)
          )
        })
      });
    } catch (error) {
      this.#utilityState = 'failed_closed';
      throw error;
    }
  }

  async #shutdownNormally(
    connection: SecurityUtilityConnection,
    finalCandidateWindow: CandidateWindowState
  ): Promise<NativeSupervisorStop> {
    this.#assertUtilityActive();
    this.#utilityState = 'stopping';
    try {
      const stopped = await connection.shutdown(finalCandidateWindow);
      this.#utilityState = 'idle';
      this.#releasePermissionSeal();
      return stopped;
    } catch (error) {
      this.#utilityState = 'failed_closed';
      throw error;
    }
  }

  #assertUtilityActive(): void {
    if (this.#utilityState !== 'active') {
      throw new NativeSecurityCompositionError('security_utility_not_active');
    }
  }

  #releasePermissionSeal(): void {
    if (this.#permissionSeal === undefined) {
      throw new Error('native permission preflight is not sealed');
    }
    const seal = this.#permissionSeal;
    this.#permissionBroker.releasePreflightSeal(seal);
    this.#permissionSeal = undefined;
  }
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

async function launchSecurityUtilityProcess(
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

function currentPlatformFamily(): PlatformFamily {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'linux') return 'linux';
  throw new Error(`unsupported Electron platform: ${process.platform}`);
}
