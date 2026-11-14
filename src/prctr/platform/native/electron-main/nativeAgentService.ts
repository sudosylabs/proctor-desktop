/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from '../../../base/common/event.js';
import { Disposable, type IDisposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import type {
	ClipOutcome,
	ClipRange,
	CloseDisposition,
	Fact,
	Notification,
	Policy,
	RecordingStart,
	RefusalCode,
	Request,
	Response,
	RuleStatus
} from '../common/nativeAgentProtocol.generated.js';
import {
	NativeAgentConnection,
	type NativeAgentFailure,
	type NativeAgentLaunchOptions
} from '../node/nativeAgentConnection.js';

export type NativeAgentPhase = 'idle' | 'readiness' | 'binding' | 'participation' | 'failed';

export interface NativeAgentSnapshot {
	readonly facts: readonly Fact[];
	readonly rules: readonly RuleStatus[];
}

export class NativeAgentRefusedError extends Error {
	public constructor(public readonly code: RefusalCode) {
		super(`native agent refused the request: ${code}`);
		this.name = 'NativeAgentRefusedError';
	}
}

export class NativeAgentStateError extends Error {
	public constructor(public readonly phase: NativeAgentPhase) {
		super(`native agent request is not valid in phase ${phase}`);
		this.name = 'NativeAgentStateError';
	}
}

/** A requested clip, ready to upload or failed. */
export interface NativeAgentClip {
	readonly clipRequestId: string;
	readonly outcome: ClipOutcome;
}

export const INativeAgentService = createDecorator<INativeAgentService>('nativeAgentService');

/**
 * Electron main's owner of the on-demand native agent: one readiness → participation session at a
 * time, containment from rule statuses, and the one automatic restart.
 */
export interface INativeAgentService extends IDisposable {
	readonly _serviceBrand: undefined;
	readonly phase: NativeAgentPhase;
	/** Whether the candidate window must be contained now. */
	readonly contained: boolean;
	readonly onDidNotify: Event<Notification>;
	readonly onDidChangeContainment: Event<boolean>;
	/** The agent restarted during a session; the snapshot carries fresh instances and states. */
	readonly onDidRestart: Event<NativeAgentSnapshot>;
	/** The agent failed and no automatic restart remains. */
	readonly onDidFail: Event<NativeAgentFailure>;
	/** A clip asked for with `recorderSave` is ready or has failed. */
	readonly onDidClip: Event<NativeAgentClip>;
	query(capability: string): Promise<Fact>;
	openReadiness(collectionSessionId: string, policy: Policy): Promise<NativeAgentSnapshot>;
	beginParticipation(): Promise<NativeAgentSnapshot>;
	/** Admission succeeded; `recording` starts the screen recorder when the policy enables it. */
	confirmParticipation(recording?: RecordingStart): Promise<readonly RuleStatus[]>;
	/** Asks the recorder for a clip; it arrives on `onDidClip` once recorded. */
	recorderSave(clipRequestId: string, range: ClipRange): Promise<void>;
	/** The server acknowledged the uploaded clip: its file is deleted. */
	recorderRelease(clipRequestId: string): Promise<void>;
	abandonParticipation(): Promise<readonly RuleStatus[]>;
	sendHostEvent(capability: string, event: unknown): void;
	close(disposition: CloseDisposition): Promise<NativeAgentSnapshot | undefined>;
}

export interface NativeAgentServiceOptions {
	readonly launch: NativeAgentLaunchOptions;
}

export class NativeAgentService extends Disposable implements INativeAgentService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidNotify = this._register(new Emitter<Notification>());
	public readonly onDidNotify = this._onDidNotify.event;
	private readonly _onDidChangeContainment = this._register(new Emitter<boolean>());
	public readonly onDidChangeContainment = this._onDidChangeContainment.event;
	private readonly _onDidRestart = this._register(new Emitter<NativeAgentSnapshot>());
	public readonly onDidRestart = this._onDidRestart.event;
	private readonly _onDidFail = this._register(new Emitter<NativeAgentFailure>());
	public readonly onDidFail = this._onDidFail.event;
	private readonly _onDidClip = this._register(new Emitter<NativeAgentClip>());
	public readonly onDidClip = this._onDidClip.event;

	private connection: NativeAgentConnection | undefined;
	private connectionListeners: IDisposable[] = [];
	private session: { readonly collectionSessionId: string; readonly policy: Policy } | undefined;
	/** Kept for the automatic restart, which resumes the same recording with a gap. */
	private recording: RecordingStart | undefined;
	private restarts = 0;
	private _phase: NativeAgentPhase = 'idle';
	private _contained = false;

	public constructor(private readonly options: NativeAgentServiceOptions) {
		super();
	}

	public get phase(): NativeAgentPhase {
		return this._phase;
	}

	public get contained(): boolean {
		return this._contained;
	}

	public async query(capability: string): Promise<Fact> {
		const response = await this.request({ kind: 'query', capability });
		if (response.kind !== 'queried') throw unexpected(response);
		return response.fact;
	}

	public async openReadiness(
		collectionSessionId: string,
		policy: Policy
	): Promise<NativeAgentSnapshot> {
		this.requirePhase('idle', 'failed');
		this.session = { collectionSessionId, policy };
		this.restarts = 0;
		this.setContained(false);
		const snapshot = await this.open();
		this._phase = 'readiness';
		return snapshot;
	}

	public async beginParticipation(): Promise<NativeAgentSnapshot> {
		this.requirePhase('readiness');
		const response = await this.request({ kind: 'begin_participation' });
		if (response.kind !== 'participation_begun') throw unexpected(response);
		this._phase = 'binding';
		return { facts: response.facts, rules: response.rules };
	}

	public async confirmParticipation(recording?: RecordingStart): Promise<readonly RuleStatus[]> {
		this.requirePhase('binding');
		this.recording = recording;
		const response = await this.request(
			recording === undefined
				? { kind: 'confirm_participation' }
				: { kind: 'confirm_participation', recording }
		);
		if (response.kind !== 'participation_confirmed') throw unexpected(response);
		this._phase = 'participation';
		this.applyStatuses(response.rules, true);
		return response.rules;
	}

	public async abandonParticipation(): Promise<readonly RuleStatus[]> {
		this.requirePhase('binding');
		const response = await this.request({ kind: 'abandon_participation' });
		if (response.kind !== 'participation_abandoned') throw unexpected(response);
		this._phase = 'readiness';
		return response.rules;
	}

	public async recorderSave(clipRequestId: string, range: ClipRange): Promise<void> {
		this.requirePhase('participation');
		const response = await this.request({
			kind: 'recorder_save',
			clip_request_id: clipRequestId,
			range
		});
		if (response.kind !== 'recorder_save_accepted') throw unexpected(response);
	}

	public async recorderRelease(clipRequestId: string): Promise<void> {
		const response = await this.request({
			kind: 'recorder_release',
			clip_request_id: clipRequestId
		});
		if (response.kind !== 'recorder_released') throw unexpected(response);
	}

	public sendHostEvent(capability: string, event: unknown): void {
		this.connection?.sendHostEvent(capability, event);
	}

	public async close(disposition: CloseDisposition): Promise<NativeAgentSnapshot | undefined> {
		const connection = this.connection;
		this.detach();
		this.session = undefined;
		this.recording = undefined;
		this._phase = 'idle';
		this.setContained(false);
		if (connection === undefined) return undefined;
		const response = await connection.close(disposition);
		connection.dispose();
		return response?.kind === 'closed'
			? { facts: response.facts, rules: response.rules }
			: undefined;
	}

	public override dispose(): void {
		const connection = this.connection;
		this.detach();
		connection?.dispose();
		super.dispose();
	}

	private async open(): Promise<NativeAgentSnapshot> {
		const session = this.session;
		if (session === undefined) throw new NativeAgentStateError(this._phase);
		await this.launch();
		const response = await this.request({
			kind: 'open_readiness',
			collection_session_id: session.collectionSessionId,
			policy: session.policy
		});
		if (response.kind !== 'readiness_opened') throw unexpected(response);
		return { facts: response.facts, rules: response.rules };
	}

	/** Only opening readiness starts an agent; any other request needs the running one. */
	private async request(request: Request): Promise<Response> {
		const connection = this.connection;
		if (connection === undefined) throw new NativeAgentStateError(this._phase);
		const response = await connection.request(request);
		if (response.kind === 'refused') throw new NativeAgentRefusedError(response.code);
		return response;
	}

	private async launch(): Promise<void> {
		if (this.connection !== undefined) return;
		const connection = await NativeAgentConnection.launch(this.options.launch);
		this.connection = connection;
		this.connectionListeners = [
			connection.onDidNotify((notification) => this.receive(notification)),
			connection.onDidFail((failure) => void this.handleFailure(connection, failure))
		];
	}

	private receive(notification: Notification): void {
		if (notification.kind === 'rules') this.applyStatuses(notification.statuses, false);
		if (notification.kind === 'clip')
			this._onDidClip.fire({
				clipRequestId: notification.clip_request_id,
				outcome: notification.outcome
			});
		this._onDidNotify.fire(notification);
	}

	private applyStatuses(statuses: readonly RuleStatus[], initial: boolean): void {
		if (this._phase !== 'participation') return;
		if (statuses.some((status) => status.local_effect === 'contained')) this.setContained(true);
		else if (statuses.some((status) => status.local_effect === 'released'))
			this.setContained(false);
		else if (initial) {
			const enforced = new Set(
				(this.session?.policy.rules ?? [])
					.filter((rule) => rule.mode === 'enforce')
					.map((rule) => rule.rule_id)
			);
			this.setContained(
				statuses.some((status) => enforced.has(status.rule_id) && status.status !== 'met')
			);
		}
	}

	private async handleFailure(
		connection: NativeAgentConnection,
		failure: NativeAgentFailure
	): Promise<void> {
		if (connection !== this.connection) return;
		this.detach();
		connection.dispose();
		const phase = this._phase;
		if (phase === 'participation') this.setContained(true);
		const resumable =
			(phase === 'readiness' || phase === 'participation') && this.restarts === 0;
		if (!resumable) {
			this._phase = 'failed';
			this._onDidFail.fire(failure);
			return;
		}
		this.restarts += 1;
		try {
			const opened = await this.open();
			let snapshot = opened;
			if (phase === 'participation') {
				this._phase = 'readiness';
				snapshot = await this.beginParticipation();
				const rules = await this.confirmParticipation(this.recording);
				snapshot = { facts: snapshot.facts, rules };
			} else {
				this._phase = 'readiness';
			}
			this._onDidRestart.fire(snapshot);
		} catch {
			const current = this.connection;
			this.detach();
			current?.dispose();
			this._phase = 'failed';
			this._onDidFail.fire(failure);
		}
	}

	private detach(): void {
		for (const listener of this.connectionListeners) listener.dispose();
		this.connectionListeners = [];
		this.connection = undefined;
	}

	private setContained(contained: boolean): void {
		if (this._contained === contained) return;
		this._contained = contained;
		this._onDidChangeContainment.fire(contained);
	}

	private requirePhase(...phases: readonly NativeAgentPhase[]): void {
		if (!phases.includes(this._phase)) throw new NativeAgentStateError(this._phase);
	}
}

function unexpected(response: Response): Error {
	return new Error(`unexpected native agent response ${response.kind}`);
}
