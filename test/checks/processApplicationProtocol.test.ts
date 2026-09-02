import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	isProcessApplicationDrain,
	isProcessApplicationEvent,
	isProcessApplicationState,
	isProcessExecutableIdentity
} from '../../src/prctr/platform/native/common/nativeObservation.generated.ts';

const pendingIdentity = { status: 'pending' } as const;
const process = {
	process_instance_id: 'process-instance-0001',
	scope: 'candidate_interactive_session',
	identity: pendingIdentity
} as const;

void test('process identity accepts only bounded normalized platform forms', () => {
	assert.equal(
		isProcessExecutableIdentity({
			status: 'verified',
			signer_chain_id: 'publisher-chain-v1',
			publisher_id: 'publisher-v1',
			product_id: 'product-v1',
			version: '1.2.3'
		}),
		true
	);
	assert.equal(
		isProcessExecutableIdentity({
			status: 'verified',
			signing_id: 'com.example.editor',
			team_id: 'TEAMID',
			designated_requirement: 'designated-requirement-v1',
			bundle_id: 'com.example.editor',
			version: '1.2.3'
		}),
		true
	);
	assert.equal(
		isProcessExecutableIdentity({
			status: 'verified',
			package_id: 'example-editor',
			version: '1.2.3',
			digest_sha256: 'a'.repeat(64)
		}),
		true
	);
	assert.equal(
		isProcessExecutableIdentity({
			status: 'unsigned',
			digest_sha256: 'not-a-normalized-sha256-digest'.padEnd(64, '-')
		}),
		false
	);
	assert.equal(
		isProcessExecutableIdentity({ status: 'pending', product_id: 'leaked-name' }),
		false
	);
	assert.equal(
		isProcessExecutableIdentity({
			status: 'verified',
			signer_chain_id: 'publisher-chain-v1',
			path: '/private/application'
		}),
		false
	);
});

void test('unavailable process coverage cannot carry a partial inventory', () => {
	assert.equal(
		isProcessApplicationState({
			coverage: 'unavailable',
			certainty: 'unknown',
			processes: []
		}),
		true
	);
	assert.equal(
		isProcessApplicationState({
			coverage: 'unavailable',
			certainty: 'partial',
			processes: [process]
		}),
		false
	);
	assert.equal(
		isProcessApplicationState({
			coverage: 'full_lifecycle',
			certainty: 'complete',
			processes: [process, process]
		}),
		false
	);
});

void test('process transition payload is exact for its lifecycle kind', () => {
	assert.equal(
		isProcessApplicationEvent({
			kind: 'started',
			process_instance_id: process.process_instance_id,
			process
		}),
		true
	);
	assert.equal(
		isProcessApplicationEvent({
			kind: 'exited',
			process_instance_id: process.process_instance_id
		}),
		true
	);
	assert.equal(
		isProcessApplicationEvent({
			kind: 'exited',
			process_instance_id: process.process_instance_id,
			process
		}),
		false
	);
	assert.equal(
		isProcessApplicationEvent({
			kind: 'reconciled',
			state: { coverage: 'full_lifecycle', certainty: 'complete', processes: [process] }
		}),
		true
	);
});

void test('process drains preserve source identity, ordering, and terminal health', () => {
	const observation = {
		source_instance_id: 'process-source-0001',
		sequence: 1,
		observed_at: { monotonic_time_ns: 1 },
		event: {
			kind: 'started',
			process_instance_id: process.process_instance_id,
			process
		}
	} as const;
	assert.equal(
		isProcessApplicationDrain({
			source_instance_id: 'process-source-0001',
			health: 'healthy',
			observations: [observation],
			resets: []
		}),
		true
	);
	assert.equal(
		isProcessApplicationDrain({
			source_instance_id: 'process-source-0001',
			health: 'healthy',
			observations: [{ ...observation, source_instance_id: 'different-process-source' }],
			resets: []
		}),
		false
	);
	assert.equal(
		isProcessApplicationDrain({
			source_instance_id: 'process-source-0001',
			health: 'failed',
			observations: [observation],
			resets: []
		}),
		false
	);
});
