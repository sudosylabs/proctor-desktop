/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	BrowserHostSupervisor,
	type BrowserHostFactory
} from '../../../../platform/integratedBrowser/common/browserHostSupervisor.js';
import type { ProtectedRecordStore } from '../../../../platform/protectedStorage/node/protectedRecordStore.js';
import {
	IntegratedBrowserCoordinator,
	type IntegratedBrowserGate
} from '../common/integratedBrowserCoordinator.js';
import { BrowserDeliveryService } from './browserDeliveryService.js';
import { BrowserDeliveryPump } from './browserDeliveryPump.js';
import { mapServerBrowserPolicy, type BrowserSourceBinding } from './browserServerContract.js';
import type { BrowserSourceTransport } from './browserSourceTransport.js';
import { ServerBrowserActivitySinkFactory } from './serverBrowserActivitySink.js';

export interface BrowserFoundationOptions {
	readonly attemptId: string;
	readonly store: ProtectedRecordStore;
	readonly transport: BrowserSourceTransport;
	/** Current privileged capture permission; this never comes from renderer state. */
	canCapture(binding: BrowserSourceBinding): boolean;
	/** Immediately close the owning Attempt's browser gate after local capture/host failure. */
	unavailable(): void;
	/** Delivery failure is separate from navigation permission and may be transient. */
	deliveryFailed(error: unknown): void;
	now(): number;
}
export interface BrowserSessionOptions {
	readonly participationId: string;
	readonly generation: number;
	readonly institutionOrigin: string;
	readonly candidatePolicy: unknown;
	readonly hostFactory: BrowserHostFactory;
	currentGate(): IntegratedBrowserGate;
}
export interface SupervisedBrowserSession {
	readonly coordinator: IntegratedBrowserCoordinator;
	readonly host: BrowserHostSupervisor;
	readonly startRuleId: string;
	dispose(): Promise<void>;
}

/** Attempt-owned assembly: protected history outlives panel instances and Participation changes.
 * The composition root supplies concrete API transport, OS storage, native view host and gates.
 * This module never installs an IPC handler, chooses a window, or opens a page on its own.
 */
export class BrowserFoundation {
	readonly delivery: BrowserDeliveryService;
	private readonly pump: BrowserDeliveryPump;
	private readonly factories = new Map<string, ServerBrowserActivitySinkFactory>();
	private active: SupervisedBrowserSession | undefined;
	private activeScope: { participationId: string; generation: number } | undefined;
	private creating = false;
	private disposed = false;
	private constructor(
		private readonly options: BrowserFoundationOptions,
		delivery: BrowserDeliveryService
	) {
		this.delivery = delivery;
		this.pump = new BrowserDeliveryPump(delivery, options.deliveryFailed);
		for (const source of delivery.inventory()) this.pump.notify(source.sourceInstanceId);
	}
	static async create(options: BrowserFoundationOptions): Promise<BrowserFoundation> {
		return new BrowserFoundation(
			options,
			await BrowserDeliveryService.create(
				options.attemptId,
				options.store,
				options.transport,
				options.canCapture
			)
		);
	}
	setOnline(online: boolean): void {
		this.pump.setOnline(online);
	}
	async createSession(options: BrowserSessionOptions): Promise<SupervisedBrowserSession> {
		if (this.disposed || this.creating || this.active)
			throw new Error('Browser session already owned or unavailable');
		this.creating = true;
		let host: BrowserHostSupervisor | undefined;
		let coordinator: IntegratedBrowserCoordinator | undefined;
		try {
			const mapped = mapServerBrowserPolicy(
				options.candidatePolicy,
				{
					attemptId: this.options.attemptId,
					participationGeneration: options.generation
				},
				options.institutionOrigin
			);
			if (!mapped.policy || !mapped.startRuleId)
				throw new Error('Integrated browser is disabled');
			const key = `${options.participationId}:${options.generation}`;
			let factory = this.factories.get(key);
			if (!factory) {
				factory = new ServerBrowserActivitySinkFactory(this.delivery, {
					participationId: options.participationId,
					unavailable: this.options.unavailable,
					pending: (source) => this.pump.notify(source),
					now: this.options.now
				});
				this.factories.set(key, factory);
			}
			const sink = await factory.create(mapped.policy);
			if (this.disposed) {
				sink.dispose();
				throw new Error('Browser foundation disposed during source creation');
			}
			host = new BrowserHostSupervisor(
				options.hostFactory,
				{
					checkTopLevel: (...args) => {
						if (!coordinator) throw new Error('Browser coordinator is not initialized');
						return coordinator.checkTopLevel(...args);
					},
					checkSubresource: (url) => coordinator?.checkSubresource(url) ?? false,
					blockPopup: (url) => coordinator?.blockPopup(url),
					commitTopLevel: (...args) => coordinator?.commitTopLevel(...args)
				},
				this.options.unavailable
			);
			try {
				coordinator = new IntegratedBrowserCoordinator(
					mapped.policy,
					options.currentGate(),
					host,
					sink,
					factory,
					options.institutionOrigin
				);
			} catch (error) {
				sink.dispose();
				throw error;
			}
			const ownedCoordinator = coordinator;
			const session: SupervisedBrowserSession = {
				coordinator: ownedCoordinator,
				host,
				startRuleId: mapped.startRuleId,
				dispose: async () => {
					await ownedCoordinator.dispose();
					if (this.active === session) {
						this.active = undefined;
						this.activeScope = undefined;
					}
				}
			};
			this.active = session;
			this.activeScope = {
				participationId: options.participationId,
				generation: options.generation
			};
			return Object.freeze(session);
		} catch (error) {
			if (host) await host.close();
			throw error;
		} finally {
			this.creating = false;
		}
	}
	/** Final declaration belongs to the authoritative Attempt lifecycle, not panel close. */
	async sealParticipation(participationId: string, generation: number): Promise<void> {
		if (this.disposed || this.creating)
			throw new Error('Browser lifecycle transition is in progress');
		if (
			this.activeScope?.participationId === participationId &&
			this.activeScope.generation === generation
		)
			await this.active?.dispose();
		for (const binding of this.delivery.inventory()) {
			if (
				binding.participationId !== participationId ||
				binding.participationGeneration !== generation
			)
				continue;
			if (!this.delivery.status(binding.sourceInstanceId)) continue;
			await this.delivery.seal(binding.sourceInstanceId);
			this.pump.notify(binding.sourceInstanceId);
		}
	}
	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		try {
			await this.active?.dispose();
		} catch (error) {
			this.disposed = false;
			throw error;
		}
		this.pump.dispose();
		this.delivery.dispose();
		this.factories.clear();
	}
}
