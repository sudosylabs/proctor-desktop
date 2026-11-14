import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	constants,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { repositoryPath } from './paths.ts';

/**
 * The Electron that development, preview and Electron test runs launch. The operating
 * system names and decorates a process from its executable, so the stock distribution
 * is copied once into `.build/electron` with the development application's name,
 * icon and identity: the product's app ID with `.dev`. It then sits beside an
 * installed release as a separate application, with its own macOS permissions and
 * Windows taskbar entry. Linux keeps the stock executable.
 */
export function electronExecutable(): string {
	const stock = stockElectronExecutable();
	const branding = platformBranding();
	if (branding === undefined) return stock;
	const output = repositoryPath('.build/electron');
	const executable = join(output, branding.executable);
	const stamp = join(output, 'stamp.json');
	const fingerprint = JSON.stringify(brandingFingerprint(), null, '\t') + '\n';
	if (existsSync(executable) && readOptional(stamp) === fingerprint) return executable;

	mkdirSync(repositoryPath('.build'), { recursive: true });
	const stage = mkdtempSync(repositoryPath('.build/electron-'));
	try {
		branding.brand(stage);
		writeFileSync(join(stage, 'stamp.json'), fingerprint);
		try {
			rmSync(output, { recursive: true, force: true });
		} catch {
			throw new Error(
				`Cannot replace ${output}; quit the running Proctor Development app and try again.`
			);
		}
		renameSync(stage, output);
		console.log(`Prepared development Electron: ${executable}`);
		return executable;
	} finally {
		rmSync(stage, { recursive: true, force: true });
	}
}

/**
 * How to start the development Electron so it owns its privacy permissions. macOS gives
 * a process the camera, microphone, screen-recording and accessibility access of the app
 * that launched it, so a build started from a terminal, an editor or an agent would ask
 * for theirs; `macos/disclaim.c` starts it responsible for itself, as Chromium does for
 * its own processes. Elsewhere, or without a compiler, it starts as it is.
 */
export function developmentLaunch(args: readonly string[]): {
	readonly command: string;
	readonly args: readonly string[];
} {
	const executable = electronExecutable();
	if (process.platform !== 'darwin') return { command: executable, args };
	const source = repositoryPath('build/lib/macos/disclaim.c');
	const launcher = repositoryPath('.build/dev/disclaim');
	try {
		if (!existsSync(launcher) || statSync(source).mtimeMs > statSync(launcher).mtimeMs) {
			mkdirSync(repositoryPath('.build/dev'), { recursive: true });
			execFileSync('xcrun', ['clang', '-O2', '-Wall', '-Werror', '-o', launcher, source]);
		}
	} catch {
		console.warn(
			'Could not build the macOS permission launcher; permission prompts will name the app that started Proctor.'
		);
		return { command: executable, args };
	}
	return { command: launcher, args: [executable, ...args] };
}

/** Raised when a `brand*` function changes what it writes, so a prepared Electron is branded again. */
const BRANDING_REVISION = 1;

interface Branding {
	/** The executable, relative to `.build/electron`. */
	readonly executable: string;
	/** Writes the branded distribution into `output`. */
	brand(output: string): void;
}

interface DevelopmentIdentity {
	readonly name: string;
	readonly appId: string;
}

function developmentIdentity(): DevelopmentIdentity {
	const metadata = JSON.parse(readFileSync(repositoryPath('package.json'), 'utf8')) as {
		productName: string;
		appId: string;
	};
	return { name: `${metadata.productName} Development`, appId: `${metadata.appId}.dev` };
}

const icons = {
	darwin: 'resources/branding/platform/darwin/proctor.icns',
	win32: 'resources/branding/platform/win32/proctor.ico'
} as const;

function platformBranding(): Branding | undefined {
	const { name, appId } = developmentIdentity();
	const dist = repositoryPath('node_modules/electron/dist');
	if (process.platform === 'darwin') {
		const bundle = `${name}.app`;
		return {
			executable: join(bundle, 'Contents/MacOS/Electron'),
			brand: (output) =>
				brandDarwin(join(dist, 'Electron.app'), join(output, bundle), name, appId)
		};
	}
	if (process.platform === 'win32') {
		const executable = `${name}.exe`;
		return { executable, brand: (output) => brandWin32(dist, output, executable, name) };
	}
	return undefined;
}

function brandingFingerprint(): Record<string, string> {
	const icon = process.platform === 'win32' ? icons.win32 : icons.darwin;
	return {
		revision: String(BRANDING_REVISION),
		electron: pinnedElectronVersion(),
		platform: `${process.platform}-${process.arch}`,
		identity: JSON.stringify(developmentIdentity()),
		icon: createHash('sha256')
			.update(readFileSync(repositoryPath(icon)))
			.digest('hex')
	};
}

/** macOS names the menu bar, Dock and permission prompts after the bundle's Info.plist. */
function brandDarwin(source: string, bundle: string, name: string, appId: string): void {
	cpSync(source, bundle, {
		recursive: true,
		verbatimSymlinks: true,
		mode: constants.COPYFILE_FICLONE
	});
	const resources = join(bundle, 'Contents/Resources');
	cpSync(repositoryPath(icons.darwin), join(resources, 'proctor.icns'));
	rmSync(join(resources, 'electron.icns'), { force: true });
	const plist = join(bundle, 'Contents/Info.plist');
	for (const [key, value] of [
		['CFBundleName', name],
		['CFBundleDisplayName', name],
		// Its own identifier keeps permissions, Keychain access and Launch Services apart from a release.
		['CFBundleIdentifier', appId],
		['CFBundleIconFile', 'proctor.icns']
	] as const) {
		execFileSync('plutil', ['-replace', key, '-string', value, plist]);
	}
	// Nested helpers keep their own signatures. The x64 distribution ships them unsigned, down
	// to the framework's own helpers, and codesign refuses to seal a bundle around unsigned
	// code, so each unsigned one is signed ad hoc first, with everything inside it.
	const frameworks = join(bundle, 'Contents/Frameworks');
	for (const entry of readdirSync(frameworks)) {
		const nested = join(frameworks, entry);
		try {
			execFileSync('codesign', ['--verify', nested], { stdio: 'ignore' });
		} catch {
			execFileSync('codesign', ['--force', '--deep', '--sign', '-', nested]);
		}
	}
	// The executable's seal covers Info.plist.
	execFileSync('codesign', ['--force', '--sign', '-', join(bundle, 'Contents/MacOS/Electron')]);
	execFileSync('codesign', ['--force', '--sign', '-', bundle]);
}

/**
 * The part of `resedit` the Windows branding uses. Declared here and loaded only on
 * Windows: the package's own declarations bring the DOM library into Node builds.
 */
interface ResEdit {
	readonly NtExecutable: {
		from(bin: Uint8Array, options: { ignoreCert: boolean }): { generate(): ArrayBuffer };
	};
	readonly NtExecutableResource: {
		from(exe: unknown): { readonly entries: unknown[]; outputResource(exe: unknown): void };
	};
	readonly Data: {
		readonly IconFile: {
			from(bin: Uint8Array): { readonly icons: readonly { readonly data: unknown }[] };
		};
	};
	readonly Resource: {
		readonly IconGroupEntry: {
			fromEntries(
				entries: unknown[]
			): readonly { readonly id: number; readonly lang: number }[];
			replaceIconsForResource(
				entries: unknown[],
				id: number,
				lang: number,
				icons: unknown[]
			): void;
		};
		readonly VersionInfo: {
			fromEntries(entries: unknown[]): readonly {
				getAllLanguagesForStringValues(): readonly unknown[];
				setStringValues(language: unknown, values: Record<string, string>): void;
				outputToResourceEntries(entries: unknown[]): void;
			}[];
		};
	};
}

/** Windows takes the taskbar, Task Manager and permission names and icon from the executable's resources. */
function brandWin32(dist: string, output: string, executable: string, name: string): void {
	cpSync(dist, output, { recursive: true });
	const path = join(output, executable);
	renameSync(join(output, 'electron.exe'), path);
	const { Data, NtExecutable, NtExecutableResource, Resource } = createRequire(import.meta.url)(
		'resedit'
	) as ResEdit;
	// The stock signature does not survive the edit; the development executable is unsigned.
	const exe = NtExecutable.from(readFileSync(path), { ignoreCert: true });
	const resources = NtExecutableResource.from(exe);
	const icon = Data.IconFile.from(readFileSync(repositoryPath(icons.win32)));
	for (const group of Resource.IconGroupEntry.fromEntries(resources.entries)) {
		Resource.IconGroupEntry.replaceIconsForResource(
			resources.entries,
			group.id,
			group.lang,
			icon.icons.map((item) => item.data)
		);
	}
	for (const version of Resource.VersionInfo.fromEntries(resources.entries)) {
		for (const language of version.getAllLanguagesForStringValues()) {
			version.setStringValues(language, {
				FileDescription: name,
				ProductName: name,
				InternalName: name,
				OriginalFilename: executable
			});
		}
		version.outputToResourceEntries(resources.entries);
	}
	resources.outputResource(exe);
	writeFileSync(path, Buffer.from(exe.generate()));
}

function pinnedElectronVersion(): string {
	return (
		JSON.parse(readFileSync(repositoryPath('package.json'), 'utf8')) as {
			dependencies: { electron: string };
		}
	).dependencies.electron;
}

function readOptional(path: string): string | undefined {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return undefined;
	}
}

/**
 * The pinned stock Electron. Reading metadata is deliberate: requiring `electron` may
 * download binaries.
 */
export function stockElectronExecutable(root = repositoryPath('node_modules/electron')): string {
	const expected = pinnedElectronVersion();
	const platformPath =
		process.platform === 'darwin'
			? 'Electron.app/Contents/MacOS/Electron'
			: process.platform === 'win32'
				? 'electron.exe'
				: 'electron';
	const executable = join(root, 'dist', platformPath);
	let version: string | undefined;
	try {
		version = readFileSync(join(root, 'dist/version'), 'utf8').trim().replace(/^v/, '');
	} catch {
		/* Missing runtime is diagnosed below. */
	}
	if (version !== expected || !existsSync(executable)) {
		throw new Error(
			`Electron ${expected} is not prepared for ${process.platform}/${process.arch}. Run npm run setup.`
		);
	}
	if (
		process.env.ELECTRON_OVERRIDE_DIST_PATH &&
		resolve(process.env.ELECTRON_OVERRIDE_DIST_PATH) !== resolve(root, 'dist')
	) {
		throw new Error(
			'ELECTRON_OVERRIDE_DIST_PATH conflicts with the pinned development runtime.'
		);
	}
	return executable;
}
