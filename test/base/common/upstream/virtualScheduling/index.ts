/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port base-common-runtime

// Greenfield virtual scheduling primitives.
//
// This folder is the new home for virtual-time scheduling. It supersedes
// `timeTravelScheduler.ts` and `traceableTimeApi.ts`, both of which are
// retained as @deprecated re-export shims.

export type { TimeApi } from './timeApi.ts';
export { captureGlobalTimeApi, realTimeApi } from './timeApi.ts';

export type { EventSource, VirtualEvent, VirtualTime } from './virtualClock.ts';
export { VirtualClock } from './virtualClock.ts';

export type { RunAsHandlerOptions } from './trace.ts';
export { ROOT_TRACE, Trace, TraceContext, createTraceRoot } from './trace.ts';

export type { Embedding } from './embedding.ts';
export { drainMicrotasksEmbedding, nextMacrotask, syncEmbedding } from './embedding.ts';

export type { RunOptions, TerminationPolicy, VirtualTimeProcessorOptions } from './processor.ts';
export { VirtualTimeProcessor, untilIdle, untilTime, untilToken } from './processor.ts';

export { pushGlobalTimeApi } from './globalTimeApi.ts';
export type { CreateVirtualTimeApiOptions } from './virtualTimeApi.ts';
export { createVirtualTimeApi } from './virtualTimeApi.ts';
export { createLoggingTimeApi } from './loggingTimeApi.ts';
export type { RecordedTimerEvent } from './recordingTimeApi.ts';
export { createRecordingRealTimeApi } from './recordingTimeApi.ts';
export type { ITraceLogEntry, ITraceLogger } from './traceLogger.ts';
export { createTraceLogger } from './traceLogger.ts';
export type { RunWithFakedTimersOptions } from './runWithFakedTimers.ts';
export { runWithFakedTimers } from './runWithFakedTimers.ts';

