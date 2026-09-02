import {
	DisposableStore,
	DisposableTracker,
	setDisposableTracker,
	type IDisposable
} from '../../../src/prctr/base/common/lifecycle.ts';
import { setup, teardown } from './testAdapter.ts';
export function ensureNoDisposablesAreLeakedInTestSuite(): Pick<DisposableStore, 'add'> {
	let tracker: DisposableTracker | undefined;
	let store: DisposableStore | undefined;
	setup(() => {
		store = new DisposableStore();
		tracker = new DisposableTracker();
		setDisposableTracker(tracker);
	});
	teardown(() => {
		store?.dispose();
		setDisposableTracker(null);
		const result = tracker?.computeLeakingDisposables();
		tracker = undefined;
		store = undefined;
		if (result !== undefined)
			throw new Error(
				`There are ${result.leaks.length} undisposed disposables!${result.details}`
			);
	});
	return {
		add<T extends IDisposable>(disposable: T): T {
			if (store === undefined) throw new Error('Disposable test store is not active');
			return store.add(disposable);
		}
	};
}
