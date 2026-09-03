import ts from 'typescript';

export function verifyCopiedSource(
	upstream: string,
	local: string,
	clusterId: string,
	transforms: readonly string[]
): void {
	if (local !== reconstructCopiedSource(upstream, clusterId, transforms)) {
		throw new Error(
			'Source classified copied cannot be reconstructed from the declared transformations; restore the exact copy or review and record the adaptation.'
		);
	}
}

/** Reconstruct exact copies; never normalize away an unrecorded source edit. */
export function reconstructCopiedSource(
	upstream: string,
	clusterId: string,
	transforms: readonly string[]
): string {
	let result = upstream;
	if (transforms.includes('erasable-syntax-rewrite')) {
		const source = ts.createSourceFile('upstream.ts', result, ts.ScriptTarget.Latest, true);
		const edits: Array<{ start: number; end: number; text: string }> = [];
		const visit = (node: ts.Node): void => {
			if (ts.isTypeAssertionExpression(node)) {
				// The admitted rewrite changes (<Type>identifier) to (identifier as Type).
				// A broader expression rewrite needs a separately reviewed transformation.
				if (
					!ts.isIdentifier(node.expression) ||
					!ts.isParenthesizedExpression(node.parent)
				) {
					throw new Error(
						'Unsupported copied-source assertion rewrite; review the transformation or classify the file as adapted.'
					);
				}
				edits.push({
					start: node.getStart(source),
					end: node.end,
					text: `${node.expression.text} as ${node.type.getText(source)}`
				});
			}
			ts.forEachChild(node, visit);
		};
		visit(source);
		for (const edit of edits.reverse())
			result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
	}
	if (transforms.includes('provenance-marker-insertion')) {
		const header = /^(\/\*[\s\S]*?\*\/\r?\n)/u;
		if (!header.test(result))
			throw new Error(
				'Copied source has no initial license header for its provenance marker.'
			);
		result = result.replace(header, `$1// @proctor-vscode-port ${clusterId}\n`);
	}
	// Namespace/path translation relocates these sources without changing their
	// relative imports. Any additional byte change must receive explicit treatment.
	return result;
}
