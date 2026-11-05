import { createHash, X509Certificate } from 'node:crypto';
import {
	createReadStream,
	opendirSync,
	openSync,
	readSync,
	closeSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { extractFile, getRawHeader, listPackage, statFile, uncache } from '@electron/asar';
import { FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses';
import {
	nativeServiceBuildEnvironment,
	nativeServicePackage,
	type NativeServiceReleaseIdentity
} from './macosNativeServicePackage.ts';
import type { NativePackageCommand } from './nativePackageCommand.ts';

export interface MacOsNativeReleaseIdentity extends NativeServiceReleaseIdentity {
	readonly applicationBundleIdentifier: string;
}
export interface NativePackageProof {
	readonly state: 'passed' | 'failed';
	readonly checks: readonly string[];
	readonly failure?: string;
	readonly hashes: Readonly<Record<string, string>>;
	readonly unavailable: readonly string[];
}
const esEntitlement = 'com.apple.developer.endpoint-security.client';
const architectures = ['arm64', 'x86_64'] as const;

/** Inspects signed bytes only. It never registers, launches or changes the supplied app. */
export class MacOsNativeServiceVerifier {
	private readonly command: NativePackageCommand;
	constructor(command: NativePackageCommand) {
		this.command = command;
	}

	public async verify(
		appPath: string,
		identity: MacOsNativeReleaseIdentity
	): Promise<NativePackageProof> {
		const checks: string[] = [];
		const hashes: Record<string, string> = {};
		const unavailable = [
			'Packaged utility-role adversarial admission and compiled helper/client requirement conformance',
			'SMAppService registration, consent, Full Disk Access and observed source shutdown on each physical target',
			'Notarization and final installer/update-chain verification'
		];
		let temporary: string | undefined;
		let phase = 'input';
		try {
			nativeServiceBuildEnvironment(identity);
			assert(
				/^com\.proctor\.[A-Za-z0-9.-]+$/.test(identity.applicationBundleIdentifier),
				'Invalid parent application identifier'
			);
			const app = realpathSync(resolve(appPath));
			assert(
				app.endsWith('.app') && lstatSync(app).isDirectory(),
				'Expected application bundle'
			);
			temporary = realpathSync(mkdtempSync(join(tmpdir(), 'native-verification-')));
			const service = this.inside(app, nativeServicePackage.bundlePath, true);
			const executable = this.inside(
				app,
				`${nativeServicePackage.bundlePath}/Contents/MacOS/${nativeServicePackage.executable}`
			);
			const framework = this.inside(
				app,
				'Contents/Frameworks/Electron Framework.framework/Electron Framework'
			);
			const archive = this.inside(app, 'Contents/Resources/app.asar');
			for (const [key, file] of Object.entries({
				helper: executable,
				framework,
				asar: archive
			}))
				hashes[key] = await hashFile(file);
			phase = 'signed-identities';
			this.verifyCode(app, identity.applicationBundleIdentifier, identity.teamIdentifier);
			this.verifyCode(
				service,
				nativeServicePackage.bundleIdentifier,
				identity.teamIdentifier
			);
			for (const arch of architectures) {
				const parentMetadata = this.command.run('codesign', [
					'--display',
					'--verbose=4',
					'--arch',
					arch,
					app
				]).stderr;
				assert(/flags=.*\bruntime\b/.test(parentMetadata), 'Parent lacks hardened runtime');
				const parentEntitlements = this.plist(
					this.command.run('codesign', [
						'--display',
						'--entitlements',
						':-',
						'--arch',
						arch,
						app
					]).stdout
				);
				assert(
					parentEntitlements['com.apple.security.get-task-allow'] !== true,
					'Debuggable parent application'
				);
				const metadata = this.command.run('codesign', [
					'--display',
					'--verbose=4',
					'--arch',
					arch,
					service
				]).stderr;
				assert(/flags=.*\bruntime\b/.test(metadata), 'Service lacks hardened runtime');
				const entitlements = this.plist(
					this.command.run('codesign', [
						'--display',
						'--entitlements',
						':-',
						'--arch',
						arch,
						service
					]).stdout
				);
				assert(
					entitlements[esEntitlement] === true &&
						entitlements['com.apple.security.get-task-allow'] !== true,
					'Invalid signed service entitlements'
				);
			}
			checks.push(phase);
			phase = 'universal-layout';
			const info = this.plistFile(
				app,
				`${nativeServicePackage.bundlePath}/Contents/Info.plist`
			);
			assert(
				info.CFBundleIdentifier === nativeServicePackage.bundleIdentifier &&
					info.CFBundleExecutable === nativeServicePackage.executable &&
					info.CFBundleVersion === identity.version,
				'Service metadata mismatch'
			);
			const parent = this.plistFile(app, 'Contents/Info.plist');
			assert(
				typeof parent.CFBundleExecutable === 'string' &&
					/^[A-Za-z0-9 _.-]+$/.test(parent.CFBundleExecutable),
				'Invalid parent executable'
			);
			const parentExecutable = this.inside(
				app,
				`Contents/MacOS/${parent.CFBundleExecutable}`
			);
			for (const file of [executable, framework, parentExecutable]) {
				assert(
					this.command
						.run('lipo', ['-archs', file])
						.stdout.trim()
						.split(/\s+/)
						.sort()
						.join(',') === [...architectures].sort().join(','),
					'Both release architectures are required'
				);
			}
			this.verifyDaemon(
				this.plistFile(
					app,
					`Contents/Library/LaunchDaemons/${nativeServicePackage.plistName}`
				)
			);
			checks.push(phase);
			phase = 'authorized-profile';
			this.verifyProfile(app, service, identity, temporary);
			checks.push(phase);
			phase = 'electron-fuses';
			for (const arch of architectures) {
				const thin = join(temporary, `electron-${arch}`);
				this.command.run('lipo', [framework, '-thin', arch, '-output', thin]);
				const wire = await getCurrentFuseWire(thin);
				assert(wire.version === FuseVersion.V1, 'Unknown fuse schema');
				for (const option of [
					FuseV1Options.RunAsNode,
					FuseV1Options.EnableNodeOptionsEnvironmentVariable,
					FuseV1Options.EnableNodeCliInspectArguments
				])
					assert(wire[option] === FuseState.DISABLE, 'Unsafe Electron fuse');
				for (const option of [
					FuseV1Options.EnableCookieEncryption,
					FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
					FuseV1Options.OnlyLoadAppFromAsar
				])
					assert(wire[option] === FuseState.ENABLE, 'Missing Electron security fuse');
			}
			checks.push(phase);
			phase = 'asar-integrity';
			verifyArchive(
				archive,
				parent.ElectronAsarIntegrity,
				this.command,
				identity.teamIdentifier
			);
			checks.push(phase);
			phase = 'stable-artifact';
			this.verifyCode(app, identity.applicationBundleIdentifier, identity.teamIdentifier);
			for (const [key, file] of Object.entries({
				helper: executable,
				framework,
				asar: archive
			}))
				assert(
					hashes[key] === (await hashFile(file)),
					'Artifact changed during verification'
				);
			checks.push(phase);
			return { state: 'passed', checks, hashes, unavailable };
		} catch (error) {
			return {
				state: 'failed',
				checks,
				hashes,
				failure: `${phase}: ${error instanceof Error ? error.message : 'Verification failed'}`,
				unavailable
			};
		} finally {
			if (temporary) rmSync(temporary, { recursive: true, force: true });
		}
	}

	private inside(app: string, relative: string, directory = false): string {
		const path = realpathSync(resolve(app, relative));
		assert(path.startsWith(app + sep), 'Artifact escapes application bundle');
		const stat = lstatSync(path);
		assert(
			directory ? stat.isDirectory() : stat.isFile() && stat.size > 0 && stat.size <= 2 ** 31,
			'Invalid or oversized artifact'
		);
		return path;
	}
	private plistFile(app: string, relative: string): Record<string, unknown> {
		const path = this.inside(app, relative);
		assert(lstatSync(path).size <= 1024 * 1024, 'Plist allocation bound exceeded');
		return this.plist(readFileSync(path));
	}
	private plist(input: string | Uint8Array): Record<string, unknown> {
		const parsed: unknown = JSON.parse(
			this.command.run('plutil', ['-convert', 'json', '-o', '-', '-'], input).stdout
		);
		assert(isRecord(parsed), 'Expected plist dictionary');
		return parsed;
	}
	private verifyCode(path: string, identifier: string, team: string): void {
		this.command.run('codesign', [
			'--verify',
			'--deep',
			'--strict',
			'--all-architectures',
			'-R',
			`anchor apple generic and identifier "${identifier}" and certificate leaf[subject.OU] = "${team}"`,
			path
		]);
	}
	private verifyDaemon(value: Record<string, unknown>): void {
		assert(
			Object.keys(value).sort().join(',') ===
				[
					'Label',
					'BundleProgram',
					'ProgramArguments',
					'UserName',
					'RunAtLoad',
					'KeepAlive',
					'Sockets'
				]
					.sort()
					.join(','),
			'Unexpected launchd key'
		);
		const expectedProgram = `${nativeServicePackage.bundlePath}/Contents/MacOS/${nativeServicePackage.executable}`;
		assert(
			value.Label === nativeServicePackage.label &&
				value.BundleProgram === expectedProgram &&
				value.UserName === 'root' &&
				value.RunAtLoad === false &&
				value.KeepAlive === false,
			'Unexpected service lifecycle'
		);
		assert(
			JSON.stringify(value.ProgramArguments) ===
				JSON.stringify([nativeServicePackage.executable, '--service']),
			'Unexpected service arguments'
		);
		assert(isRecord(value.Sockets), 'Missing service sockets');
		for (const [key, path] of [
			['ProctorControl', nativeServicePackage.controlSocket],
			['ProctorObservation', nativeServicePackage.observationSocket]
		]) {
			const socket = value.Sockets[key!];
			assert(
				isRecord(socket) &&
					socket.SockPathName === path &&
					socket.SockPathMode === 0o666 &&
					socket.SockType === 'stream' &&
					Object.keys(socket).sort().join(',') ===
						['SockPathName', 'SockPathMode', 'SockType'].sort().join(','),
				'Unexpected service socket'
			);
		}
		assert(
			Object.keys(value.Sockets).length === 2 &&
				!('Program' in value) &&
				!('EnvironmentVariables' in value),
			'Unexpected launchd execution override'
		);
	}

	private verifyProfile(
		app: string,
		service: string,
		identity: MacOsNativeReleaseIdentity,
		temporary: string
	): void {
		const profile = this.inside(
			app,
			`${nativeServicePackage.bundlePath}/Contents/embedded.provisionprofile`
		);
		assert(lstatSync(profile).size <= 1024 * 1024, 'Oversized provisioning profile');
		const roots = this.command.run('security', [
			'find-certificate',
			'-a',
			'-c',
			'Apple Root CA',
			'-p',
			'/System/Library/Keychains/SystemRootCertificates.keychain'
		]).stdout;
		const rootCertificates = certificates(roots);
		assert(
			rootCertificates.length > 0 &&
				rootCertificates.every(
					(certificate) =>
						/^CN=Apple Root CA(?: - G[23])?$/m.test(certificate.subject) &&
						certificate.verify(certificate.publicKey)
				),
			'Expected OS Apple root anchors'
		);
		const anchors = join(temporary, 'apple-roots.pem');
		writeFileSync(anchors, roots, { flag: 'wx' });
		const signerPath = join(temporary, 'profile-signer.pem');
		const contentPath = join(temporary, 'profile.plist');
		// CMS signature and its Apple-rooted chain must verify; decoding is not trust.
		// Apple Security SecPolicyCreateOSXProvisioningProfileSigning defines the
		// profile leaf marker, WWDR intermediate marker and OCSP requirement used below.
		this.command.run('openssl', [
			'smime',
			'-verify',
			'-inform',
			'DER',
			'-in',
			profile,
			'-CAfile',
			anchors,
			'-purpose',
			'any',
			'-signer',
			signerPath,
			'-out',
			contentPath
		]);
		const signers = certificates(readFileSync(signerPath, 'utf8'));
		assert(signers.length === 1, 'Expected one provisioning-profile signer');
		const leaf = signers[0]!;
		const leafText = this.command.run('openssl', [
			'x509',
			'-in',
			signerPath,
			'-text',
			'-noout'
		]).stdout;
		assert(
			/^\s+1\.2\.840\.113635\.100\.4\.11:/m.test(leafText),
			'Missing Apple macOS profile signer marker'
		);
		const chain = certificates(
			this.command.run('openssl', ['pkcs7', '-inform', 'DER', '-in', profile, '-print_certs'])
				.stdout
		);
		const issuer = chain.find(
			(certificate) => leaf.checkIssued(certificate) && leaf.verify(certificate.publicKey)
		);
		assert(issuer, 'Missing profile signer intermediate');
		const issuerPath = join(temporary, 'profile-issuer.pem');
		writeFileSync(issuerPath, issuer.toString(), { flag: 'wx' });
		assert(
			this.command
				.run('openssl', ['x509', '-in', issuerPath, '-text', '-noout'])
				.stdout.match(/^\s+1\.2\.840\.113635\.100\.6\.2\.1:/m),
			'Missing Apple WWDR intermediate marker'
		);
		this.command.run('security', [
			'verify-cert',
			'-N',
			'-c',
			signerPath,
			'-c',
			issuerPath,
			'-p',
			'basic',
			'-R',
			'ocsp',
			'-R',
			'require'
		]);
		const content = readFileSync(contentPath, 'utf8');
		const extract = (key: string, format: string): string =>
			this.command
				.run('plutil', ['-extract', key, format, '-o', '-', '-'], content)
				.stdout.trim();
		const entitlements: unknown = JSON.parse(extract('Entitlements', 'json'));
		assert(
			isRecord(entitlements) &&
				entitlements[esEntitlement] === true &&
				entitlements['com.apple.developer.team-identifier'] === identity.teamIdentifier &&
				entitlements['com.apple.application-identifier'] ===
					`${identity.teamIdentifier}.${nativeServicePackage.bundleIdentifier}`,
			'Profile does not authorize this service'
		);
		const now = Date.now();
		assert(
			Date.parse(extract('CreationDate', 'raw')) <= now &&
				Date.parse(extract('ExpirationDate', 'raw')) > now,
			'Profile is outside its validity interval'
		);
		const authorized = [
			...extract('DeveloperCertificates', 'xml1').matchAll(/<data>([\s\S]*?)<\/data>/g)
		];
		for (const arch of architectures) {
			const certificatePrefix = join(temporary, `service-certificate-${arch}-`);
			this.command.run('codesign', [
				'--display',
				'--arch',
				arch,
				'--extract-certificates',
				certificatePrefix,
				service
			]);
			const codeCertificate = readFileSync(`${certificatePrefix}0`);
			assert(
				[...authorized].some((match) =>
					Buffer.from(match[1]!.replace(/\s/g, ''), 'base64').equals(codeCertificate)
				),
				'Signed service certificate is not authorized by profile'
			);
		}
	}
}

function certificates(pem: string): X509Certificate[] {
	return [...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)].map(
		([value]) => new X509Certificate(value)
	);
}
function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
async function hashFile(path: string): Promise<string> {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest('hex');
}
function verifyArchive(
	archive: string,
	integrity: unknown,
	command: NativePackageCommand,
	team: string
): void {
	assert(
		isRecord(integrity) && isRecord(integrity['Resources/app.asar']),
		'Missing signed ASAR integrity'
	);
	const expected = integrity['Resources/app.asar'];
	// Bound the public reader's allocation before handing it an archive header.
	const fd = openSync(archive, 'r');
	try {
		const prefix = Buffer.alloc(8);
		assert(
			readSync(fd, prefix, 0, 8, 0) === 8 && prefix.readUInt32LE(4) <= 16 * 1024 * 1024,
			'ASAR header allocation bound exceeded'
		);
	} finally {
		closeSync(fd);
	}
	uncache(archive);
	const header = getRawHeader(archive);
	assert(
		expected.algorithm === 'SHA256' &&
			expected.hash === createHash('sha256').update(header.headerString).digest('hex'),
		'ASAR header hash mismatch'
	);
	const files = listPackage(archive, { isPack: false });
	assert(files.length <= 100_000, 'ASAR entry bound exceeded');
	const unpackedFiles = new Set<string>();
	const unpackedDirectories = new Set<string>();
	for (const path of files) {
		assert(
			!path.includes('\\') && path.split('/').every((part) => part !== '..' && part !== '.'),
			'Invalid ASAR path'
		);
		const relative = path.replace(/^\//, '');
		const entry = statFile(archive, relative, false);
		if ('files' in entry) {
			if (entry.unpacked) unpackedDirectories.add(relative);
			continue;
		}
		assert(!('link' in entry), 'Unexpected ASAR link');
		assert(
			Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= 128 * 1024 * 1024,
			'Invalid ASAR file bound'
		);
		let bytes: Buffer;
		if (entry.unpacked) {
			unpackedFiles.add(relative);
			const parts = relative.split('/');
			for (let index = 1; index < parts.length; index++)
				unpackedDirectories.add(parts.slice(0, index).join('/'));
			assert(
				['native_node_bridge.node', 'desktop_key_custody.node'].includes(
					relative.split('/').at(-1)!
				),
				'Undeclared unpacked native file'
			);
			const root = `${archive}.unpacked`;
			const file = realpathSync(resolve(root, relative));
			assert(
				file.startsWith(root + sep) &&
					lstatSync(file).isFile() &&
					lstatSync(file).size === entry.size,
				'Unpacked native artifact escapes or changed size'
			);
			command.run('codesign', [
				'--verify',
				'--strict',
				'--all-architectures',
				'-R',
				`anchor apple generic and certificate leaf[subject.OU] = "${team}"`,
				file
			]);
			assert(
				command
					.run('lipo', ['-archs', file])
					.stdout.trim()
					.split(/\s+/)
					.sort()
					.join(',') === [...architectures].sort().join(','),
				'Unpacked addon is not universal'
			);
			bytes = readFileSync(file);
		} else bytes = extractFile(archive, relative, false);
		assert(
			entry.integrity?.algorithm === 'SHA256' &&
				entry.integrity.hash === createHash('sha256').update(bytes).digest('hex'),
			'ASAR content hash mismatch'
		);
		const { blockSize, blocks } = entry.integrity;
		assert(
			Number.isSafeInteger(blockSize) &&
				blockSize > 0 &&
				blockSize <= 128 * 1024 * 1024 &&
				blocks.length === Math.max(1, Math.ceil(bytes.length / blockSize)),
			'Invalid ASAR block integrity'
		);
		for (const [index, hash] of blocks.entries())
			assert(
				hash ===
					createHash('sha256')
						.update(bytes.subarray(index * blockSize, (index + 1) * blockSize))
						.digest('hex'),
				'ASAR block hash mismatch'
			);
	}
	verifyUnpackedTree(`${archive}.unpacked`, unpackedFiles, unpackedDirectories);
	uncache(archive);
}

/** ASAR metadata is not an inventory of the adjacent on-disk directory. */
function verifyUnpackedTree(
	root: string,
	expectedFiles: ReadonlySet<string>,
	expectedDirectories: ReadonlySet<string>
): void {
	const rootStat = lstatSync(root, { throwIfNoEntry: false });
	if (!rootStat) {
		assert(expectedFiles.size === 0, 'Missing unpacked native tree');
		return;
	}
	assert(
		rootStat.isDirectory() && !rootStat.isSymbolicLink(),
		'Unpacked root must be a real directory'
	);
	const pending = [''];
	const observed = new Set<string>();
	let entries = 0;
	while (pending.length) {
		const directory = pending.pop()!;
		assert(directory.split('/').length <= 64, 'Unpacked directory depth exceeded');
		const handle = opendirSync(join(root, directory));
		try {
			for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
				assert(++entries <= 100_000, 'Unpacked directory entry bound exceeded');
				const relative = directory ? `${directory}/${entry.name}` : entry.name;
				assert(!entry.isSymbolicLink(), 'Unexpected unpacked symlink');
				if (entry.isDirectory()) {
					assert(expectedDirectories.has(relative), 'Undeclared unpacked directory');
					pending.push(relative);
				} else {
					assert(
						entry.isFile() && expectedFiles.has(relative),
						'Undeclared physical unpacked file'
					);
					observed.add(relative);
				}
			}
		} finally {
			handle.closeSync();
		}
	}
	assert(observed.size === expectedFiles.size, 'Missing declared unpacked file');
}
