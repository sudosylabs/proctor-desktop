import {
	NATIVE_SOURCE_MANIFEST,
	NATIVE_SOURCE_CATEGORY_ORDER,
	NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS,
	isCandidateWindowDrain,
	isCandidateWindowHostEvent,
	isCandidateWindowSourceSnapshot,
	isCandidateWindowState,
	isCaptureSessionDrain,
	isCaptureSessionSourceSnapshot,
	isClipboardDrain,
	isClipboardSourceSnapshot,
	isDisplayTopologyDrain,
	isDisplayTopologySourceSnapshot,
	isInteractiveSessionDrain,
	isInteractiveSessionSourceSnapshot,
	isMediaDeviceDrain,
	isMediaDeviceSourceSnapshot,
	isNetworkConfigurationDrain,
	isNetworkConfigurationSourceSnapshot,
	isPrintSpoolerDrain,
	isPrintSpoolerSourceSnapshot,
	isProcessApplicationDrain,
	isProcessApplicationSourceSnapshot,
	isRemovableStorageDrain,
	isRemovableStorageSourceSnapshot,
	isSourceFailureCode,
	isVirtualizationDrain,
	isVirtualizationSourceSnapshot,
	type CandidateWindowDrain,
	type CandidateWindowHostEvent,
	type CandidateWindowSourceSnapshot,
	type CandidateWindowState,
	type CaptureSessionDrain,
	type CaptureSessionSourceSnapshot,
	type ClipboardDrain,
	type ClipboardSourceSnapshot,
	type DisplayTopologyDrain,
	type DisplayTopologySourceSnapshot,
	type InteractiveSessionDrain,
	type InteractiveSessionSourceSnapshot,
	type MediaDeviceDrain,
	type MediaDeviceSourceSnapshot,
	type NativeSourceCategory,
	type NativeSourceManifest,
	type NetworkConfigurationDrain,
	type NetworkConfigurationSourceSnapshot,
	type PrintSpoolerDrain,
	type PrintSpoolerSourceSnapshot,
	type ProcessApplicationDrain,
	type ProcessApplicationSourceSnapshot,
	type RemovableStorageDrain,
	type RemovableStorageSourceSnapshot,
	type SourceFailureCode,
	type VirtualizationDrain,
	type VirtualizationSourceSnapshot
} from './nativeObservation.generated.js';

export const SECURITY_UTILITY_SOURCE_MANIFEST = NATIVE_SOURCE_MANIFEST;

export type SecurityUtilitySourceManifest = NativeSourceManifest;
export type { NativeSourceCategory };

export const SECURITY_UTILITY_POLL_INTERVAL_MS = 100;
export const SECURITY_UTILITY_HEARTBEAT_INTERVAL_MS = 500;
export const SECURITY_UTILITY_HEARTBEAT_TIMEOUT_MS = 2_000;
export const SECURITY_UTILITY_SOURCE_COUNT = SECURITY_UTILITY_SOURCE_MANIFEST.length;
// A failed poll yields a drain and close batch per source. The two helper
// sources may additionally retain a terminal-loss reset between those batches.
export const SECURITY_UTILITY_MAX_SOURCE_BATCHES = SECURITY_UTILITY_SOURCE_COUNT * 2 + 2;
export const SECURITY_UTILITY_NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS =
	NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS;
export const SECURITY_UTILITY_LIFECYCLE_MARGIN_MS = 2_000;
export const SECURITY_UTILITY_MAX_SHUTDOWN_INGRESS_ROUND_TRIPS = 2;
export const SECURITY_UTILITY_STARTUP_TIMEOUT_MS =
	(SECURITY_UTILITY_SOURCE_COUNT * 2 - 1) * SECURITY_UTILITY_NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS +
	SECURITY_UTILITY_LIFECYCLE_MARGIN_MS;
export const SECURITY_UTILITY_SHUTDOWN_TIMEOUT_MS =
	SECURITY_UTILITY_SOURCE_COUNT * SECURITY_UTILITY_NATIVE_SOURCE_LIFECYCLE_DEADLINE_MS +
	SECURITY_UTILITY_MAX_SHUTDOWN_INGRESS_ROUND_TRIPS * SECURITY_UTILITY_HEARTBEAT_TIMEOUT_MS +
	SECURITY_UTILITY_LIFECYCLE_MARGIN_MS;
export const SECURITY_UTILITY_MAX_TRANSITIONS = 24;
export const SECURITY_UTILITY_MAX_UNACKNOWLEDGED_MESSAGES = 8;
export const SECURITY_UTILITY_MAX_LOST_EVENT_COUNT = 0xffff_ffff;

export interface SecurityUtilityBootstrap {
	readonly kind: 'bootstrap';
	readonly challenge: string;
	readonly build_identity: string;
	readonly source_manifest: SecurityUtilitySourceManifest;
	readonly participation_generation: string;
	readonly collection_session_id: string;
	readonly queue_capacity: number;
	readonly selected_sources: readonly NativeSourceId[];
	readonly selected_source_categories: readonly NativeSourceCategory[];
	readonly initial_candidate_window: CandidateWindowState;
}

export interface SecurityUtilityCandidateWindowEvent {
	readonly kind: 'candidate_window_event';
	readonly participation_generation: string;
	readonly message_sequence: number;
	readonly event: CandidateWindowHostEvent;
}

export interface SecurityUtilityCandidateWindowEventsLost {
	readonly kind: 'candidate_window_events_lost';
	readonly participation_generation: string;
	readonly message_sequence: number;
	readonly lost_count: number;
}

export interface SecurityUtilityShutdown {
	readonly kind: 'shutdown';
	readonly participation_generation: string;
	readonly message_sequence: number;
	readonly final_candidate_window: CandidateWindowState;
}

export interface SecurityUtilityAcknowledgement {
	readonly kind: 'acknowledge';
	readonly participation_generation: string;
	readonly message_sequence: number;
	readonly acknowledged_sequence: number;
}

export type SecurityUtilityMainMessage =
	| SecurityUtilityBootstrap
	| SecurityUtilityCandidateWindowEvent
	| SecurityUtilityCandidateWindowEventsLost
	| SecurityUtilityAcknowledgement
	| SecurityUtilityShutdown;

export type NativeBaselineSnapshots = readonly NativeSnapshotEnvelope[];

export type NativeSnapshotEnvelope =
	| { readonly source: 'display-topology'; readonly snapshot: DisplayTopologySourceSnapshot }
	| { readonly source: 'candidate-window'; readonly snapshot: CandidateWindowSourceSnapshot }
	| { readonly source: 'capture-session'; readonly snapshot: CaptureSessionSourceSnapshot }
	| {
			readonly source: 'process-application';
			readonly snapshot: ProcessApplicationSourceSnapshot;
	  }
	| {
			readonly source: 'interactive-session';
			readonly snapshot: InteractiveSessionSourceSnapshot;
	  }
	| { readonly source: 'clipboard'; readonly snapshot: ClipboardSourceSnapshot }
	| { readonly source: 'print-spooler'; readonly snapshot: PrintSpoolerSourceSnapshot }
	| { readonly source: 'removable-storage'; readonly snapshot: RemovableStorageSourceSnapshot }
	| { readonly source: 'virtualization'; readonly snapshot: VirtualizationSourceSnapshot }
	| {
			readonly source: 'network-configuration';
			readonly snapshot: NetworkConfigurationSourceSnapshot;
	  }
	| { readonly source: 'media-device'; readonly snapshot: MediaDeviceSourceSnapshot };

export type NativeBatchEnvelope =
	| { readonly source: 'display-topology'; readonly batch: DisplayTopologyDrain }
	| { readonly source: 'candidate-window'; readonly batch: CandidateWindowDrain }
	| { readonly source: 'capture-session'; readonly batch: CaptureSessionDrain }
	| { readonly source: 'process-application'; readonly batch: ProcessApplicationDrain }
	| { readonly source: 'interactive-session'; readonly batch: InteractiveSessionDrain }
	| { readonly source: 'clipboard'; readonly batch: ClipboardDrain }
	| { readonly source: 'print-spooler'; readonly batch: PrintSpoolerDrain }
	| { readonly source: 'removable-storage'; readonly batch: RemovableStorageDrain }
	| { readonly source: 'virtualization'; readonly batch: VirtualizationDrain }
	| { readonly source: 'network-configuration'; readonly batch: NetworkConfigurationDrain }
	| { readonly source: 'media-device'; readonly batch: MediaDeviceDrain };

export type NativeSourceId = NativeSnapshotEnvelope['source'];
export type NativeSupervisorState = 'healthy' | 'degraded' | 'recovering' | 'failed' | 'stopped';

export type NativeLifecycleTransition =
	| {
			readonly kind: 'restart_scheduled';
			readonly source: NativeSourceId;
			readonly previous_source_instance_id: string;
			readonly next_attempt: number;
			readonly retry_after_ms: number;
			readonly failure: SourceFailureCode;
	  }
	| {
			readonly kind: 'restarted';
			readonly source: NativeSourceId;
			readonly previous_source_instance_id: string;
			readonly new_source_instance_id: string;
			readonly attempt: number;
	  }
	| {
			readonly kind: 'restart_attempt_failed';
			readonly source: NativeSourceId;
			readonly attempt: number;
			readonly retry_after_ms: number;
			readonly failure: SourceFailureCode;
	  }
	| {
			readonly kind: 'restart_exhausted';
			readonly source: NativeSourceId;
			readonly attempts: number;
			readonly failure: SourceFailureCode;
	  }
	| {
			readonly kind: 'process_replacement_required';
			readonly source: NativeSourceId;
			readonly failure: SourceFailureCode;
	  };

export interface NativeSupervisorPoll {
	readonly state: NativeSupervisorState;
	readonly opened_snapshots: readonly NativeSnapshotEnvelope[];
	readonly final_snapshots: readonly NativeSnapshotEnvelope[];
	readonly batches: readonly NativeBatchEnvelope[];
	readonly transitions: readonly NativeLifecycleTransition[];
}

export interface NativeSupervisorStop {
	readonly state: 'stopped';
	readonly final_snapshots: readonly NativeSnapshotEnvelope[];
	readonly batches: readonly NativeBatchEnvelope[];
	readonly process_replacement_required: boolean;
}

export interface SecurityUtilityReady {
	readonly kind: 'ready';
	readonly message_sequence: 0;
	readonly challenge_response: string;
	readonly build_identity: string;
	readonly source_manifest: SecurityUtilitySourceManifest;
	readonly selected_sources: readonly NativeSourceId[];
	readonly selected_source_categories: readonly NativeSourceCategory[];
	readonly participation_generation: string;
	readonly delivered_at_wall_time_unix_ms: number;
	readonly snapshots: NativeBaselineSnapshots;
}

export interface SecurityUtilityPoll {
	readonly kind: 'native_poll';
	readonly message_sequence: number;
	readonly participation_generation: string;
	readonly delivered_at_wall_time_unix_ms: number;
	readonly poll: NativeSupervisorPoll;
}

export interface SecurityUtilityHeartbeat {
	readonly kind: 'heartbeat';
	readonly message_sequence: number;
	readonly participation_generation: string;
	readonly monotonic_time_ms: number;
}

export type CandidateWindowIngressOutcome = 'accepted' | 'dropped' | 'stopped';

export interface SecurityUtilityCandidateWindowIngressResult {
	readonly kind: 'candidate_window_ingress_result';
	readonly message_sequence: number;
	readonly participation_generation: string;
	readonly input_sequence: number;
	readonly outcome: CandidateWindowIngressOutcome;
}

export interface SecurityUtilityStopped {
	readonly kind: 'stopped';
	readonly message_sequence: number;
	readonly participation_generation: string;
	readonly result: NativeSupervisorStop;
}

export type SecurityUtilityFailureCode =
	| 'bootstrap_timeout'
	| 'duplicate_bootstrap'
	| 'malformed_message'
	| 'stale_generation'
	| 'out_of_order_message'
	| 'native_binding_invalid'
	| 'native_open_failed'
	| 'native_poll_failed'
	| 'native_ingress_overflow'
	| 'native_stop_failed'
	| 'outbound_backpressure';

export interface SecurityUtilityFatal {
	readonly kind: 'fatal';
	readonly message_sequence: number;
	readonly participation_generation: string;
	readonly code: SecurityUtilityFailureCode;
}

export type SecurityUtilityChildMessage =
	| SecurityUtilityReady
	| SecurityUtilityPoll
	| SecurityUtilityHeartbeat
	| SecurityUtilityCandidateWindowIngressResult
	| SecurityUtilityStopped
	| SecurityUtilityFatal;

export interface NativeBaselineDriver {
	readonly manifest: () => unknown;
	readonly openBaseline: (request: {
		readonly collection_session_id: string;
		readonly queue_capacity: number;
		readonly selected_sources: readonly NativeSourceId[];
		readonly selected_source_categories: readonly NativeSourceCategory[];
		readonly initial_candidate_window: CandidateWindowState;
	}) => unknown;
	readonly candidateWindowEvent: (event: CandidateWindowHostEvent) => unknown;
	readonly candidateWindowEventsLost: (lostCount: number) => unknown;
	readonly pollBaseline: () => unknown;
	readonly stopBaseline: (finalCandidateWindow: CandidateWindowState) => unknown;
}

export function isSecurityUtilityBootstrap(value: unknown): value is SecurityUtilityBootstrap {
	return (
		isRecordWithKeys(value, [
			'kind',
			'challenge',
			'build_identity',
			'source_manifest',
			'participation_generation',
			'collection_session_id',
			'queue_capacity',
			'selected_sources',
			'selected_source_categories',
			'initial_candidate_window'
		]) &&
		value.kind === 'bootstrap' &&
		isBootstrapChallenge(value.challenge) &&
		isBoundedString(value.build_identity, 16, 256) &&
		isSecurityUtilitySourceManifest(value.source_manifest) &&
		isBoundedString(value.participation_generation, 16, 128) &&
		isBoundedString(value.collection_session_id, 16, 128) &&
		isBoundedInteger(value.queue_capacity, 2, 1_024) &&
		isSelectedNativeSources(value.selected_sources) &&
		isSelectedSourceCategories(value.selected_source_categories, value.selected_sources) &&
		isCandidateWindowState(value.initial_candidate_window)
	);
}

export function isSecurityUtilityMainMessage(value: unknown): value is SecurityUtilityMainMessage {
	if (!isRecord(value) || typeof value.kind !== 'string') return false;
	if (value.kind === 'bootstrap') return isSecurityUtilityBootstrap(value);
	if (value.kind === 'candidate_window_event') {
		return (
			isRecordWithKeys(value, [
				'kind',
				'participation_generation',
				'message_sequence',
				'event'
			]) &&
			isBoundedString(value.participation_generation, 16, 128) &&
			isBoundedInteger(value.message_sequence, 1, Number.MAX_SAFE_INTEGER) &&
			isCandidateWindowHostEvent(value.event)
		);
	}
	if (value.kind === 'candidate_window_events_lost') {
		return (
			isRecordWithKeys(value, [
				'kind',
				'participation_generation',
				'message_sequence',
				'lost_count'
			]) &&
			isBoundedString(value.participation_generation, 16, 128) &&
			isBoundedInteger(value.message_sequence, 1, Number.MAX_SAFE_INTEGER) &&
			isBoundedInteger(value.lost_count, 1, SECURITY_UTILITY_MAX_LOST_EVENT_COUNT)
		);
	}
	if (value.kind === 'shutdown') {
		return (
			isRecordWithKeys(value, [
				'kind',
				'participation_generation',
				'message_sequence',
				'final_candidate_window'
			]) &&
			isBoundedString(value.participation_generation, 16, 128) &&
			isBoundedInteger(value.message_sequence, 1, Number.MAX_SAFE_INTEGER) &&
			isCandidateWindowState(value.final_candidate_window)
		);
	}
	if (value.kind === 'acknowledge') {
		return (
			isRecordWithKeys(value, [
				'kind',
				'participation_generation',
				'message_sequence',
				'acknowledged_sequence'
			]) &&
			isBoundedString(value.participation_generation, 16, 128) &&
			isBoundedInteger(value.message_sequence, 1, Number.MAX_SAFE_INTEGER) &&
			isBoundedInteger(value.acknowledged_sequence, 0, Number.MAX_SAFE_INTEGER)
		);
	}
	return false;
}

export function isNativeBridgeManifest(value: unknown): boolean {
	return (
		isRecordWithKeys(value, ['source_manifest']) &&
		isSecurityUtilitySourceManifest(value.source_manifest)
	);
}

export function isNativeBaselineSnapshots(
	value: unknown,
	selectedSources: readonly NativeSourceId[] = SECURITY_UTILITY_SOURCE_MANIFEST.map(
		(entry) => entry.source_id
	)
): value is NativeBaselineSnapshots {
	return (
		isBoundedArray(value, SECURITY_UTILITY_SOURCE_COUNT, isNativeSnapshotEnvelope) &&
		value.length === selectedSources.length &&
		selectedSources.every((sourceId, index) => value[index]?.source === sourceId)
	);
}

export function isNativeBaselineOpenResult(
	value: unknown,
	selectedSources?: readonly NativeSourceId[]
): value is { readonly snapshots: NativeBaselineSnapshots } {
	return (
		isRecordWithKeys(value, ['snapshots']) &&
		isNativeBaselineSnapshots(value.snapshots, selectedSources)
	);
}

function isNativeFinalSnapshotEnvelope(value: unknown): value is NativeSnapshotEnvelope {
	return (
		isNativeSnapshotEnvelope(value) &&
		(value.snapshot.health === 'stopped' || value.snapshot.health === 'failed')
	);
}

export function isNativeSupervisorPoll(value: unknown): value is NativeSupervisorPoll {
	return (
		isRecordWithKeys(value, [
			'state',
			'opened_snapshots',
			'final_snapshots',
			'batches',
			'transitions'
		]) &&
		isNativeSupervisorState(value.state) &&
		isBoundedArray(
			value.opened_snapshots,
			SECURITY_UTILITY_SOURCE_COUNT,
			isNativeSnapshotEnvelope
		) &&
		isBoundedArray(
			value.final_snapshots,
			SECURITY_UTILITY_SOURCE_COUNT,
			isNativeFinalSnapshotEnvelope
		) &&
		isBoundedArray(value.batches, SECURITY_UTILITY_MAX_SOURCE_BATCHES, isNativeBatchEnvelope) &&
		isBoundedArray(
			value.transitions,
			SECURITY_UTILITY_MAX_TRANSITIONS,
			isNativeLifecycleTransition
		)
	);
}

export function isNativeSupervisorStop(value: unknown): value is NativeSupervisorStop {
	return (
		isRecordWithKeys(value, [
			'state',
			'final_snapshots',
			'batches',
			'process_replacement_required'
		]) &&
		value.state === 'stopped' &&
		isBoundedArray(
			value.final_snapshots,
			SECURITY_UTILITY_SOURCE_COUNT,
			isNativeFinalSnapshotEnvelope
		) &&
		isBoundedArray(value.batches, SECURITY_UTILITY_MAX_SOURCE_BATCHES, isNativeBatchEnvelope) &&
		typeof value.process_replacement_required === 'boolean'
	);
}

export function isSecurityUtilityChildMessage(
	value: unknown
): value is SecurityUtilityChildMessage {
	if (!isRecord(value) || typeof value.kind !== 'string') return false;
	if (value.kind === 'ready') {
		return (
			isRecordWithKeys(value, [
				'kind',
				'message_sequence',
				'challenge_response',
				'build_identity',
				'source_manifest',
				'selected_sources',
				'selected_source_categories',
				'participation_generation',
				'delivered_at_wall_time_unix_ms',
				'snapshots'
			]) &&
			value.message_sequence === 0 &&
			isBootstrapChallenge(value.challenge_response) &&
			isBoundedString(value.build_identity, 16, 256) &&
			isSecurityUtilitySourceManifest(value.source_manifest) &&
			isSelectedNativeSources(value.selected_sources) &&
			isSelectedSourceCategories(value.selected_source_categories, value.selected_sources) &&
			isBoundedString(value.participation_generation, 16, 128) &&
			isBoundedInteger(value.delivered_at_wall_time_unix_ms, 0, Number.MAX_SAFE_INTEGER) &&
			isNativeBaselineSnapshots(value.snapshots, value.selected_sources)
		);
	}
	if (value.kind === 'native_poll') {
		return (
			hasChildEnvelope(value, [
				'kind',
				'message_sequence',
				'participation_generation',
				'delivered_at_wall_time_unix_ms',
				'poll'
			]) &&
			isBoundedInteger(value.delivered_at_wall_time_unix_ms, 0, Number.MAX_SAFE_INTEGER) &&
			isNativeSupervisorPoll(value.poll)
		);
	}
	if (value.kind === 'heartbeat') {
		return (
			hasChildEnvelope(value, [
				'kind',
				'message_sequence',
				'participation_generation',
				'monotonic_time_ms'
			]) && isBoundedInteger(value.monotonic_time_ms, 0, Number.MAX_SAFE_INTEGER)
		);
	}
	if (value.kind === 'candidate_window_ingress_result') {
		return (
			hasChildEnvelope(value, [
				'kind',
				'message_sequence',
				'participation_generation',
				'input_sequence',
				'outcome'
			]) &&
			isBoundedInteger(value.input_sequence, 1, Number.MAX_SAFE_INTEGER) &&
			isCandidateWindowIngressOutcome(value.outcome)
		);
	}
	if (value.kind === 'stopped') {
		return (
			hasChildEnvelope(value, [
				'kind',
				'message_sequence',
				'participation_generation',
				'result'
			]) && isNativeSupervisorStop(value.result)
		);
	}
	if (value.kind === 'fatal') {
		return (
			hasChildEnvelope(value, [
				'kind',
				'message_sequence',
				'participation_generation',
				'code'
			]) && isSecurityUtilityFailureCode(value.code)
		);
	}
	return false;
}

export function isSecurityUtilitySourceManifest(
	value: unknown
): value is SecurityUtilitySourceManifest {
	if (!Array.isArray(value) || value.length !== SECURITY_UTILITY_SOURCE_MANIFEST.length)
		return false;
	return SECURITY_UTILITY_SOURCE_MANIFEST.every((expected, index) => {
		const actual = value[index];
		return (
			isRecordWithKeys(actual, ['source_id', 'schema_version']) &&
			actual.source_id === expected.source_id &&
			actual.schema_version === expected.schema_version
		);
	});
}

export function isSelectedNativeSources(value: unknown): value is readonly NativeSourceId[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > SECURITY_UTILITY_SOURCE_COUNT
	) {
		return false;
	}
	const sourceIds = new Set(SECURITY_UTILITY_SOURCE_MANIFEST.map((entry) => entry.source_id));
	const selected = new Set<unknown>();
	let previousManifestIndex = -1;
	for (const sourceId of value) {
		const manifestIndex = SECURITY_UTILITY_SOURCE_MANIFEST.findIndex(
			(entry) => entry.source_id === sourceId
		);
		if (
			!sourceIds.has(sourceId as NativeSourceId) ||
			selected.has(sourceId) ||
			manifestIndex <= previousManifestIndex
		) {
			return false;
		}
		selected.add(sourceId);
		previousManifestIndex = manifestIndex;
	}
	return true;
}

export function isSelectedSourceCategories(
	value: unknown,
	selectedSources: readonly NativeSourceId[]
): value is readonly NativeSourceCategory[] {
	if (!Array.isArray(value) || value.length > NATIVE_SOURCE_CATEGORY_ORDER.length) return false;
	const selected = NATIVE_SOURCE_CATEGORY_ORDER.filter((category) => value.includes(category));
	if (
		selected.length !== value.length ||
		!selected.every((category, index) => value[index] === category)
	)
		return false;
	const clipboardSelected = selectedSources.includes('clipboard');
	const clipboardCategory = selected.includes('os-clipboard-change');
	const removableSelected = selectedSources.includes('removable-storage');
	const removableCategory =
		selected.includes('removable-block-storage') || selected.includes('portable-mtp');
	const networkSelected = selectedSources.includes('network-configuration');
	const networkCategory =
		selected.includes('system-proxy-state') ||
		selected.includes('os-managed-vpn-state') ||
		selected.includes('tunnel-interface-state') ||
		selected.includes('route-change') ||
		selected.includes('network-source-health');
	const mediaSelected = selectedSources.includes('media-device');
	const mediaCategory = selected.includes('camera') || selected.includes('microphone');
	return (
		clipboardSelected === clipboardCategory &&
		removableSelected === removableCategory &&
		networkSelected === networkCategory &&
		mediaSelected === mediaCategory
	);
}

function hasChildEnvelope(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return (
		hasOnlyKeys(value, keys) &&
		isBoundedInteger(value.message_sequence, 1, Number.MAX_SAFE_INTEGER) &&
		isBoundedString(value.participation_generation, 16, 128)
	);
}

function isNativeSnapshotEnvelope(value: unknown): value is NativeSnapshotEnvelope {
	if (!isRecordWithKeys(value, ['source', 'snapshot'])) return false;
	if (value.source === 'display-topology') return isDisplayTopologySourceSnapshot(value.snapshot);
	if (value.source === 'candidate-window') return isCandidateWindowSourceSnapshot(value.snapshot);
	if (value.source === 'capture-session') return isCaptureSessionSourceSnapshot(value.snapshot);
	if (value.source === 'process-application')
		return isProcessApplicationSourceSnapshot(value.snapshot);
	if (value.source === 'interactive-session')
		return isInteractiveSessionSourceSnapshot(value.snapshot);
	if (value.source === 'clipboard') return isClipboardSourceSnapshot(value.snapshot);
	if (value.source === 'print-spooler') return isPrintSpoolerSourceSnapshot(value.snapshot);
	if (value.source === 'removable-storage')
		return isRemovableStorageSourceSnapshot(value.snapshot);
	if (value.source === 'virtualization') return isVirtualizationSourceSnapshot(value.snapshot);
	if (value.source === 'network-configuration')
		return isNetworkConfigurationSourceSnapshot(value.snapshot);
	return value.source === 'media-device' && isMediaDeviceSourceSnapshot(value.snapshot);
}

function isNativeBatchEnvelope(value: unknown): value is NativeBatchEnvelope {
	if (!isRecordWithKeys(value, ['source', 'batch'])) return false;
	if (value.source === 'display-topology') return isDisplayTopologyDrain(value.batch);
	if (value.source === 'candidate-window') return isCandidateWindowDrain(value.batch);
	if (value.source === 'capture-session') return isCaptureSessionDrain(value.batch);
	if (value.source === 'process-application') return isProcessApplicationDrain(value.batch);
	if (value.source === 'interactive-session') return isInteractiveSessionDrain(value.batch);
	if (value.source === 'clipboard') return isClipboardDrain(value.batch);
	if (value.source === 'print-spooler') return isPrintSpoolerDrain(value.batch);
	if (value.source === 'removable-storage') return isRemovableStorageDrain(value.batch);
	if (value.source === 'virtualization') return isVirtualizationDrain(value.batch);
	if (value.source === 'network-configuration') return isNetworkConfigurationDrain(value.batch);
	return value.source === 'media-device' && isMediaDeviceDrain(value.batch);
}

function isNativeLifecycleTransition(value: unknown): value is NativeLifecycleTransition {
	if (!isRecord(value) || !isNativeSourceId(value.source) || typeof value.kind !== 'string')
		return false;
	if (value.kind === 'restart_scheduled') {
		return (
			hasOnlyKeys(value, [
				'kind',
				'source',
				'previous_source_instance_id',
				'next_attempt',
				'retry_after_ms',
				'failure'
			]) &&
			isSourceInstanceId(value.previous_source_instance_id) &&
			isBoundedInteger(value.next_attempt, 1, 8) &&
			isBoundedInteger(value.retry_after_ms, 1, 60_000) &&
			isSourceFailureCode(value.failure)
		);
	}
	if (value.kind === 'restarted') {
		return (
			hasOnlyKeys(value, [
				'kind',
				'source',
				'previous_source_instance_id',
				'new_source_instance_id',
				'attempt'
			]) &&
			isSourceInstanceId(value.previous_source_instance_id) &&
			isSourceInstanceId(value.new_source_instance_id) &&
			isBoundedInteger(value.attempt, 1, 8)
		);
	}
	if (value.kind === 'restart_attempt_failed') {
		return (
			hasOnlyKeys(value, ['kind', 'source', 'attempt', 'retry_after_ms', 'failure']) &&
			isBoundedInteger(value.attempt, 1, 8) &&
			isBoundedInteger(value.retry_after_ms, 1, 60_000) &&
			isSourceFailureCode(value.failure)
		);
	}
	if (value.kind === 'restart_exhausted') {
		return (
			hasOnlyKeys(value, ['kind', 'source', 'attempts', 'failure']) &&
			isBoundedInteger(value.attempts, 1, 8) &&
			isSourceFailureCode(value.failure)
		);
	}
	return (
		value.kind === 'process_replacement_required' &&
		hasOnlyKeys(value, ['kind', 'source', 'failure']) &&
		isSourceFailureCode(value.failure)
	);
}

function isNativeSourceId(value: unknown): value is NativeSourceId {
	return (
		value === 'display-topology' ||
		value === 'candidate-window' ||
		value === 'capture-session' ||
		value === 'process-application' ||
		value === 'interactive-session' ||
		value === 'clipboard' ||
		value === 'print-spooler' ||
		value === 'removable-storage' ||
		value === 'virtualization' ||
		value === 'network-configuration' ||
		value === 'media-device'
	);
}

function isNativeSupervisorState(value: unknown): value is NativeSupervisorState {
	return (
		value === 'healthy' ||
		value === 'degraded' ||
		value === 'recovering' ||
		value === 'failed' ||
		value === 'stopped'
	);
}

function isSecurityUtilityFailureCode(value: unknown): value is SecurityUtilityFailureCode {
	return (
		value === 'bootstrap_timeout' ||
		value === 'duplicate_bootstrap' ||
		value === 'malformed_message' ||
		value === 'stale_generation' ||
		value === 'out_of_order_message' ||
		value === 'native_binding_invalid' ||
		value === 'native_open_failed' ||
		value === 'native_poll_failed' ||
		value === 'native_ingress_overflow' ||
		value === 'native_stop_failed' ||
		value === 'outbound_backpressure'
	);
}

function isCandidateWindowIngressOutcome(value: unknown): value is CandidateWindowIngressOutcome {
	return value === 'accepted' || value === 'dropped' || value === 'stopped';
}

function isSourceInstanceId(value: unknown): value is string {
	return isBoundedString(value, 16, 64);
}

function isBootstrapChallenge(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecordWithKeys(
	value: unknown,
	keys: readonly string[]
): value is Record<string, unknown> {
	return isRecord(value) && hasOnlyKeys(value, keys);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value);
	return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
	if (typeof value !== 'string') return false;
	let length = 0;
	for (const _character of value) {
		length += 1;
		if (length > maximum) return false;
	}
	return length >= minimum;
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= minimum &&
		value <= maximum
	);
}

function isBoundedArray<T>(
	value: unknown,
	maximum: number,
	predicate: (candidate: unknown) => candidate is T
): value is readonly T[] {
	return Array.isArray(value) && value.length <= maximum && value.every(predicate);
}
