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
