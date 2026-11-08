/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type {
	IntegratedBrowserIntent,
	IntegratedBrowserProjection,
	IntegratedBrowserSurface
} from '../../../../platform/integratedBrowser/common/browserProtocol.js';

/** The CandidateWindow preload's integrated-browser projection, intents and surface. */
export interface IntegratedBrowserRendererClient {
	projection(): Promise<IntegratedBrowserProjection>;
	intent(intent: IntegratedBrowserIntent): Promise<void>;
	surface(surface: IntegratedBrowserSurface): Promise<void>;
	surfaceFocus(): Promise<boolean>;
	onDidChange(listener: (projection: IntegratedBrowserProjection) => void): () => void;
	onDidChangeSurfaceFocus(listener: (focused: boolean) => void): () => void;
}

export const IIntegratedBrowserService = createDecorator<IIntegratedBrowserService>(
	'integratedBrowserService'
);

/**
 * The CandidateWindow's view of the privileged integrated browser. Main enforces
 * navigation; the window presents the projection and relays exact intents.
 */
export interface IIntegratedBrowserService extends IntegratedBrowserRendererClient {
	readonly _serviceBrand: undefined;
}

export class IntegratedBrowserService implements IIntegratedBrowserService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly client: IntegratedBrowserRendererClient) {}

	projection(): Promise<IntegratedBrowserProjection> {
		return this.client.projection();
	}

	intent(intent: IntegratedBrowserIntent): Promise<void> {
		return this.client.intent(intent);
	}

	surface(surface: IntegratedBrowserSurface): Promise<void> {
		return this.client.surface(surface);
	}

	surfaceFocus(): Promise<boolean> {
		return this.client.surfaceFocus();
	}

	onDidChange(listener: (projection: IntegratedBrowserProjection) => void): () => void {
		return this.client.onDidChange(listener);
	}

	onDidChangeSurfaceFocus(listener: (focused: boolean) => void): () => void {
		return this.client.onDidChangeSurfaceFocus(listener);
	}
}
