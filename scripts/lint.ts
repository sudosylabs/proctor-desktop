import { ESLint } from 'eslint';
import { FileSystemRepository } from '../build/checks/repository.ts';
import { repositoryRoot } from '../build/lib/paths.ts';
import { transferredFiles } from '../build/lib/formatOwnership.ts';

const arguments_ = process.argv.slice(2);
if (arguments_.length > 1 || arguments_.some((argument) => argument !== '--fix'))
	throw new Error('Usage: npm run lint | npm run lint:fix');
const repository = new FileSystemRepository(repositoryRoot);
const files = repository
	.files()
	.filter((path) => /\.(ts|mjs)$/.test(path) && repository.kind(path) === 'file');
if (!files.length) throw new Error('No lintable files found.');
const protectedPaths = transferredFiles(repository);
const eslint = new ESLint({ cwd: repositoryRoot });
if (arguments_.includes('--fix')) {
	const fixable = files.filter(
		(path) => !protectedPaths.has(path) && !path.includes('.generated.')
	);
	const fixer = new ESLint({ cwd: repositoryRoot, fix: true });
	await ESLint.outputFixes(await fixer.lintFiles(fixable));
}
// Recheck the bytes actually on disk, including protected files that cannot be fixed.
const results = await eslint.lintFiles(files);
console.log(await (await eslint.loadFormatter('stylish')).format(results));
if (results.some((result) => result.errorCount || result.warningCount)) process.exitCode = 1;
