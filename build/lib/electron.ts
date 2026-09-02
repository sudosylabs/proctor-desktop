import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { repositoryPath } from './paths.ts';

// Reading metadata is deliberate: requiring `electron` may download binaries.
export function electronExecutable(root = repositoryPath('node_modules/electron')): string {
	const expected = (
		JSON.parse(readFileSync(repositoryPath('package.json'), 'utf8')) as {
			dependencies: { electron: string };
		}
	).dependencies.electron;
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
