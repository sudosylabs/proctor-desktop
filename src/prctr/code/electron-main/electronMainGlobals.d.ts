/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

type Timeout = NodeJS.Timeout;

interface IdleDeadline {
	readonly didTimeout: boolean;
	timeRemaining(): number;
}

declare function requestIdleCallback(callback: (deadline: IdleDeadline) => void, options?: { readonly timeout: number }): number;
declare function cancelIdleCallback(handle: number): void;
