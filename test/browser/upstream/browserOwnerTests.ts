import '../editor/settingsJsonEditor.test.ts';
import '../editor/jsonLanguageFeatures.test.ts';
import '../editor/styleSheet.test.ts';
import './controls/dialog.test.ts';
import './controls/toggle.test.ts';
import './controls/selectBox.test.ts';
import { acquireEditorStyleScope } from '../../../src/prctr/workbench/services/editor/browser/editorStyleScope.ts';
import './notifications/scrollableElement.test.ts';
import './notifications/scrollbarState.test.ts';
import './notifications/listWidget.test.ts';
import './notifications/listView.test.ts';
import './notifications/rangeMap.test.ts';
import './dom.test.ts';
import './keyboardEvent.test.ts';
import './contextKeyService.test.ts';
import { runRegisteredBrowserTests } from './testAdapter.ts';

export async function runBrowserInteractionOwnerTests(): Promise<number> {
	const scope = acquireEditorStyleScope(document);
	let result;
	try { result = await runRegisteredBrowserTests(); } finally { scope.dispose(); }
	if (result.failures.length > 0)
		throw new Error(`Browser interaction owner tests failed:\n${result.failures.join('\n')}`);
	return result.passed;
}

import '../editor/settingsCatalog.test.ts';
