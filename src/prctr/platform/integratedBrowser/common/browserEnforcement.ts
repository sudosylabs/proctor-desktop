/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { BrowserNavigationDecision } from './browserPolicy.js';

export interface PrivilegedBrowserEngine {
	open(url: string): Promise<void>;
	navigate(url: string): Promise<void>;
	back(): Promise<void>;
	forward(): Promise<void>;
	reload(): Promise<void>;
	close(): Promise<void>;
	setInputBlocked(blocked: boolean): void;
	historyState(): { readonly canGoBack: boolean; readonly canGoForward: boolean };
}

/** Privileged navigation hooks implemented by the Attempt-scoped coordinator. */
export interface BrowserEnforcementDelegate {
	checkTopLevel(url: string, kind: 'navigation' | 'redirect', redirectFromRuleId?: string): BrowserNavigationDecision;
	commitTopLevel(url: string, kind: 'navigation' | 'redirect'): void;
	checkSubresource(url: string): boolean;
	blockPopup(url: string): void;
}
