import assert from 'node:assert';
import { test } from '../../../../base/common/upstream/testAdapter.ts';
import {
	REMOTE_TERMINAL_LIMITS,
	validateRemotePtyOpenResult,
	validateRemotePtyServerFrame,
	type RemotePtyClientFrame,
	type RemotePtyOpenRequest,
	type RemotePtyOpenResult,
	type RemotePtyServerFrame
} from '../../../../../src/prctr/platform/executionEnvironment/common/terminalProtocol.ts';
import {
	validateTerminalRendererIntent,
	validateTerminalRendererOutput,
	validateTerminalRendererProjection
} from '../../../../../src/prctr/platform/executionEnvironment/common/terminalRendererProtocol.ts';
import type {
	RemotePtyTransport,
	RemoteTerminalGate,
	WorkspaceExecutionFence,
	WorkspaceExecutionSettlement
} from '../../../../../src/prctr/workbench/services/executionEnvironment/common/remoteTerminal.ts';
import { createRemoteTerminal } from '../../../../../src/prctr/workbench/services/executionEnvironment/common/remoteTerminalModel.ts';

class Workspace implements WorkspaceExecutionFence {
	generation = 4;
	acknowledged = true;
	fail = false;
	barrier: Promise<void> | undefined;
	calls: number[] = [];
	captureGeneration() {
		return this.generation;
	}
	async persistThrough(generation: number): Promise<WorkspaceExecutionSettlement> {
		this.calls.push(generation);
		await this.barrier;
		if (this.fail) throw new Error('workspace unavailable');
		return this.acknowledged
			? { acknowledged: true, cursor: 9, blockers: [] }
			: { acknowledged: false, blockers: ['queued'] };
	}
}
class Transport implements RemotePtyTransport {
	openRequests: RemotePtyOpenRequest[] = [];
	frames: RemotePtyClientFrame[] = [];
	receive: ((frame: RemotePtyServerFrame) => void) | undefined;
	result: RemotePtyOpenResult = {
		kind: 'opened',
		selector: 'pty:one',
		connectionId: 'connection:one',
		participationGeneration: 3
	};
	failOpen = false;
	failSend = false;
	openBarrier: Promise<void> | undefined;
	sendBarrier: Promise<void> | undefined;
	readonly sendBarriers: Array<Promise<void> | undefined> = [];
	activeSends = 0;
	maximumConcurrentSends = 0;
	closed = false;
	async open(request: RemotePtyOpenRequest, receive: (frame: RemotePtyServerFrame) => void) {
		this.openRequests.push(request);
		this.receive = receive;
		await this.openBarrier;
		if (this.failOpen) throw new Error('transport unavailable');
		return this.result;
	}
	async send(frame: RemotePtyClientFrame) {
		this.frames.push(frame);
		this.activeSends++;
		this.maximumConcurrentSends = Math.max(this.maximumConcurrentSends, this.activeSends);
		try {
			await (this.sendBarriers.shift() ?? this.sendBarrier);
			if (this.failSend) throw new Error('transport unavailable');
			return 'accepted' as const;
		} finally {
			this.activeSends--;
		}
	}
	closeTransport() {
		this.closed = true;
	}
	dispose() {
		this.closeTransport();
	}
	emit(frame: RemotePtyServerFrame) {
		this.receive?.(frame);
	}
}
const scope = {
	attemptId: 'attempt:one',
	sessionId: 'session:one',
	connectionId: 'connection:one',
	participationGeneration: 3
} as const;
const active: RemoteTerminalGate = {
	attemptState: 'active',
	participationGeneration: 3,
	connectionId: 'connection:one',
	paused: false,
	postureUsable: true,
	environmentReady: true,
	executionProfileAdmitted: true,
	availability: 'enabled'
};
function harness() {
	const workspace = new Workspace();
	const transport = new Transport();
	const terminal = createRemoteTerminal({
		scope,
		gate: active,
		workspace,
		transport,
		ids: { nextOpenRequestId: () => 'open:one' }
	});
	return { terminal, workspace, transport };
}
function output(
	sequence: number,
	data = new TextEncoder().encode(`chunk-${sequence}`)
): RemotePtyServerFrame {
	return {
		kind: 'output',
		selector: 'pty:one',
		connectionId: 'connection:one',
		participationGeneration: 3,
		sequence,
		data
	};
}

test('one remote PTY persists current Workspace before open and frames input, resize, output acknowledgement and close', async () => {
	const { terminal, workspace, transport } = harness();
	const chunks: string[] = [];
	terminal.observe().onDidOutput((chunk) => chunks.push(new TextDecoder().decode(chunk.data)));
	await terminal.open({ columns: 80, rows: 24 }, true);
	assert.deepStrictEqual(workspace.calls, [4]);
	assert.strictEqual(transport.openRequests[0]?.acknowledgedWorkspaceCursor, 9);
	assert.strictEqual(terminal.observe().current.phase, 'ready');
	assert.strictEqual(terminal.observe().current.selector, 'pty:one');
	await terminal.input('pty:one', new TextEncoder().encode('echo test\r'));
	await terminal.resize('pty:one', { columns: 120, rows: 40 });
	transport.emit(output(1));
	assert.deepStrictEqual(chunks, ['chunk-1']);
	await terminal.acknowledgeOutput('pty:one', 1);
	await terminal.close('pty:one');
	assert.deepStrictEqual(
		transport.frames.map((frame) => frame.kind),
		['input', 'resize', 'ackOutput', 'close']
	);
	assert.strictEqual(terminal.observe().current.phase, 'closed');
	terminal.dispose();
});

test('close gates every later client frame and disposal fences its continuation', async () => {
	const { terminal, transport } = harness();
	const phases: string[] = [];
	terminal.observe().onDidChange((projection) => phases.push(projection.phase));
	await terminal.open({ columns: 80, rows: 24 }, false);
	let releaseClose = () => {};
	transport.sendBarrier = new Promise<void>((resolve) => {
		releaseClose = resolve;
	});
	const closing = terminal.close('pty:one');
	await waitFor(() => transport.frames.at(-1)?.kind === 'close');
	assert.deepStrictEqual(terminal.observe().current, {
		phase: 'closing',
		availability: 'enabled',
		selector: 'pty:one',
		canOpen: false,
		canInput: false,
		canResize: false,
		canClose: false
	});
	await assert.rejects(terminal.input('pty:one', new Uint8Array([65])), /gated/u);
	await assert.rejects(terminal.resize('pty:one', { columns: 100, rows: 30 }), /gated/u);
	await assert.rejects(terminal.acknowledgeOutput('pty:one', 1), /closing/u);
	await assert.rejects(terminal.close('pty:one'), /gated/u);
	assert.strictEqual(transport.frames.length, 1);
	terminal.updateGate(active);
	assert.strictEqual(terminal.observe().current.phase, 'closing');
	terminal.dispose();
	await assert.rejects(closing, /disposed/u);
	releaseClose();
	assert.strictEqual(phases.at(-1), 'closing');
	assert.strictEqual(transport.closed, true);
});

test('Workspace acknowledgement, availability and pause remain independent terminal gates', async () => {
	const { terminal, workspace, transport } = harness();
	workspace.acknowledged = false;
	await terminal.open({ columns: 80, rows: 24 }, true);
	assert.strictEqual(terminal.observe().current.failureReason, 'workspaceUnacknowledged');
	assert.strictEqual(transport.openRequests.length, 0);
	terminal.updateGate({ ...active, paused: true });
	assert.strictEqual(terminal.observe().current.canOpen, false);
	terminal.updateGate(active);
	assert.strictEqual(terminal.observe().current.canOpen, true);
	await terminal.open({ columns: 80, rows: 24 }, false);
	terminal.updateGate({ ...active, paused: true });
	assert.strictEqual(terminal.observe().current.phase, 'paused');
	await assert.rejects(terminal.input('pty:one', new Uint8Array([1])), /gated/u);
	terminal.updateGate(active);
	assert.strictEqual(terminal.observe().current.phase, 'ready');
	terminal.dispose();
});

test('current-Workspace execution requires a safe nonnegative acknowledged cursor', async () => {
	for (const cursor of [undefined, -1, 1.5, Number.NaN]) {
		const value = harness();
		value.workspace.persistThrough = async () => ({ acknowledged: true, cursor }) as never;
		await value.terminal.open({ columns: 80, rows: 24 }, true);
		assert.strictEqual(
			value.terminal.observe().current.failureReason,
			'workspaceUnacknowledged'
		);
		assert.strictEqual(value.transport.openRequests.length, 0);
		value.terminal.dispose();
	}
});

test('one bounded outbound lane preserves client order through close and coalesces adjacent resize frames', async () => {
	const { terminal, transport } = harness();
	await terminal.open({ columns: 80, rows: 24 }, false);
	let releaseFirst = () => {};
	transport.sendBarriers.push(
		new Promise<void>((resolve) => {
			releaseFirst = resolve;
		})
	);
	const first = terminal.input('pty:one', new Uint8Array([1]));
	const resizeOne = terminal.resize('pty:one', { columns: 90, rows: 30 });
	const resizeTwo = terminal.resize('pty:one', { columns: 100, rows: 40 });
	const second = terminal.input('pty:one', new Uint8Array([2]));
	const closing = terminal.close('pty:one');
	await waitFor(() => transport.frames.length === 1);
	assert.strictEqual(transport.maximumConcurrentSends, 1);
	releaseFirst();
	await Promise.all([first, resizeOne, resizeTwo, second, closing]);
	assert.deepStrictEqual(
		transport.frames.map((frame) => frame.kind),
		['input', 'resize', 'input', 'close']
	);
	assert.deepStrictEqual(
		transport.frames
			.filter(
				(frame): frame is Extract<RemotePtyClientFrame, { kind: 'resize' }> =>
					frame.kind === 'resize'
			)
			.map((frame) => frame.dimensions),
		[{ columns: 100, rows: 40 }]
	);
	assert.deepStrictEqual(
		transport.frames
			.filter(
				(frame): frame is Exclude<RemotePtyClientFrame, { kind: 'ackOutput' }> =>
					frame.kind !== 'ackOutput'
			)
			.map((frame) => frame.clientSequence),
		[1, 2, 3, 4]
	);
	assert.strictEqual(transport.maximumConcurrentSends, 1);
	assert.strictEqual(terminal.observe().current.phase, 'closed');
	terminal.dispose();
});

test('outbound input overflow fails explicitly without retaining an unbounded queue', async () => {
	const { terminal, transport } = harness();
	await terminal.open({ columns: 80, rows: 24 }, false);
	let releaseFirst = () => {};
	transport.sendBarriers.push(
		new Promise<void>((resolve) => {
			releaseFirst = resolve;
		})
	);
	const sends: Promise<void>[] = [];
	for (
		let index = 0;
		index <= REMOTE_TERMINAL_LIMITS.pendingInputBytes / REMOTE_TERMINAL_LIMITS.inputFrameBytes;
		index++
	)
		sends.push(
			terminal.input('pty:one', new Uint8Array(REMOTE_TERMINAL_LIMITS.inputFrameBytes))
		);
	const results = Promise.allSettled(sends);
	await waitFor(() => terminal.observe().current.failureReason === 'outboundOverflow');
	releaseFirst();
	const settled = await results;
	assert.strictEqual(
		settled.some((result) => result.status === 'rejected'),
		true
	);
	assert.strictEqual(transport.maximumConcurrentSends, 1);
	assert.strictEqual(transport.frames.length, 1);
	assert.strictEqual(transport.closed, true);
	terminal.dispose();
});

test('disposal retires a nonsettling active send and the close queued behind it', async () => {
	const { terminal, transport } = harness();
	await terminal.open({ columns: 80, rows: 24 }, false);
	transport.sendBarrier = new Promise<void>(() => {});
	const input = terminal.input('pty:one', new Uint8Array([65]));
	await waitFor(() => transport.frames.length === 1);
	const closing = terminal.close('pty:one');
	terminal.dispose();
	const settled = await Promise.allSettled([input, closing]);
	assert.deepStrictEqual(
		settled.map((result) => result.status),
		['rejected', 'rejected']
	);
	assert.strictEqual(transport.frames.length, 1);
	assert.strictEqual(transport.closed, true);
});

test('workspace and transport exceptions settle opening into explicit failure projections', async () => {
	const workspaceFailure = harness();
	workspaceFailure.workspace.fail = true;
	await workspaceFailure.terminal.open({ columns: 80, rows: 24 }, true);
	assert.strictEqual(workspaceFailure.terminal.observe().current.phase, 'failed');
	assert.strictEqual(
		workspaceFailure.terminal.observe().current.failureReason,
		'workspaceUnacknowledged'
	);
	workspaceFailure.terminal.dispose();
	const transportFailure = harness();
	transportFailure.transport.failOpen = true;
	await transportFailure.terminal.open({ columns: 80, rows: 24 }, false);
	assert.strictEqual(transportFailure.terminal.observe().current.phase, 'failed');
	assert.strictEqual(transportFailure.terminal.observe().current.failureReason, 'transportLost');
	transportFailure.terminal.dispose();
});

test('gate changes fence a pending open and late sends from a retired PTY', async () => {
	const opening = harness();
	let releaseOpen = () => {};
	opening.transport.openBarrier = new Promise<void>((resolve) => {
		releaseOpen = resolve;
	});
	const pendingOpen = opening.terminal.open({ columns: 80, rows: 24 }, false);
	await waitFor(() => opening.transport.openRequests.length === 1);
	opening.terminal.updateGate({ ...active, attemptState: 'suspended' });
	opening.terminal.updateGate(active);
	releaseOpen();
	await pendingOpen;
	assert.strictEqual(opening.terminal.observe().current.phase, 'closed');
	assert.strictEqual(opening.terminal.observe().current.canOpen, true);
	opening.terminal.dispose();
	const sending = harness();
	await sending.terminal.open({ columns: 80, rows: 24 }, false);
	let releaseSend = () => {};
	sending.transport.sendBarrier = new Promise<void>((resolve) => {
		releaseSend = resolve;
	});
	sending.transport.failSend = true;
	const staleInput = sending.terminal.input('pty:one', new Uint8Array([65]));
	await waitFor(() => sending.transport.frames.length === 1);
	sending.terminal.updateGate({ ...active, attemptState: 'suspended' });
	sending.terminal.updateGate(active);
	sending.transport.sendBarrier = undefined;
	await sending.terminal.open({ columns: 80, rows: 24 }, false);
	await assert.rejects(staleInput, /retired/u);
	releaseSend();
	assert.strictEqual(sending.terminal.observe().current.phase, 'ready');
	sending.terminal.dispose();
});

test('renderer selectors fence every PTY-bound intent after a replacement opens', async () => {
	const { terminal, transport } = harness();
	await terminal.open({ columns: 80, rows: 24 }, false);
	terminal.updateGate({ ...active, attemptState: 'suspended' });
	terminal.updateGate(active);
	transport.result = {
		kind: 'opened',
		selector: 'pty:two',
		connectionId: 'connection:one',
		participationGeneration: 3
	};
	await terminal.open({ columns: 80, rows: 24 }, false);
	transport.emit({ ...output(1), selector: 'pty:two' });
	const frameCount = transport.frames.length;
	await assert.rejects(terminal.input('pty:one', new Uint8Array([65])), /selector is stale/u);
	await assert.rejects(
		terminal.resize('pty:one', { columns: 100, rows: 30 }),
		/selector is stale/u
	);
	await assert.rejects(terminal.acknowledgeOutput('pty:one', 1), /selector is stale/u);
	await assert.rejects(terminal.close('pty:one'), /selector is stale/u);
	assert.strictEqual(transport.frames.length, frameCount);
	assert.strictEqual(terminal.observe().current.selector, 'pty:two');
	assert.strictEqual(terminal.observe().current.phase, 'ready');
	terminal.dispose();
});

test('a retired Workspace settlement cannot fail a newer PTY', async () => {
	const { terminal, workspace } = harness();
	let releaseWorkspace = () => {};
	workspace.barrier = new Promise<void>((resolve) => {
		releaseWorkspace = resolve;
	});
	workspace.acknowledged = false;
	const staleOpen = terminal.open({ columns: 80, rows: 24 }, true);
	await waitFor(() => workspace.calls.length === 1);
	terminal.updateGate({ ...active, attemptState: 'suspended' });
	terminal.updateGate(active);
	await terminal.open({ columns: 80, rows: 24 }, false);
	assert.strictEqual(terminal.observe().current.phase, 'ready');
	releaseWorkspace();
	await staleOpen;
	assert.strictEqual(terminal.observe().current.phase, 'ready');
	terminal.dispose();
});

test('rejected client-frame sends fail explicitly, release backpressure and allow a safe retry', async () => {
	const { terminal, transport } = harness();
	await terminal.open({ columns: 80, rows: 24 }, false);
	transport.emit(output(1));
	transport.failSend = true;
	await assert.rejects(terminal.acknowledgeOutput('pty:one', 1), /transport unavailable/u);
	assert.strictEqual(terminal.observe().current.phase, 'failed');
	assert.strictEqual(terminal.observe().current.failureReason, 'transportLost');
	assert.strictEqual(terminal.observe().current.canOpen, true);
	assert.strictEqual(transport.closed, true);
	terminal.dispose();
});

test('output ordering ignores duplicates and fails closed on gaps, overflow and stale scope without replay', async () => {
	const first = harness();
	const seen: number[] = [];
	first.terminal.observe().onDidOutput((chunk) => seen.push(chunk.sequence));
	await first.terminal.open({ columns: 80, rows: 24 }, false);
	first.transport.emit(output(1));
	first.transport.emit(output(1));
	assert.deepStrictEqual(seen, [1]);
	first.transport.emit(output(3));
	assert.strictEqual(first.terminal.observe().current.failureReason, 'outputGap');
	assert.strictEqual(first.transport.closed, true);
	first.terminal.dispose();
	const second = harness();
	await second.terminal.open({ columns: 80, rows: 24 }, false);
	const full = new Uint8Array(REMOTE_TERMINAL_LIMITS.outputFrameBytes);
	for (
		let sequence = 1;
		sequence <=
		REMOTE_TERMINAL_LIMITS.unacknowledgedOutputBytes / REMOTE_TERMINAL_LIMITS.outputFrameBytes +
			1;
		sequence++
	)
		second.transport.emit(output(sequence, full));
	assert.strictEqual(second.terminal.observe().current.failureReason, 'outputOverflow');
	second.terminal.dispose();
	const third = harness();
	const received: number[] = [];
	third.terminal.observe().onDidOutput((chunk) => received.push(chunk.sequence));
	await third.terminal.open({ columns: 80, rows: 24 }, false);
	third.transport.emit({ ...output(1), connectionId: 'connection:stale' });
	assert.deepStrictEqual(received, []);
	third.terminal.updateGate({
		...active,
		participationGeneration: 4,
		connectionId: 'connection:two'
	});
	assert.strictEqual(third.transport.closed, true);
	third.terminal.dispose();
});

test('terminal frame bounds and remote process exit remain explicit', async () => {
	const { terminal, transport } = harness();
	await assert.rejects(terminal.open({ columns: 1, rows: 24 }, false), /dimensions/u);
	await terminal.open({ columns: 80, rows: 24 }, false);
	await assert.rejects(
		terminal.input('pty:one', new Uint8Array(REMOTE_TERMINAL_LIMITS.inputFrameBytes + 1)),
		/input frame/u
	);
	transport.emit({
		kind: 'exit',
		selector: 'pty:one',
		connectionId: 'connection:one',
		participationGeneration: 3,
		sequence: 1,
		exitCode: 7,
		reason: 'processExit'
	});
	assert.strictEqual(terminal.observe().current.phase, 'exited');
	assert.strictEqual(terminal.observe().current.exitCode, 7);
	assert.strictEqual(terminal.observe().current.canOpen, true);
	terminal.dispose();
});

test('final output remains acknowledgeable after the remote process exits', async () => {
	const { terminal, transport } = harness();
	const writes: number[] = [];
	terminal.observe().onDidOutput((chunk) => writes.push(chunk.sequence));
	await terminal.open({ columns: 80, rows: 24 }, false);
	transport.emit(output(1));
	transport.emit({
		kind: 'exit',
		selector: 'pty:one',
		connectionId: 'connection:one',
		participationGeneration: 3,
		sequence: 2,
		exitCode: 0,
		reason: 'processExit'
	});
	assert.deepStrictEqual(writes, [1]);
	assert.strictEqual(terminal.observe().current.phase, 'exited');
	await terminal.acknowledgeOutput('pty:one', 1);
	assert.strictEqual(transport.frames.at(-1)?.kind, 'ackOutput');
	assert.strictEqual(terminal.observe().current.phase, 'exited');
	assert.strictEqual(terminal.observe().current.canOpen, true);
	await assert.rejects(terminal.acknowledgeOutput('pty:one', 1), /stale/u);
	terminal.dispose();
});

test('server frames arriving before the open result are drained after selector binding', async () => {
	const { terminal, transport } = harness();
	const timeline: string[] = [];
	const observation = terminal.observe();
	observation.onDidChange((projection) =>
		timeline.push(`projection:${projection.phase}:${projection.selector ?? '-'}`)
	);
	observation.onDidOutput((chunk) => timeline.push(`output:${chunk.sequence}`));
	transport.open = async function (request, receive) {
		this.openRequests.push(request);
		this.receive = receive;
		receive(output(1));
		return this.result;
	};
	await terminal.open({ columns: 80, rows: 24 }, false);
	assert.deepStrictEqual(timeline, [
		'projection:opening:-',
		'projection:opening:pty:one',
		'output:1',
		'projection:ready:pty:one'
	]);
	await terminal.acknowledgeOutput('pty:one', 1);
	terminal.dispose();
});

test('malformed early server frames fail as transport loss before buffering', async () => {
	const { terminal, transport } = harness();
	const phases: string[] = [];
	terminal.observe().onDidChange((projection) => phases.push(projection.phase));
	transport.open = async function (request, receive) {
		this.openRequests.push(request);
		this.receive = receive;
		receive({
			kind: 'unknown',
			selector: 'pty:one',
			connectionId: 'connection:one',
			participationGeneration: 3,
			sequence: 1
		} as unknown as RemotePtyServerFrame);
		return this.result;
	};
	await terminal.open({ columns: 80, rows: 24 }, false);
	assert.strictEqual(terminal.observe().current.phase, 'failed');
	assert.strictEqual(terminal.observe().current.failureReason, 'transportLost');
	assert.strictEqual(transport.closed, true);
	assert.strictEqual(phases.includes('ready'), false);
	assert.throws(() =>
		validateRemotePtyServerFrame({
			kind: 'closed',
			selector: 'pty:one',
			connectionId: 'connection:one',
			participationGeneration: 3,
			sequence: 1,
			secret: true
		})
	);
	assert.throws(() =>
		validateRemotePtyOpenResult({
			kind: 'opened',
			selector: '',
			connectionId: 'connection:one',
			participationGeneration: 3
		})
	);
	terminal.dispose();
});

test('early frame gaps fail before the terminal is ever interactive', async () => {
	const { terminal, transport } = harness();
	const phases: string[] = [];
	terminal.observe().onDidChange((projection) => phases.push(projection.phase));
	transport.open = async function (request, receive) {
		this.openRequests.push(request);
		this.receive = receive;
		receive(output(1));
		receive(output(3));
		return this.result;
	};
	await terminal.open({ columns: 80, rows: 24 }, false);
	assert.strictEqual(terminal.observe().current.failureReason, 'outputGap');
	assert.strictEqual(phases.includes('ready'), false);
	terminal.dispose();
});

test('renderer protocol admits only bounded terminal intents and safe projections', () => {
	assert.deepStrictEqual(
		validateTerminalRendererIntent({
			kind: 'terminal.open',
			dimensions: { columns: 80, rows: 24 },
			requireCurrentWorkspace: true
		}),
		{
			kind: 'terminal.open',
			dimensions: { columns: 80, rows: 24 },
			requireCurrentWorkspace: true
		}
	);
	assert.throws(
		() =>
			validateTerminalRendererIntent({
				kind: 'terminal.open',
				dimensions: { columns: 80, rows: 24 },
				requireCurrentWorkspace: true,
				attemptId: 'attempt:secret'
			}),
		/not allowed/u
	);
	assert.throws(
		() =>
			validateTerminalRendererIntent({
				kind: 'terminal.input',
				selector: 'pty:one',
				data: new Uint8Array(REMOTE_TERMINAL_LIMITS.inputFrameBytes + 1)
			}),
		/input frame/u
	);
	assert.throws(
		() => validateTerminalRendererIntent({ kind: 'terminal.close', selector: '' }),
		/selector/u
	);
	assert.deepStrictEqual(
		validateTerminalRendererProjection({
			phase: 'ready',
			availability: 'enabled',
			selector: 'pty:one',
			canOpen: false,
			canInput: true,
			canResize: true,
			canClose: true
		}),
		{
			phase: 'ready',
			availability: 'enabled',
			selector: 'pty:one',
			canOpen: false,
			canInput: true,
			canResize: true,
			canClose: true
		}
	);
	assert.deepStrictEqual(
		validateTerminalRendererProjection({
			phase: 'closing',
			availability: 'enabled',
			selector: 'pty:one',
			canOpen: false,
			canInput: false,
			canResize: false,
			canClose: false
		}),
		{
			phase: 'closing',
			availability: 'enabled',
			selector: 'pty:one',
			canOpen: false,
			canInput: false,
			canResize: false,
			canClose: false
		}
	);
	assert.throws(
		() =>
			validateTerminalRendererProjection({
				phase: 'ready',
				availability: 'enabled',
				canOpen: false,
				canInput: true,
				canResize: true,
				canClose: true
			}),
		/selector/u
	);
	assert.throws(
		() =>
			validateTerminalRendererProjection({
				phase: 'ready',
				availability: 'disabled',
				selector: 'pty:one',
				canOpen: false,
				canInput: true,
				canResize: true,
				canClose: true
			}),
		/selector/u
	);
	assert.throws(
		() =>
			validateTerminalRendererProjection({
				phase: 'opening',
				availability: 'unavailable',
				canOpen: false,
				canInput: false,
				canResize: false,
				canClose: false
			}),
		/selector/u
	);
	assert.throws(
		() =>
			validateTerminalRendererProjection({
				phase: 'ready',
				availability: 'enabled',
				canOpen: false,
				canInput: true,
				canResize: true,
				canClose: true,
				connectionId: 'connection:secret'
			}),
		/privileged fields/u
	);
	assert.throws(
		() =>
			validateTerminalRendererProjection({
				phase: new String('ready'),
				availability: 'enabled',
				selector: 'pty:one',
				canOpen: false,
				canInput: true,
				canResize: true,
				canClose: true
			}),
		/projection/u
	);
	assert.deepStrictEqual(
		validateTerminalRendererOutput({
			selector: 'pty:one',
			sequence: 1,
			data: new Uint8Array([65])
		}),
		{ selector: 'pty:one', sequence: 1, data: new Uint8Array([65]) }
	);
	assert.throws(
		() =>
			validateTerminalRendererOutput({
				selector: 'pty:one',
				sequence: 1,
				data: new Uint8Array(REMOTE_TERMINAL_LIMITS.outputFrameBytes + 1)
			}),
		/invalid/u
	);
});

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let index = 0; index < 50; index++) {
		if (predicate()) return;
		await Promise.resolve();
	}
	throw new Error('Remote terminal operation did not reach the expected state');
}
