import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	nativeServiceBuildEnvironment,
	nativeServicePackage,
	planMacOsNativeServicePackage,
	stageMacOsNativeServicePackage
} from '../../build/lib/macosNativeServicePackage.ts';

const identity = {
	teamIdentifier: 'ABCDEF1234',
	clientBundleIdentifier: 'com.proctor.security.utility',
	version: '1.2.3'
};
function universal(): Buffer {
	const bytes = Buffer.alloc(112);
	bytes.writeUInt32BE(0xcafebabe, 0);
	bytes.writeUInt32BE(2, 4);
	for (const [index, cpu] of [0x01000007, 0x0100000c].entries()) {
		const entry = 8 + index * 20;
		const start = 48 + index * 32;
		bytes.writeUInt32BE(cpu, entry);
		bytes.writeUInt32BE(start, entry + 8);
		bytes.writeUInt32BE(32, entry + 12);
		bytes.writeUInt32LE(0xfeedfacf, start);
		bytes.writeUInt32LE(cpu, start + 4);
		bytes.writeUInt32LE(2, start + 12);
	}
	return bytes;
}

void test('native package rejects missing or injectable release identities and incomplete architectures', () => {
	assert.throws(() => nativeServiceBuildEnvironment({ ...identity, teamIdentifier: '' }));
	assert.throws(() =>
		nativeServiceBuildEnvironment({
			...identity,
			clientBundleIdentifier: 'com.proctor.x" or true'
		})
	);
	assert.throws(() =>
		planMacOsNativeServicePackage(identity, Buffer.alloc(1), Buffer.from('profile'))
	);
	const overlapping = universal();
	overlapping.writeUInt32BE(48, 36);
	assert.throws(() =>
		planMacOsNativeServicePackage(identity, overlapping, Buffer.from('profile'))
	);
	assert.throws(() => planMacOsNativeServicePackage(identity, universal(), Buffer.alloc(0)));
});

void test('service package activates only fixed root socket service and uses same executable for worker', () => {
	const files = planMacOsNativeServicePackage(identity, universal(), Buffer.from('profile'));
	const daemon = Buffer.from(
		files.find((file) => file.path.includes('/LaunchDaemons/'))!.bytes
	).toString();
	assert.match(daemon, /<key>RunAtLoad<\/key><false\/>/);
	assert.match(daemon, /<key>KeepAlive<\/key><false\/>/);
	assert.match(daemon, /<key>UserName<\/key><string>root<\/string>/);
	assert.ok(daemon.includes(nativeServicePackage.controlSocket));
	assert.ok(daemon.includes(nativeServicePackage.observationSocket));
	assert.equal(files.filter((file) => file.mode === 0o755).length, 1);
	const rustService = readFileSync(
		new URL('../../native/crates/native-security-helper/src/macos_service.rs', import.meta.url),
		'utf8'
	);
	for (const socket of [
		nativeServicePackage.controlSocket,
		nativeServicePackage.observationSocket
	])
		assert.ok(rustService.includes(socket));
});

void test('staging refuses replacement and path traversal before writing payload', () => {
	const parent = realpathSync(mkdtempSync(join(tmpdir(), 'prctr-service-package-')));
	try {
		const output = join(parent, 'service');
		const files = planMacOsNativeServicePackage(identity, universal(), Buffer.from('profile'));
		assert.throws(() =>
			stageMacOsNativeServicePackage(output, [
				{ path: 'Contents/../../escape', bytes: new Uint8Array(), mode: 0o644 }
			])
		);
		const inventory = stageMacOsNativeServicePackage(output, files);
		assert.equal(inventory.length, 4);
		assert.ok(inventory.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
		assert.throws(() => stageMacOsNativeServicePackage(output, files));
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});

void test('restrictive umask cannot make the inventory differ from the staged modes', () => {
	const moduleUrl = new URL('../../build/lib/macosNativeServicePackage.ts', import.meta.url).href;
	execFileSync(process.execPath, [
		'--input-type=module',
		'-e',
		`
        import { mkdtempSync, realpathSync, lstatSync, rmSync } from 'node:fs';
        import { tmpdir } from 'node:os';
        import { join } from 'node:path';
        import assert from 'node:assert/strict';
        import { stageMacOsNativeServicePackage } from ${JSON.stringify(moduleUrl)};
        process.umask(0o077);
        const parent = realpathSync(mkdtempSync(join(tmpdir(), 'prctr-service-modes-')));
        try {
            const output = join(parent, 'stage');
            const [entry] = stageMacOsNativeServicePackage(output, [{path: 'Contents/MacOS/helper', bytes: new Uint8Array([1]), mode: 0o755}]);
            assert.equal(entry.mode, 0o755);
            assert.equal(lstatSync(join(output, entry.path)).mode & 0o777, entry.mode);
            assert.equal(lstatSync(join(output, 'Contents/MacOS')).mode & 0o777, 0o755);
        } finally { rmSync(parent, { recursive: true, force: true }); }
    `
	]);
});
