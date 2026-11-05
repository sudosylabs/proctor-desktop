import { createHash } from 'node:crypto';
import {
	chmodSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';

export const nativeServicePackage = Object.freeze({
	label: 'com.proctor.native',
	plistName: 'com.proctor.native.plist',
	bundleIdentifier: 'com.proctor.native.service',
	bundlePath: 'Contents/Helpers/ProctorNativeService.app',
	executable: 'native-security-helper',
	controlSocket: '/var/run/com.proctor.native.control',
	observationSocket: '/var/run/com.proctor.native.observation'
});

export interface NativeServiceReleaseIdentity {
	readonly teamIdentifier: string;
	readonly clientBundleIdentifier: string;
	readonly version: string;
}

export interface NativeServicePackageFile {
	readonly path: string;
	readonly bytes: Uint8Array;
	readonly mode: number;
}

/** The caller must build both helper and Node bridge with these identical inputs. */
export function nativeServiceBuildEnvironment(
	identity: NativeServiceReleaseIdentity
): Readonly<Record<string, string>> {
	validateIdentity(identity);
	const requirement = (identifier: string): string =>
		`anchor apple generic and identifier "${identifier}" and certificate leaf[subject.OU] = "${identity.teamIdentifier}"`;
	return {
		PRCTR_NATIVE_SERVICE_REQUIREMENT: requirement(nativeServicePackage.bundleIdentifier),
		PRCTR_NATIVE_CLIENT_REQUIREMENT: requirement(identity.clientBundleIdentifier)
	};
}

/** Unsigned assembly only. Registration, signing and capability admission are separate gates. */
export function planMacOsNativeServicePackage(
	identity: NativeServiceReleaseIdentity,
	universalExecutable: Uint8Array,
	provisioningProfile: Uint8Array
): readonly NativeServicePackageFile[] {
	validateIdentity(identity);
	validateUniversalExecutable(universalExecutable);
	if (provisioningProfile.byteLength === 0 || provisioningProfile.byteLength > 1024 * 1024) {
		throw new Error('Expected a bounded embedded provisioning profile');
	}
	const specification = nativeServicePackage;
	const contents = `${specification.bundlePath}/Contents`;
	const executablePath = `${contents}/MacOS/${specification.executable}`;
	const file = (
		path: string,
		value: string | Uint8Array,
		mode = 0o644
	): NativeServicePackageFile => ({
		path,
		bytes: typeof value === 'string' ? Buffer.from(value) : Uint8Array.from(value),
		mode
	});
	return [
		file(executablePath, universalExecutable, 0o755),
		file(`${contents}/embedded.provisionprofile`, provisioningProfile),
		file(
			`${contents}/Info.plist`,
			plist([
				['CFBundleIdentifier', string(specification.bundleIdentifier)],
				['CFBundleExecutable', string(specification.executable)],
				['CFBundleName', string('Proctor Native Service')],
				['CFBundlePackageType', string('APPL')],
				['CFBundleVersion', string(identity.version)],
				['CFBundleShortVersionString', string(identity.version)],
				['LSMinimumSystemVersion', string('13.0')],
				['LSBackgroundOnly', '<true/>']
			])
		),
		file(
			`Contents/Library/LaunchDaemons/${specification.plistName}`,
			plist([
				['Label', string(specification.label)],
				['BundleProgram', string(executablePath)],
				[
					'ProgramArguments',
					`<array>${string(specification.executable)}${string('--service')}</array>`
				],
				['UserName', string('root')],
				['RunAtLoad', '<false/>'],
				['KeepAlive', '<false/>'],
				[
					'Sockets',
					dictionary([
						['ProctorControl', socket(specification.controlSocket)],
						['ProctorObservation', socket(specification.observationSocket)]
					])
				]
			])
		)
	];
}

export const nativeServiceEntitlements = plist([
	['com.apple.developer.endpoint-security.client', '<true/>']
]);

/** Writes a new staging directory, never mutates an installed application. */
export function stageMacOsNativeServicePackage(
	output: string,
	files: readonly NativeServicePackageFile[]
): readonly { readonly path: string; readonly sha256: string; readonly mode: number }[] {
	const destination = resolve(output);
	const parent = dirname(destination);
	if (realpathSync(parent) !== parent || !lstatSync(parent).isDirectory()) {
		throw new Error('Native service staging requires a real existing parent directory');
	}
	for (const file of files) {
		if (
			!file.path.startsWith('Contents/') ||
			file.path.includes('\\') ||
			file.path.split('/').some((part) => part === '..' || part === '.' || part === '')
		) {
			throw new Error('Invalid native service package path');
		}
	}
	if (new Set(files.map((file) => file.path)).size !== files.length) {
		throw new Error('Duplicate native service package path');
	}
	mkdirSync(destination); // Exclusive: an existing destination is never replaced.
	chmodSync(destination, 0o755);
	return files.map((file) => {
		const target = resolve(destination, file.path);
		mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
		for (
			let directory = dirname(target);
			directory !== destination;
			directory = dirname(directory)
		) {
			chmodSync(directory, 0o755);
		}
		writeFileSync(target, file.bytes, { flag: 'wx', mode: file.mode });
		chmodSync(target, file.mode);
		return {
			path: file.path,
			sha256: createHash('sha256').update(readFileSync(target)).digest('hex'),
			mode: lstatSync(target).mode & 0o777
		};
	});
}

function validateIdentity(identity: NativeServiceReleaseIdentity): void {
	if (
		!/^[A-Z0-9]{10}$/.test(identity.teamIdentifier) ||
		!/^com\.proctor\.[A-Za-z0-9.-]+$/.test(identity.clientBundleIdentifier) ||
		!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(identity.version)
	) {
		throw new Error('Expected explicit Proctor release signing identity and numeric version');
	}
}

function validateUniversalExecutable(bytes: Uint8Array): void {
	const buffer = Buffer.from(bytes);
	if (
		buffer.length < 48 ||
		buffer.readUInt32BE(0) !== 0xcafebabe ||
		buffer.readUInt32BE(4) !== 2
	) {
		throw new Error('Native service requires an arm64/x64 universal Mach-O executable');
	}
	const architectures = new Set<number>();
	const ranges: { start: number; end: number }[] = [];
	for (const offset of [8, 28]) {
		const architecture = buffer.readUInt32BE(offset);
		const start = buffer.readUInt32BE(offset + 8);
		const size = buffer.readUInt32BE(offset + 12);
		if (
			![0x01000007, 0x0100000c].includes(architecture) ||
			architectures.has(architecture) ||
			start < 48 ||
			size < 32 ||
			start + size > buffer.length ||
			buffer.readUInt32LE(start) !== 0xfeedfacf ||
			buffer.readUInt32LE(start + 4) !== architecture ||
			buffer.readUInt32LE(start + 12) !== 2 ||
			ranges.some((range) => start < range.end && start + size > range.start)
		) {
			throw new Error('Invalid or overlapping native service Mach-O architecture');
		}
		architectures.add(architecture);
		ranges.push({ start, end: start + size });
	}
}

function string(value: string): string {
	return `<string>${value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}</string>`;
}
function dictionary(entries: readonly (readonly [string, string])[]): string {
	return `<dict>${entries.map(([key, value]) => `<key>${key}</key>${value}`).join('')}</dict>`;
}
function plist(entries: readonly (readonly [string, string])[]): string {
	return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${dictionary(entries)}</plist>\n`;
}
function socket(path: string): string {
	return dictionary([
		['SockPathName', string(path)],
		['SockPathMode', '<integer>438</integer>'],
		['SockType', string('stream')]
	]);
}
