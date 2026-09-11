import { createScanner, SyntaxKind } from './json.js';

/** Bound recursive JSON consumers with the same non-recursive scanner that recognizes JSONC trivia. */
export function findJsonDepthOverflow(source: string, maxDepth: number): number | undefined {
	const scanner = createScanner(source, true);
	const nesting: SyntaxKind[] = [];
	for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
		if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) {
			nesting.push(token);
			if (nesting.length > maxDepth) return scanner.getTokenOffset();
		} else if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) {
			const opening =
				token === SyntaxKind.CloseBraceToken
					? SyntaxKind.OpenBraceToken
					: SyntaxKind.OpenBracketToken;
			// The recursive parser recovers past a wrong-kind closer. Such a token
			// cannot make an enclosing array/object shallower for this preflight.
			if (nesting.at(-1) === opening) nesting.pop();
		}
	}
	return undefined;
}
