import type { Event } from '../../../../base/common/event.js';
import type { ConfirmResult } from '../../../../platform/dialogs/common/dialogs.js';

/** The editor projects draft state; the Settings owner controls persistence and close decisions. */
export interface SettingsEditorInputHost {
	readonly onDidChangeState: Event<void>;
	isDirty(): boolean;
	isReadonly(): boolean;
	isSaving(): boolean;
	confirmClose(): Promise<ConfirmResult>;
	save(): Promise<boolean>;
	revert(): Promise<void>;
}
