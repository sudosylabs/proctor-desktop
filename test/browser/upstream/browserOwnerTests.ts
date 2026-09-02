import './dom.test.ts';
import './keyboardEvent.test.ts';
import { runRegisteredBrowserTests } from './testAdapter.ts';

export async function runBrowserInteractionOwnerTests(): Promise<number> {
  const result = await runRegisteredBrowserTests();
  if (result.failures.length > 0) throw new Error(`Browser interaction owner tests failed:\n${result.failures.join('\n')}`);
  return result.passed;
}
