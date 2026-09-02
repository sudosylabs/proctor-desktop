import { runNode } from '../build/lib/process.ts';
import { selectFiles } from '../build/lib/paths.ts';
import { selectSuites, testSuites, type TestSuite } from '../build/lib/testSuites.ts';
import { electronExecutable } from '../build/lib/electron.ts';

const [selection = 'unit', ...extra] = process.argv.slice(2);
if (extra.length > 0) throw new Error(`Unexpected test arguments: ${extra.join(' ')}`);
if (selection === '--help' || selection === '--list') {
	console.log(
		`Usage: node scripts/test.ts <unit|electron|${Object.keys(testSuites).join('|')}>\nEach suite builds its prerequisites. Electron must first be provisioned with npm run setup.`
	);
} else {
	for (const name of selectSuites(selection)) {
		const suite: TestSuite = testSuites[name];
		const sources = selectFiles(suite.patterns);
		if (suite.runtime === 'electron') electronExecutable();
		if (suite.build) runNode([suite.build]);
		runNode([
			'--test',
			'--test-timeout=60000',
			...(suite.output ? selectFiles([suite.output]) : sources)
		]);
	}
}
