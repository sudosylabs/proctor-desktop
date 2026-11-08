import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type {
	UserSettingsCommitIntent,
	UserSettingsCommitResponse,
	UserSettingsProjection
} from '../../../../platform/settings/common/settingsRendererProtocol.js';

/** Authenticated, capability-specific transport supplied by the renderer composition root. */
export interface SettingsRendererClient {
	projection(): Promise<UserSettingsProjection>;
	preview(intent: { readonly source: string }): Promise<void>;
	cancelPreview(): Promise<void>;
	commit(intent: UserSettingsCommitIntent): Promise<UserSettingsCommitResponse>;
	onDidChange(listener: (projection: UserSettingsProjection) => void): () => void;
}

export const IUserSettingsService = createDecorator<IUserSettingsService>('userSettingsService');

/**
 * The account's User Settings in this window. Electron main owns the authoritative
 * document; this service presents its projection and relays previews and commits.
 */
export interface IUserSettingsService extends SettingsRendererClient {
	readonly _serviceBrand: undefined;
}

export class UserSettingsService implements IUserSettingsService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly client: SettingsRendererClient) {}

	projection(): Promise<UserSettingsProjection> {
		return this.client.projection();
	}

	preview(intent: { readonly source: string }): Promise<void> {
		return this.client.preview(intent);
	}

	cancelPreview(): Promise<void> {
		return this.client.cancelPreview();
	}

	commit(intent: UserSettingsCommitIntent): Promise<UserSettingsCommitResponse> {
		return this.client.commit(intent);
	}

	onDidChange(listener: (projection: UserSettingsProjection) => void): () => void {
		return this.client.onDidChange(listener);
	}
}
