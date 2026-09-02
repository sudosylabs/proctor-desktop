import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	CandidatePrintCommandGate,
	CandidatePrintCommandGateError,
	type CandidatePrintCommandDenied
} from '../../src/prctr/platform/native/electron-main/candidatePrintCommandGate.ts';

void test('every Proctor-owned print entrypoint is denied with content-free ordering', () => {
	const denied: CandidatePrintCommandDenied[] = [];
	const gate = new CandidatePrintCommandGate((attempt) => denied.push(attempt));

	assert.deepEqual(gate.deny('candidate_window'), {
		sequence: 1,
		origin: 'candidate_window'
	});
	assert.deepEqual(gate.deny('integrated_browser'), {
		sequence: 2,
		origin: 'integrated_browser'
	});
	assert.deepEqual(gate.deny('pdf_viewer'), {
		sequence: 3,
		origin: 'pdf_viewer'
	});
	assert.deepEqual(gate.deny('keyboard_command'), {
		sequence: 4,
		origin: 'keyboard_command'
	});
	assert.deepEqual(denied, [
		{ sequence: 1, origin: 'candidate_window' },
		{ sequence: 2, origin: 'integrated_browser' },
		{ sequence: 3, origin: 'pdf_viewer' },
		{ sequence: 4, origin: 'keyboard_command' }
	]);
});

void test('denial delivery failure closes the effect instead of losing an attempt silently', () => {
	const gate = new CandidatePrintCommandGate(() => {
		throw new Error('coordinator stopped');
	});

	assert.throws(
		() => gate.deny('candidate_window'),
		(error) => hasPrintError(error, 'print_denial_delivery_failed')
	);
	assert.throws(
		() => gate.deny('candidate_window'),
		(error) => hasPrintError(error, 'print_gate_disposed')
	);
});

function hasPrintError(error: unknown, code: CandidatePrintCommandGateError['code']): boolean {
	return error instanceof CandidatePrintCommandGateError && error.code === code;
}
