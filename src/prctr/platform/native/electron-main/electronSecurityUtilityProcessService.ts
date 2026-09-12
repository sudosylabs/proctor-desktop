/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { MessageChannelMain, powerMonitor, utilityProcess, type UtilityProcess } from 'electron';
import type { CancellationToken } from '../../../base/common/cancellation.js';
import { CancellationError } from '../../../base/common/errors.js';
import { DisposableStore, type IDisposable } from '../../../base/common/lifecycle.js';
import type {
	CandidateWindowHostEvent,
	CandidateWindowState
} from '../common/nativeObservation.generated.js';
import {
	SECURITY_UTILITY_STARTUP_TIMEOUT_MS,
	type NativeSupervisorStop
} from '../common/securityUtilityProtocol.js';
import { electronSecurityUtilityPort } from './electronSecurityUtilityPort.js';
import { NativeEnvironmentGuard } from './nativeEnvironmentGuard.js';
import type {
	ISecurityUtilityProcessService,
	LaunchedSecurityUtility,
	LaunchSecurityUtilityOptions,
	SecurityUtilityConnection
} from './nativeSecurity.js';
import { SecurityUtilityClient } from './securityUtilityClient.js';

/** Fixed build inputs supplied only by the packaged main-process composition root. */
export interface ElectronSecurityUtilityProcessOptions {
	readonly entrypoint: string;
	readonly buildIdentity: string;
	readonly allowUnsignedLibraries: boolean;
	readonly testDiagnostics: boolean;
}

/** Owns process/port acquisition; the coordinator never sees Electron handles. */
export class ElectronSecurityUtilityProcessService implements ISecurityUtilityProcessService {
	declare readonly _serviceBrand: undefined;

	public constructor(private readonly options: ElectronSecurityUtilityProcessOptions) {}

	public async launch(
		options: LaunchSecurityUtilityOptions,
		cancellation: CancellationToken
	): Promise<LaunchedSecurityUtility> {
		if (cancellation.isCancellationRequested) throw new CancellationError();
		const startupDeadline = performance.now() + SECURITY_UTILITY_STARTUP_TIMEOUT_MS;
		const child = utilityProcess.fork(this.options.entrypoint, [], {
			allowLoadingUnsignedLibraries: this.options.allowUnsignedLibraries,
			cwd: dirname(this.options.entrypoint),
			env: {},
			execArgv: [],
			serviceName: 'Proctor Exam Security',
			stdio: this.options.testDiagnostics ? 'inherit' : 'ignore'
		});
		const watchers = new DisposableStore();
		let channel: MessageChannelMain | undefined;
		let client: SecurityUtilityClient | undefined;
		try {
			// Ownership begins at fork, including failures before the protocol client exists.
			channel = new MessageChannelMain();
			client = new SecurityUtilityClient({
				port: electronSecurityUtilityPort(channel.port1),
				challenge: randomBytes(32).toString('base64url'),
				buildIdentity: this.options.buildIdentity,
				participationGeneration: options.participationGeneration,
				collectionSessionId: options.collectionSessionId,
				queueCapacity: options.queueCapacity,
				selectedSources: options.selectedSources,
				selectedSourceCategories: options.selectedSourceCategories,
				initialCandidateWindow: options.initialCandidateWindow,
				onPoll: options.onPoll,
				onFailure: (failure) => {
					watchers.dispose();
					child.kill();
					options.onFailure(failure);
				}
			});
			const ownedClient = client;
			const ownedConnection = new SecurityUtilityProcessConnection(
				child,
				ownedClient,
				watchers
			);
			watchers.add(cancellation.onCancellationRequested(() => ownedConnection.abort()));
			if (cancellation.isCancellationRequested) throw new CancellationError();
			watchers.add(
				new NativeEnvironmentGuard(powerMonitor, () =>
					ownedClient.abort('environment_interrupted')
				)
			);
			await waitForSpawn(child, startupDeadline, cancellation);
			if (cancellation.isCancellationRequested) throw new CancellationError();
			child.postMessage({ kind: 'security-utility-port', protocol_version: 1 }, [
				channel.port2
			]);
			const ready = await ownedClient.start(remainingStartupTimeout(startupDeadline));
			return { abort: () => ownedConnection.abort(), connection: ownedConnection, ready };
		} catch (error) {
			try {
				watchers.dispose();
				client?.abort('process_error');
			} finally {
				// A constructor or caller callback can throw; kill/port cleanup must still run.
				child.kill();
				channel?.port1.close();
				channel?.port2.close();
			}
			throw error;
		}
	}
}

class SecurityUtilityProcessConnection implements SecurityUtilityConnection {
	private stopped = false;

	public constructor(
		private readonly child: UtilityProcess,
		private readonly client: SecurityUtilityClient,
		private readonly watchers: DisposableStore
	) {
		const errored = (): void => this.client.abort('process_error');
		child.on('error', errored);
		child.once('exit', () => {
			child.off('error', errored);
			if (!this.stopped) this.client.abort('process_exit');
		});
	}

	public sendCandidateWindowEvent(event: CandidateWindowHostEvent): void {
		this.client.sendCandidateWindowEvent(event);
	}

	public async shutdown(
		finalCandidateWindow: CandidateWindowState
	): Promise<NativeSupervisorStop> {
		try {
			const result = await this.client.shutdown(finalCandidateWindow);
			this.stopped = true;
			return result;
		} finally {
			this.watchers.dispose();
		}
	}

	public abort(): void {
		if (this.stopped) return;
		try {
			this.client.abort('process_error');
		} finally {
			this.watchers.dispose();
			this.child.kill();
		}
	}
}

function waitForSpawn(
	child: UtilityProcess,
	startupDeadline: number,
	cancellation: CancellationToken
): Promise<void> {
	const timeoutMs = remainingStartupTimeout(startupDeadline);
	if (cancellation.isCancellationRequested) return Promise.reject(new CancellationError());
	if (child.pid !== undefined) return Promise.resolve();
	return new Promise((resolve, reject) => {
		let cancelled: IDisposable | undefined;
		const timer = setTimeout(
			() => finish(new Error('security utility spawn timed out')),
			timeoutMs
		);
		const spawned = (): void => finish();
		const exited = (): void => finish(new Error('security utility exited before spawn'));
		const errored = (): void => finish(new Error('security utility failed before spawn'));
		const finish = (error?: Error): void => {
			clearTimeout(timer);
			cancelled?.dispose();
			child.off('spawn', spawned);
			child.off('exit', exited);
			child.off('error', errored);
			if (error === undefined) resolve();
			else reject(error);
		};
		child.once('spawn', spawned);
		child.once('exit', exited);
		child.once('error', errored);
		cancelled = cancellation.onCancellationRequested(() => finish(new CancellationError()));
		if (cancellation.isCancellationRequested) finish(new CancellationError());
	});
}

function remainingStartupTimeout(startupDeadline: number): number {
	const remaining = Math.floor(startupDeadline - performance.now());
	if (!Number.isSafeInteger(remaining) || remaining <= 0)
		throw new Error('security utility startup timed out');
	return Math.min(remaining, SECURITY_UTILITY_STARTUP_TIMEOUT_MS);
}
