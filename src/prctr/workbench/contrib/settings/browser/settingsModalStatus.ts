import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../base/common/vscodeNls.js';
import type { SettingsEditorSession } from '../../../services/settings/browser/settingsEditorSession.js';
import './settingsModalStatus.css';

/** Explicit-save feedback stays visible and announced within its modal owner. */
export class SettingsModalStatus extends Disposable {
	constructor(container: HTMLElement, session: SettingsEditorSession) {
		super();
		const element = container.ownerDocument.createElement('div');
		element.className = 'prctr-settings-modal-status';
		element.setAttribute('role', 'status');
		element.setAttribute('aria-atomic', 'true');
		container.append(element);
		this._register({ dispose: () => element.remove() });
		const messages = {
			discardFailed: localize(
				'settings.discardFailed',
				'The previous save is unresolved. Your draft is retained.'
			),
			ready: localize('settings.pending', 'Changes are saved only when you choose Save.'),
			saved: localize('settings.saved', 'Settings saved.'),
			invalid: localize(
				'settings.invalid',
				'Fix the settings.json problems before saving. The last saved settings remain active.'
			),
			saving: localize('settings.saving', 'Saving settings…'),
			readonly: localize(
				'settings.readonly',
				'Settings are read-only while the server is unavailable.'
			),
			conflict: localize(
				'settings.conflict',
				'This draft conflicts with newer settings. Discard to use the server version.'
			),
			merged: localize(
				'settings.merged',
				'Newer settings were merged. Review and save again.'
			),
			ambiguous: localize(
				'settings.ambiguous',
				'Save completion is unknown. Save again to check the same request.'
			),
			failed: localize(
				'settings.failed',
				'Settings could not be saved. Your draft is retained.'
			),
			previewFailed: localize(
				'settings.previewFailed',
				'The preview could not be applied. Your draft is retained.'
			)
		};
		const update = (): void => {
			const text =
				session.status === 'saved' && session.isDirty()
					? localize(
							'settings.savedWithChanges',
							'Settings saved. Newer changes are still unsaved.'
						)
					: messages[session.status];
			if (element.textContent !== text) element.textContent = text;
		};
		this._register(session.onDidChangeState(update));
		update();
	}
}
