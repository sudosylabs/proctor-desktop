import { inspectEnvironment } from '../build/lib/environment.ts';
import { electronExecutable, stockElectronExecutable } from '../build/lib/electron.ts';
import { repositoryPath } from '../build/lib/paths.ts';
import { runNode } from '../build/lib/process.ts';

if (process.argv.length > 2) throw new Error('Usage: npm run setup');
const failures = inspectEnvironment(false).filter(
	(fact) => ['Node', 'npm', 'Dependencies'].includes(fact.name) && !fact.ok
);
if (failures.length)
	throw new Error(failures.map((fact) => `${fact.name}: ${fact.detail}`).join('\n'));
try {
	stockElectronExecutable();
} catch {
	for (const key of [
		'ELECTRON_OVERRIDE_DIST_PATH',
		'ELECTRON_SKIP_BINARY_DOWNLOAD',
		'ELECTRON_MIRROR',
		'ELECTRON_CUSTOM_DIR',
		'ELECTRON_CUSTOM_FILENAME',
		'electron_config_cache'
	]) {
		if (process.env[key])
			throw new Error(`Unset ${key} before provisioning the pinned Electron runtime.`);
	}
	runNode([repositoryPath('node_modules/electron/install.js')]);
}
console.log(`Electron ready: ${electronExecutable()}`);
