import { posix } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { parse as parseYaml } from 'yaml';
import type { Check, Diagnostic } from './types.ts';
import { diagnostic } from './types.ts';
import { resolveRepositoryPath } from './repository.ts';

type MarkdownNode = {
	readonly type?: string;
	readonly url?: string;
	readonly children?: readonly MarkdownNode[];
};

function visit(node: MarkdownNode, callback: (node: MarkdownNode) => void): void {
	callback(node);
	for (const child of node.children ?? []) visit(child, callback);
}

function linkTarget(url: string): string {
	const withoutFragment = url.split('#', 1)[0] ?? '';
	try {
		return decodeURIComponent(withoutFragment);
	} catch {
		return withoutFragment;
	}
}

export const documentationCheck: Check = {
	id: 'repository.documentation',
	category: 'documentation',
	contractRequired: true,
	run: ({ repository }) => {
		const diagnostics: Diagnostic[] = [];
		for (const path of repository
			.files()
			.filter(
				(candidate) => candidate.endsWith('.md') && repository.kind(candidate) !== 'symlink'
			)) {
			let tree: MarkdownNode;
			try {
				tree = fromMarkdown(repository.read(path)) as MarkdownNode;
			} catch (error) {
				diagnostics.push(
					diagnostic(
						'repository.documentation',
						path,
						String(error),
						'Fix the Markdown syntax.'
					)
				);
				continue;
			}
			visit(tree, (node) => {
				if (
					!['link', 'image', 'definition'].includes(node.type ?? '') ||
					node.url === undefined
				)
					return;
				const target = linkTarget(node.url);
				if (target === '' || /^(?:https?:|mailto:)/.test(target)) return;
				if (
					target.startsWith('/') ||
					target.startsWith('file:') ||
					/^[A-Za-z]:[\\/]/.test(target)
				)
					diagnostics.push(
						diagnostic(
							'repository.documentation',
							path,
							`Machine-specific absolute link ${target}.`,
							'Use a repository-relative link.'
						)
					);
				else {
					const resolved = resolveRepositoryPath(path, target);
					if (resolved === '.scratch' || resolved.startsWith('.scratch/'))
						diagnostics.push(
							diagnostic(
								'repository.documentation',
								path,
								`Tracked documentation links to ignored scratch state ${target}.`,
								'Promote accepted knowledge to tracked documentation before linking it.'
							)
						);
					else if (!repository.exists(resolved))
						diagnostics.push(
							diagnostic(
								'repository.documentation',
								path,
								`Link target ${target} does not exist.`,
								'Correct the relative link or add its tracked target.'
							)
						);
				}
			});
		}
		const expectedLinks: Readonly<Record<string, string>> = {
			'.github/copilot-instructions.md': '../AGENTS.md',
			'.github/skills': '../.agents/skills',
			'.claude/skills': '../.agents/skills'
		};
		for (const [path, target] of Object.entries(expectedLinks))
			if (repository.readLink(path) !== target)
				diagnostics.push(
					diagnostic(
						'repository.documentation',
						path,
						`Agent alias must be a symlink to ${target}.`,
						'Restore the canonical symlink instead of maintaining a copy.'
					)
				);
		for (const path of repository
			.files()
			.filter((candidate) => /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(candidate))) {
			const text = repository.read(path);
			const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
			if (match === null) {
				diagnostics.push(
					diagnostic(
						'repository.documentation',
						path,
						'Skill has no YAML frontmatter.',
						'Add name and description frontmatter.'
					)
				);
				continue;
			}
			try {
				const value = parseYaml(match[1] as string) as {
					name?: unknown;
					description?: unknown;
				};
				const expected = path.split('/')[2];
				if (value.name !== expected)
					diagnostics.push(
						diagnostic(
							'repository.documentation',
							path,
							`Skill name does not match directory ${expected}.`,
							'Keep the canonical skill name equal to its directory.'
						)
					);
				if (typeof value.description !== 'string' || value.description.trim() === '')
					diagnostics.push(
						diagnostic(
							'repository.documentation',
							path,
							'Skill description is missing.',
							'Describe the trigger in YAML frontmatter.'
						)
					);
			} catch (error) {
				diagnostics.push(
					diagnostic(
						'repository.documentation',
						path,
						String(error),
						'Fix the skill YAML frontmatter.'
					)
				);
			}
			const uiPath = posix.join(posix.dirname(path), 'agents/openai.yaml');
			if (!repository.exists(uiPath))
				diagnostics.push(
					diagnostic(
						'repository.documentation',
						uiPath,
						'Skill UI metadata is missing.',
						'Add agents/openai.yaml for the canonical skill.'
					)
				);
			else
				try {
					const ui = parseYaml(repository.read(uiPath)) as {
						interface?: {
							display_name?: unknown;
							short_description?: unknown;
							default_prompt?: unknown;
						};
					};
					if (
						typeof ui.interface?.display_name !== 'string' ||
						typeof ui.interface.short_description !== 'string' ||
						typeof ui.interface.default_prompt !== 'string'
					)
						diagnostics.push(
							diagnostic(
								'repository.documentation',
								uiPath,
								'Skill UI metadata is incomplete.',
								'Declare display_name, short_description, and default_prompt.'
							)
						);
				} catch (error) {
					diagnostics.push(
						diagnostic(
							'repository.documentation',
							uiPath,
							String(error),
							'Fix the skill UI YAML.'
						)
					);
				}
		}
		const ignorePath = '.gitignore';
		if (!repository.exists(ignorePath))
			diagnostics.push(
				diagnostic(
					'repository.documentation',
					ignorePath,
					'Repository ignore policy is missing.',
					'Add the canonical root .gitignore.'
				)
			);
		else {
			const patterns = new Set(
				repository
					.read(ignorePath)
					.split('\n')
					.map((line) => line.trim())
					.filter((line) => line !== '' && !line.startsWith('#'))
			);
			for (const required of [
				'.scratch/',
				'node_modules/',
				'out/',
				'/native/target/',
				'coverage/',
				'artifacts/',
				'.generated-check/'
			])
				if (!patterns.has(required))
					diagnostics.push(
						diagnostic(
							'repository.documentation',
							ignorePath,
							`Required ignore pattern ${required} is missing.`,
							'Restore the foundation ignore policy.'
						)
					);
			if (patterns.has('target/'))
				diagnostics.push(
					diagnostic(
						'repository.documentation',
						ignorePath,
						'The unanchored target/ pattern can hide application source directories.',
						'Ignore only the native Cargo output at /native/target/.'
					)
				);
		}
		return diagnostics;
	}
};

const TEXT_EXTENSIONS = new Set([
	'.css',
	'.html',
	'.js',
	'.mjs',
	'.sh',
	'.json',
	'.jsonc',
	'.md',
	'.rs',
	'.toml',
	'.ts',
	'.yaml',
	'.yml'
]);
export const hygieneCheck: Check = {
	id: 'repository.hygiene',
	category: 'documentation',
	contractRequired: true,
	run: ({ repository }) => {
		const diagnostics: Diagnostic[] = [];
		for (const path of repository.files()) {
			if (repository.kind(path) === 'symlink') continue;
			const extension = posix.extname(path);
			if (
				!TEXT_EXTENSIONS.has(extension) &&
				posix.basename(path) !== 'Cargo.lock' &&
				![
					'.gitignore',
					'.gitattributes',
					'.editorconfig',
					'.prettierignore',
					'.githooks/pre-commit',
					'.npmrc',
					'.nvmrc',
					'AGENTS.md',
					'package.json'
				].includes(path)
			)
				continue;
			const text = repository.read(path);
			if (
				text.includes('\u0000') ||
				new TextDecoder('utf-8', { fatal: true }).decode(repository.readBytes(path)) !==
					text
			)
				diagnostics.push(
					diagnostic(
						'repository.hygiene',
						path,
						'Text is not valid UTF-8.',
						'Encode repository text as UTF-8.'
					)
				);
			if (!text.endsWith('\n'))
				diagnostics.push(
					diagnostic(
						'repository.hygiene',
						path,
						'Text lacks a final newline.',
						'End text files with one newline.'
					)
				);
			const lines = text.split('\n');
			lines.forEach((line, index) => {
				if (/[ \t]+$/.test(line))
					diagnostics.push(
						diagnostic(
							'repository.hygiene',
							path,
							'Line has trailing whitespace.',
							'Remove trailing spaces or tabs.',
							index + 1
						)
					);
			});
			if (extension === '.json')
				try {
					JSON.parse(text);
				} catch (error) {
					diagnostics.push(
						diagnostic(
							'repository.hygiene',
							path,
							String(error),
							'Fix the JSON syntax.'
						)
					);
				}
			if (extension === '.yaml' || extension === '.yml')
				try {
					parseYaml(text);
				} catch (error) {
					diagnostics.push(
						diagnostic(
							'repository.hygiene',
							path,
							String(error),
							'Fix the YAML syntax.'
						)
					);
				}
			const admittedUpstreamFixture =
				(path.startsWith('src/prctr/') || /^test\/.+\/upstream\//.test(path)) &&
				/@proctor-vscode-port\s+[a-z0-9]+(?:-[a-z0-9]+)*/.test(text);
			if (
				!admittedUpstreamFixture &&
				(/\/Users\/[^/]+\//.test(text) || /file:\/\//.test(text))
			)
				diagnostics.push(
					diagnostic(
						'repository.hygiene',
						path,
						'Tracked text contains a machine-specific absolute path.',
						'Use repository-relative paths or portable placeholders.'
					)
				);
		}
		return diagnostics;
	}
};

export const pinnedActionsCheck: Check = {
	id: 'ci.actions-pinned',
	category: 'documentation',
	contractRequired: true,
	run: ({ repository }) => {
		const diagnostics: Diagnostic[] = [];
		for (const path of repository
			.files()
			.filter(
				(candidate) =>
					candidate.startsWith('.github/workflows/') && /\.ya?ml$/.test(candidate)
			)) {
			try {
				parseYaml(repository.read(path));
			} catch (error) {
				diagnostics.push(
					diagnostic('ci.actions-pinned', path, String(error), 'Fix the workflow YAML.')
				);
				continue;
			}
			repository
				.read(path)
				.split('\n')
				.forEach((line, index) => {
					const match = /\buses:\s*([^\s#]+)@([^\s#]+)/.exec(line);
					if (match !== null && !/^[0-9a-f]{40}$/.test(match[2] as string))
						diagnostics.push(
							diagnostic(
								'ci.actions-pinned',
								path,
								`Action ${match[1]} is not pinned to a full commit SHA.`,
								'Pin every external action to a reviewed 40-character commit.',
								index + 1
							)
						);
				});
		}
		return diagnostics;
	}
};
