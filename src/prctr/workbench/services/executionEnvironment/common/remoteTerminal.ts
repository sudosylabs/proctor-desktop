/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from '../../../../base/common/event.js';
import type { IDisposable } from '../../../../base/common/lifecycle.js';
import type { RemotePtyClientFrame, RemotePtyOpenRequest, RemotePtyOpenResult, RemotePtyScope, RemotePtyServerFrame, TerminalDimensions } from '../../../../platform/executionEnvironment/common/terminalProtocol.js';

export type TerminalAvailability = 'disabled' | 'enabled' | 'unavailable';
export interface RemoteTerminalGate { readonly attemptState: 'active' | 'ready' | 'submitted' | 'suspended'; readonly participationGeneration: number; readonly connectionId: string; readonly paused: boolean; readonly postureUsable: boolean; readonly environmentReady: boolean; readonly executionProfileAdmitted: boolean; readonly availability: TerminalAvailability }
export interface RemoteTerminalProjection { readonly phase: 'closed' | 'closing' | 'exited' | 'failed' | 'opening' | 'paused' | 'ready'; readonly availability: TerminalAvailability; readonly selector?: string; readonly canOpen: boolean; readonly canInput: boolean; readonly canResize: boolean; readonly canClose: boolean; readonly failureReason?: 'environmentUnavailable' | 'outboundOverflow' | 'outputGap' | 'outputOverflow' | 'projectionFailed' | 'serverRejected' | 'staleGeneration' | 'transportLost' | 'workspaceUnacknowledged'; readonly exitCode?: number }
export interface TerminalOutputChunk { readonly selector: string; readonly sequence: number; readonly data: Uint8Array }
export interface RemoteTerminalObservation { readonly current: RemoteTerminalProjection; readonly onDidChange: Event<RemoteTerminalProjection>; readonly onDidOutput: Event<TerminalOutputChunk> }
export type WorkspaceExecutionSettlement = { readonly acknowledged: true; readonly cursor: number; readonly blockers: readonly [] } | { readonly acknowledged: false; readonly blockers: readonly string[]; readonly cursor?: never };
export interface WorkspaceExecutionFence { captureGeneration(): number; persistThrough(generation: number): Promise<WorkspaceExecutionSettlement> }
export interface RemotePtyTransport extends IDisposable { open(request: RemotePtyOpenRequest, receive: (frame: RemotePtyServerFrame) => void): Promise<RemotePtyOpenResult>; send(frame: RemotePtyClientFrame): Promise<'accepted' | 'notDispatched' | 'stale' | 'transportUnavailable'>; closeTransport(): void }
export interface RemoteTerminalIdFactory { nextOpenRequestId(): string }
export interface RemoteTerminal extends IDisposable { observe(): RemoteTerminalObservation; open(dimensions: TerminalDimensions, requireCurrentWorkspace: boolean): Promise<void>; input(selector: string, data: Uint8Array): Promise<void>; resize(selector: string, dimensions: TerminalDimensions): Promise<void>; acknowledgeOutput(selector: string, sequence: number): Promise<void>; close(selector: string): Promise<void>; updateGate(gate: RemoteTerminalGate): void }
export interface RemoteTerminalOptions { readonly scope: RemotePtyScope; readonly gate: RemoteTerminalGate; readonly workspace: WorkspaceExecutionFence; readonly transport: RemotePtyTransport; readonly ids: RemoteTerminalIdFactory }
