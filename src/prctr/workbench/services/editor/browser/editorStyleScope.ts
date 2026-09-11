import { toDisposable, type IDisposable } from '../../../../base/common/lifecycle.js';

const scopes = new WeakMap<Document, { references: number; owned: boolean }>();

/** Overlapping modal/layout owners share one scope without removing each other's styles. */
export function acquireEditorStyleScope(document: Document): IDisposable {
	let scope = scopes.get(document);
	if (!scope) {
		scope = { references: 0, owned: !document.documentElement.classList.contains('prctr-editor-scope') };
		scopes.set(document, scope);
		document.documentElement.classList.add('prctr-editor-scope');
	}
	scope.references++;
	return toDisposable(() => {
		if (--scope.references !== 0) return;
		scopes.delete(document);
		if (scope.owned) document.documentElement.classList.remove('prctr-editor-scope');
	});
}
