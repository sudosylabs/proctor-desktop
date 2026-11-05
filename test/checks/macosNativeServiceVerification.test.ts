import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createPackage, createPackageWithOptions, getRawHeader, uncache } from '@electron/asar';
import {
	MacOsNativeServiceVerifier,
	type MacOsNativeReleaseIdentity
} from '../../build/lib/macosNativeServiceVerification.ts';
import { nativeServicePackage } from '../../build/lib/macosNativeServicePackage.ts';
import type {
	NativePackageCommand,
	NativePackageTool
} from '../../build/lib/nativePackageCommand.ts';

// Public Apple Root CA G3; only supplies structurally real certificate bytes to
// the fake trust port. Tests never claim this certificate signed fixture data.
const certificate = `
-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----
`;
const identity: MacOsNativeReleaseIdentity = {
	teamIdentifier: 'ABCDEF1234',
	clientBundleIdentifier: 'com.proctor.security.utility',
	applicationBundleIdentifier: 'com.proctor.desktop',
	version: '1.2.3'
};
const entitlement = 'com.apple.developer.endpoint-security.client';
class FixtureCommands implements NativePackageCommand {
	public readonly calls: { tool: NativePackageTool; args: readonly string[] }[] = [];
	public failure = '';
	public run(
		tool: NativePackageTool,
		args: readonly string[],
		input?: string | Uint8Array
	): { stdout: string; stderr: string } {
		this.calls.push({ tool, args });
		const result = (stdout = '', stderr = '') => ({ stdout, stderr });
		if (tool === 'codesign') {
			if (args.includes('--verify')) {
				if (this.failure === 'signature') throw new Error('codesign verification failed');
				return result();
			}
			if (args.includes('--extract-certificates')) {
				writeFileSync(
					args[args.indexOf('--extract-certificates') + 1]! + '0',
					this.failure === 'certificate'
						? Buffer.from('wrong')
						: new X509Certificate(certificate).raw
				);
				return result();
			}
			if (args.includes('--entitlements'))
				return result(JSON.stringify({ [entitlement]: this.failure !== 'entitlement' }));
			return result('', 'flags=0x10000(runtime)');
		}
		if (tool === 'lipo') {
			if (args.includes('-archs'))
				return result(this.failure === 'architecture' ? 'arm64' : 'x86_64 arm64');
			const bad = this.failure === 'fuse' && args.includes('x86_64');
			writeFileSync(
				args[args.indexOf('-output') + 1]!,
				Buffer.concat([
					Buffer.from('fixture dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'),
					Buffer.from([1, 6]),
					Buffer.from(bad ? '110011' : '010011')
				])
			);
			return result();
		}
		if (tool === 'security') {
			if (args[0] === 'find-certificate') return result(certificate);
			if (this.failure === 'revocation') throw new Error('security verification failed');
			return result();
		}
		if (tool === 'openssl') {
			if (args[0] === 'smime') {
				if (this.failure === 'cms') throw new Error('openssl verification failed');
				writeFileSync(args[args.indexOf('-signer') + 1]!, certificate);
				writeFileSync(args[args.indexOf('-out') + 1]!, 'profile');
				return result();
			}
			if (args[0] === 'pkcs7') return result(certificate);
			return result(
				this.failure === 'profile-marker'
					? ''
					: '            1.2.840.113635.100.4.11: \n            1.2.840.113635.100.6.2.1: '
			);
		}
		if (args[0] === '-convert')
			return result(typeof input === 'string' ? input : Buffer.from(input!).toString());
		if (args[1] === 'Entitlements')
			return result(
				JSON.stringify({
					[entitlement]: true,
					'com.apple.developer.team-identifier': identity.teamIdentifier,
					'com.apple.application-identifier': `${identity.teamIdentifier}.${nativeServicePackage.bundleIdentifier}`
				})
			);
		if (args[1] === 'CreationDate') return result('2000-01-01T00:00:00Z');
		if (args[1] === 'ExpirationDate')
			return result(
				this.failure === 'expiry' ? '2001-01-01T00:00:00Z' : '2099-01-01T00:00:00Z'
			);
		return result(
			`<array><data>${new X509Certificate(certificate).raw.toString('base64')}</data></array>`
		);
	}
}
async function fixture(): Promise<{ root: string; app: string; archive: string }> {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'prctr-signed-fixture-')));
	const app = join(root, 'Proctor.app');
	const service = join(app, nativeServicePackage.bundlePath, 'Contents');
	for (const directory of [
		join(service, 'MacOS'),
		join(app, 'Contents/MacOS'),
		join(app, 'Contents/Frameworks/Electron Framework.framework'),
		join(app, 'Contents/Resources'),
		join(app, 'Contents/Library/LaunchDaemons'),
		join(root, 'source')
	])
		mkdirSync(directory, { recursive: true });
	writeFileSync(join(service, 'MacOS', nativeServicePackage.executable), 'helper');
	writeFileSync(join(service, 'embedded.provisionprofile'), 'profile');
	writeFileSync(
		join(service, 'Info.plist'),
		JSON.stringify({
			CFBundleIdentifier: nativeServicePackage.bundleIdentifier,
			CFBundleExecutable: nativeServicePackage.executable,
			CFBundleVersion: identity.version
		})
	);
	writeFileSync(join(app, 'Contents/MacOS/Proctor'), 'parent');
	writeFileSync(
		join(app, 'Contents/Frameworks/Electron Framework.framework/Electron Framework'),
		'framework'
	);
	writeFileSync(join(root, 'source/main.js'), 'console.log("fixture");');
	const archive = join(app, 'Contents/Resources/app.asar');
	await createPackage(join(root, 'source'), archive);
	writeFileSync(
		join(app, 'Contents/Info.plist'),
		JSON.stringify({
			CFBundleExecutable: 'Proctor',
			ElectronAsarIntegrity: {
				'Resources/app.asar': {
					algorithm: 'SHA256',
					hash: createHash('sha256')
						.update(getRawHeader(archive).headerString)
						.digest('hex')
				}
			}
		})
	);
	const socket = (SockPathName: string) => ({
		SockPathName,
		SockPathMode: 438,
		SockType: 'stream'
	});
	writeFileSync(
		join(app, 'Contents/Library/LaunchDaemons', nativeServicePackage.plistName),
		JSON.stringify({
			Label: nativeServicePackage.label,
			BundleProgram: `${nativeServicePackage.bundlePath}/Contents/MacOS/${nativeServicePackage.executable}`,
			ProgramArguments: [nativeServicePackage.executable, '--service'],
			UserName: 'root',
			RunAtLoad: false,
			KeepAlive: false,
			Sockets: {
				ProctorControl: socket(nativeServicePackage.controlSocket),
				ProctorObservation: socket(nativeServicePackage.observationSocket)
			}
		})
	);
	return { root, app, archive };
}
void test('signed artifact gate uses OS trust, both upstream fuse slices and real ASAR content checks', async () => {
	const f = await fixture();
	try {
		const command = new FixtureCommands();
		const proof = await new MacOsNativeServiceVerifier(command).verify(f.app, identity);
		assert.equal(proof.state, 'passed', proof.failure);
		assert.equal(proof.checks.length, 6);
		assert.ok(proof.unavailable.some((value) => value.includes('physical target')));
		assert.equal(
			command.calls.filter((call) => call.tool === 'lipo' && call.args.includes('-thin'))
				.length,
			2
		);
		assert.ok(
			command.calls.some(
				(call) =>
					call.tool === 'openssl' &&
					call.args.includes('-verify') &&
					!call.args.includes('-noverify')
			)
		);
		assert.ok(
			command.calls.some(
				(call) =>
					call.tool === 'security' &&
					call.args.includes('ocsp') &&
					call.args.includes('require')
			)
		);
		assert.ok(
			command.calls
				.filter((call) => call.tool === 'codesign' && call.args.includes('--verify'))
				.every(
					(call) =>
						call.args.includes('--strict') && call.args.includes('--all-architectures')
				)
		);
	} finally {
		uncache(f.archive);
		rmSync(f.root, { recursive: true, force: true });
	}
});
void test('signature, CMS, entitlement, certificate, architecture, fuse and trust failures remain failures', async () => {
	const f = await fixture();
	try {
		for (const failure of [
			'signature',
			'cms',
			'entitlement',
			'certificate',
			'architecture',
			'fuse',
			'revocation',
			'expiry',
			'profile-marker'
		]) {
			const command = new FixtureCommands();
			command.failure = failure;
			const proof = await new MacOsNativeServiceVerifier(command).verify(f.app, identity);
			assert.equal(proof.state, 'failed', failure);
			assert.ok(proof.failure);
		}
	} finally {
		uncache(f.archive);
		rmSync(f.root, { recursive: true, force: true });
	}
});
void test('signed header cannot conceal changed ASAR content', async () => {
	const f = await fixture();
	try {
		const bytes = readFileSync(f.archive);
		bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
		writeFileSync(f.archive, bytes);
		const proof = await new MacOsNativeServiceVerifier(new FixtureCommands()).verify(
			f.app,
			identity
		);
		assert.equal(proof.state, 'failed');
		assert.match(proof.failure!, /ASAR content hash/);
	} finally {
		uncache(f.archive);
		rmSync(f.root, { recursive: true, force: true });
	}
});
void test('symlink escape is rejected before inspecting an outside artifact', async () => {
	const f = await fixture();
	try {
		rmSync(f.archive);
		writeFileSync(join(f.root, 'outside'), 'outside');
		symlinkSync(join(f.root, 'outside'), f.archive);
		const command = new FixtureCommands();
		const proof = await new MacOsNativeServiceVerifier(command).verify(f.app, identity);
		assert.equal(proof.state, 'failed');
		assert.match(proof.failure!, /escapes/);
		assert.equal(command.calls.length, 0);
	} finally {
		uncache(f.archive);
		rmSync(f.root, { recursive: true, force: true });
	}
});

void test('unrecognized launchd execution keys fail even when a signature port accepts the bundle', async () => {
	const f = await fixture();
	try {
		const path = join(f.app, 'Contents/Library/LaunchDaemons', nativeServicePackage.plistName);
		const plist = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
		writeFileSync(path, JSON.stringify({ ...plist, RootDirectory: '/elsewhere' }));
		const proof = await new MacOsNativeServiceVerifier(new FixtureCommands()).verify(
			f.app,
			identity
		);
		assert.equal(proof.state, 'failed');
		assert.match(proof.failure!, /launchd key/);
	} finally {
		uncache(f.archive);
		rmSync(f.root, { recursive: true, force: true });
	}
});

void test('ASAR allocation size is rejected before the upstream reader allocates it', async () => {
	const f = await fixture();
	try {
		const bytes = readFileSync(f.archive);
		bytes.writeUInt32LE(32 * 1024 * 1024, 4);
		writeFileSync(f.archive, bytes);
		const proof = await new MacOsNativeServiceVerifier(new FixtureCommands()).verify(
			f.app,
			identity
		);
		assert.equal(proof.state, 'failed');
		assert.match(proof.failure!, /allocation bound/);
	} finally {
		uncache(f.archive);
		rmSync(f.root, { recursive: true, force: true });
	}
});

void test('only owned universal signed native addons may live outside ASAR', async () => {
	for (const name of ['native_node_bridge.node', 'unapproved.node']) {
		const f = await fixture();
		try {
			writeFileSync(join(f.root, 'source', name), 'native-fixture');
			uncache(f.archive);
			rmSync(f.archive);
			await createPackageWithOptions(join(f.root, 'source'), f.archive, { unpack: '*.node' });
			const path = join(f.app, 'Contents/Info.plist');
			const info = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
			writeFileSync(
				path,
				JSON.stringify({
					...info,
					ElectronAsarIntegrity: {
						'Resources/app.asar': {
							algorithm: 'SHA256',
							hash: createHash('sha256')
								.update(getRawHeader(f.archive).headerString)
								.digest('hex')
						}
					}
				})
			);
			const command = new FixtureCommands();
			const proof = await new MacOsNativeServiceVerifier(command).verify(f.app, identity);
			assert.equal(
				proof.state,
				name === 'unapproved.node' ? 'failed' : 'passed',
				proof.failure
			);
			if (name === 'unapproved.node') assert.match(proof.failure!, /Undeclared unpacked/);
			else
				assert.ok(
					command.calls.some(
						(call) => call.tool === 'codesign' && call.args.at(-1)!.endsWith(name)
					)
				);
		} finally {
			uncache(f.archive);
			rmSync(f.root, { recursive: true, force: true });
		}
	}
});

void test('physical unpacked files absent from the ASAR header are never admitted by code signing', async () => {
	for (const name of ['debug.node', 'debug.js']) {
		const f = await fixture();
		try {
			mkdirSync(`${f.archive}.unpacked`);
			writeFileSync(join(`${f.archive}.unpacked`, name), 'undeclared');
			const proof = await new MacOsNativeServiceVerifier(new FixtureCommands()).verify(
				f.app,
				identity
			);
			assert.equal(proof.state, 'failed');
			assert.match(proof.failure!, /Undeclared physical unpacked file/);
		} finally {
			uncache(f.archive);
			rmSync(f.root, { recursive: true, force: true });
		}
	}
});

void test('unpacked filesystem inventory rejects undeclared directories and dangling symlinks', async () => {
	for (const symlink of [false, true]) {
		const f = await fixture();
		try {
			mkdirSync(`${f.archive}.unpacked`);
			const entry = join(`${f.archive}.unpacked`, 'extra');
			if (symlink) symlinkSync(join(f.root, 'missing'), entry);
			else mkdirSync(entry);
			const proof = await new MacOsNativeServiceVerifier(new FixtureCommands()).verify(
				f.app,
				identity
			);
			assert.equal(proof.state, 'failed');
			assert.match(
				proof.failure!,
				symlink ? /unpacked symlink/ : /Undeclared unpacked directory/
			);
		} finally {
			uncache(f.archive);
			rmSync(f.root, { recursive: true, force: true });
		}
	}
});

void test('a dangling unpacked-root link is not treated as an absent directory', async () => {
	const f = await fixture();
	try {
		symlinkSync(join(f.root, 'missing'), `${f.archive}.unpacked`);
		const proof = await new MacOsNativeServiceVerifier(new FixtureCommands()).verify(
			f.app,
			identity
		);
		assert.equal(proof.state, 'failed');
		assert.match(proof.failure!, /real directory/);
	} finally {
		uncache(f.archive);
		rmSync(f.root, { recursive: true, force: true });
	}
});
