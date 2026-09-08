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
	const result = await runRegisteredBrowserTests();
	if (result.failures.length > 0)
		throw new Error(`Browser interaction owner tests failed:\n${result.failures.join('\n')}`);
	return result.passed;
}
