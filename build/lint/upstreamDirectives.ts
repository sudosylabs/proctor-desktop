import type { Linter } from 'eslint';
import ts from 'typescript';

const standard = new Set([
	'no-debugger',
	'no-async-promise-executor',
	'no-unsafe-finally',
	'no-constant-binary-expression',
	'no-dupe-else-if',
	'no-duplicate-case',
	'no-eval',
	'no-loss-of-precision'
]);

// Only real comments are rewritten in the lint input, never string/regex fixtures
// or disk content. Original source locations and applicable exceptions survive.
export const upstreamDirectives: Linter.Processor = {
	preprocess(text) {
		const source = ts.createSourceFile('upstream.ts', text, ts.ScriptTarget.Latest, true);
		const comments = new Map<number, ts.CommentRange>();
		function visit(node: ts.Node): void {
			for (const range of [
				...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []),
				...(ts.getTrailingCommentRanges(text, node.end) ?? [])
			])
				comments.set(range.pos, range);
			// Include punctuation tokens: comments before a closing brace or else
			// are not attached to the semantic children returned by forEachChild.
			for (const child of node.getChildren(source)) visit(child);
		}
		visit(source);
		for (const { pos, end } of [...comments.values()].sort((a, b) => b.pos - a.pos)) {
			const original = text.slice(pos, end);
			const match =
				/^(\/[/\*]\s*eslint-(?:disable-next-line|disable-line|disable|enable))\s*([^\r\n]*?)(\*\/)?$/.exec(
					original
				);
			if (!match) continue;
			const selected =
				(match[2] ?? '')
					.split(' -- ')[0]
					?.split(',')
					.map((rule) => rule.trim())
					.flatMap((rule) => {
						if (rule === 'local/code-no-potentially-unsafe-disposables')
							return ['proctor/disposable-ownership'];
						return standard.has(rule) ? [rule] : [];
					}) ?? [];
			const replacement = selected.length
				? `${match[1]} ${selected.join(', ')}${match[3] ? ' */' : ''}`
				: original.replace('eslint-', 'ported-');
			if (replacement.length > original.length)
				throw new Error('Upstream directive translation must preserve source offsets.');
			text = text.slice(0, pos) + replacement.padEnd(original.length, ' ') + text.slice(end);
		}
		return [text];
	},
	postprocess(messages) {
		return messages[0] ?? [];
	},
	supportsAutofix: false
};
