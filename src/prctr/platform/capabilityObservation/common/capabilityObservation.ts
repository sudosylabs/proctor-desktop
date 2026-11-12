/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * A closed capability a renderer can observe: it names an intent of the capability's own
 * protocol, never an operation, URL or query key, and is told each new answer until it disposes.
 * The subscription is an `IDisposable` by shape; it is spelled out so the capability protocols
 * stay free of runtime imports.
 */
export interface ObservableCapability<I, R> {
	observe?(intent: I, listener: (response: R) => void): { dispose(): void };
}
