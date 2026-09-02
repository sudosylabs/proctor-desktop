import { ESLint } from 'eslint';
import { FileSystemRepository } from '../build/checks/repository.ts';
import { hygieneCheck } from '../build/checks/documentation.ts';
import { readIndex, stagedPaths } from '../build/lib/indexRepository.ts';
import { formatText } from '../build/lib/format.ts';
import { repositoryRoot } from '../build/lib/paths.ts';

if (process.argv.length > 2) throw new Error('Usage: npm run check:staged');
const paths = stagedPaths();
if (paths.length) {
	const index = readIndex();
	const worktree = new FileSystemRepository(repositoryRoot);
	// Lint/formatter implementation executes locally. Refuse a mixed policy snapshot.
	const policy = new Set(
		[...index.files(), ...worktree.files()].filter((path) =>
			/^(?:build\/|scripts\/|docs\/upstream\/vscode-ports\/|eslint\.config\.|tsconfig|\.prettier|package(?:-lock)?\.json)/.test(
				path
			)
		)
	);
	for (const path of policy) {
		if (
			index.kind(path) !== 'file' ||
			worktree.kind(path) !== 'file' ||
			index.read(path) !== worktree.read(path)
		)
			throw new Error(
				`Stage tooling policy together with its working copy before checking: ${path}`
			);
	}
	const selected = new Set(paths);
	const diagnostics = await hygieneCheck.run({
		repository: index,
		registeredCheckIds: new Set()
	});
	for (const diagnostic of diagnostics.filter((diagnostic) => selected.has(diagnostic.path))) {
		console.error(`${diagnostic.path}: ${diagnostic.problem}`);
		process.exitCode = 1;
	}
	// The fast hook checks staged syntax, not a mixture of index text and worktree types.
	const eslint = new ESLint({
		cwd: repositoryRoot,
		overrideConfig: {
			languageOptions: { parserOptions: { project: null, projectService: false } },
			rules: {
				'@typescript-eslint/no-floating-promises': 'off',
				'@typescript-eslint/no-misused-promises': 'off'
			}
		}
	});
	const results = [];
	for (const path of paths) {
		if (index.kind(path) !== 'file') continue;
		const text = index.read(path);
		const formatted = await formatText(path, text);
		if (formatted !== undefined && formatted !== text) {
			console.error(`Staged formatting differs: ${path}`);
			process.exitCode = 1;
		}
		if (/\.(?:ts|mjs)$/.test(path) && !(await eslint.isPathIgnored(path)))
			results.push(...(await eslint.lintText(text, { filePath: path })));
	}
	console.log(await (await eslint.loadFormatter('stylish')).format(results));
	if (results.some((result) => result.errorCount || result.warningCount)) process.exitCode = 1;
}
console.log(`Staged check: ${paths.length} paths; index and working files unchanged.`);
