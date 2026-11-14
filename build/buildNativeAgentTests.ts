import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { buildNodeTests } from './lib/nodeTests.ts';
import { repositoryRoot } from './lib/paths.ts';

/** The native agent built with the test-only scripted capability, at a fixed path for the tests. */
export const NATIVE_AGENT_TEST_BINARY = join(
	'.build',
	'native-agent',
	process.platform === 'win32' ? 'prctr-agent.exe' : 'prctr-agent'
);

execFileSync(
	'cargo',
	[
		'build',
		'--locked',
		'--manifest-path',
		'native/Cargo.toml',
		'-p',
		'prctr-agent',
		'--features',
		'scripted-capabilities'
	],
	{ cwd: repositoryRoot, stdio: 'inherit' }
);
mkdirSync(join(repositoryRoot, '.build', 'native-agent'), { recursive: true });
copyFileSync(
	join(
		repositoryRoot,
		'native',
		'target',
		'debug',
		process.platform === 'win32' ? 'prctr-agent.exe' : 'prctr-agent'
	),
	join(repositoryRoot, NATIVE_AGENT_TEST_BINARY)
);
await buildNodeTests('native-agent', 'native-agent-tests', 'build/tsconfig.native-agent-test.json');
