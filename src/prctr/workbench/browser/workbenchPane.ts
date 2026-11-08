/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../base/common/cancellation.js';
import type { IDisposable } from '../../base/common/lifecycle.js';
import type { ResolvedWorkbenchItem, WorkbenchItem } from '../common/workbenchItem.js';

export interface WorkbenchPane extends IDisposable {
	readonly element: HTMLElement;
	setItem(model: ResolvedWorkbenchItem, token: CancellationToken): void | Promise<void>;
	clear(): void | Promise<void>;
	setVisible(visible: boolean): void;
	layout(width: number, height: number): void;
	focus(): void;
	getViewState(): Readonly<Record<string, unknown>> | undefined;
}
export interface WorkbenchItemResolver {
	readonly typeId: string;
	resolve(item: WorkbenchItem, token: CancellationToken): Promise<ResolvedWorkbenchItem>;
	createPane(document: Document): WorkbenchPane;
}
export class WorkbenchItemResolverRegistry {
	declare readonly _serviceBrand: undefined;
	readonly #resolvers = new Map<string, WorkbenchItemResolver>();
	register(resolver: WorkbenchItemResolver): IDisposable {
		if (this.#resolvers.has(resolver.typeId))
			throw new Error(`Workbench resolver ${resolver.typeId} is already registered`);
		this.#resolvers.set(resolver.typeId, resolver);
		return {
			dispose: () => {
				if (this.#resolvers.get(resolver.typeId) === resolver)
					this.#resolvers.delete(resolver.typeId);
			}
		};
	}
	get(typeId: string): WorkbenchItemResolver {
		const resolver = this.#resolvers.get(typeId);
		if (resolver === undefined)
			throw new Error(`No packaged resolver is registered for ${typeId}`);
		return resolver;
	}
}
