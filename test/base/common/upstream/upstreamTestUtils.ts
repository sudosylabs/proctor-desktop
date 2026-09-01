/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port base-common-runtime

import { setup, teardown } from './testAdapter.ts';
import {
  DisposableStore,
  DisposableTracker,
  setDisposableTracker,
  type IDisposable
} from '../../../../src/prctr/base/common/lifecycle.ts';

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
    if (result !== undefined) {
      throw new Error(`There are ${result.leaks.length} undisposed disposables!${result.details}`);
    }
  });
  return {
    add<T extends IDisposable>(disposable: T): T {
      if (store === undefined) throw new Error('Disposable test store is not active');
      return store.add(disposable);
    }
  };
}

export function throwIfDisposablesAreLeaked(body: () => void, logToConsole = true): void {
  const tracker = new DisposableTracker();
  setDisposableTracker(tracker);
  try {
    body();
  } finally {
    setDisposableTracker(null);
  }
  const result = tracker.computeLeakingDisposables();
  if (result !== undefined) {
    if (logToConsole) console.error(result.details);
    throw new Error(`There are ${result.leaks.length} undisposed disposables!${result.details}`);
  }
}
