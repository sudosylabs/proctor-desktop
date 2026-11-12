/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { TextFieldControl } from '../../../../base/browser/ui/field/textField.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type {
	AccountIntent,
	AccountResponse
} from '../../../../platform/account/common/accountProtocol.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import { PageDialog } from '../../../browser/authenticated/pages/pageDialog.js';
import { PageFeedback } from '../../../browser/authenticated/pages/pageFeedback.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAccountService } from '../../../services/account/common/account.js';
import { IAccountFormatService } from '../accountFormat.js';
import { failureNeedsRead } from '../common/accountPresentation.js';
import './media/sessionDialogs.css';

const RENAME_ICON = proctorIconFactory('action.edit');
const NAME_LIMIT = 128;

/** What is being renamed: a browser or command-line Session, or a registered computer. */
export type RenameTarget =
	| { readonly kind: 'session'; readonly id: string; readonly name: string }
	| { readonly kind: 'desktop'; readonly id: string; readonly name: string };

/**
 * Renames a Session or a registered computer. A Desktop Session is named by its registration:
 * when the server says so, the same name goes to that registration instead.
 */
export class RenameDialog extends Disposable {
	private readonly dialog: PageDialog;
	private readonly field: TextFieldControl;
	private readonly feedback: PageFeedback;
	private readonly cancel: ButtonControl;
	private readonly save: ButtonControl;
	private value: string;
	private working = false;

	constructor(
		private readonly target: RenameTarget,
		private readonly onDidComplete: (result: AccountResponse) => void,
		@IAccountService private readonly account: IAccountService,
		@IAccountFormatService private readonly format: IAccountFormatService,
		@IPagePaneContext pane: IPagePaneContext
	) {
		super();
		this.value = target.name;
		this.dialog = this._register(
			new PageDialog(pane, {
				title: this.format.text('renameTitle', { name: target.name }),
				description: this.format.text(
					target.kind === 'desktop' ? 'renameDesktopDescription' : 'renameDescription'
				)
			})
		);
		this.field = this._register(
			new TextFieldControl(this.dialog.body, {
				label: this.format.text('renameName'),
				value: target.name,
				required: true
			})
		);
		this.field.input.maxLength = NAME_LIMIT;
		this.feedback = this._register(new PageFeedback(this.dialog.body));
		this.cancel = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'secondary',
				label: this.format.text('cancel')
			})
		);
		this.save = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'brand',
				label: this.format.text('renameAction'),
				icon: RENAME_ICON
			})
		);
		this._register(this.field.onDidChange((value) => (this.value = value)));
		this._register(this.cancel.onDidRequest(() => this.close()));
		this._register(this.dialog.onDidRequestCancel(() => this.close()));
		this._register(this.save.onDidRequest(() => void this.submit()));
		this._register(
			addDisposableListener(this.field.input, 'keydown', (event) => {
				if (event.key !== 'Enter') return;
				event.preventDefault();
				void this.submit();
			})
		);
		this.dialog.show(this.field.input);
		this.field.input.select();
	}

	private close(): void {
		if (!this.working) this.dispose();
	}

	private invalid(name: string): 'renameNameRequired' | 'renameNameInvalid' | undefined {
		if (name.trim().length === 0) return 'renameNameRequired';
		if (name.length > NAME_LIMIT || /[\u0000-\u001f\u007f]/u.test(name))
			return 'renameNameInvalid';
		return undefined;
	}

	private async submit(): Promise<void> {
		if (this.working) return;
		const name = this.value.trim();
		const error = this.invalid(name);
		this.field.setState({
			value: this.value,
			required: true,
			...(error === undefined ? {} : { error: this.format.text(error) })
		});
		if (error !== undefined) {
			this.field.input.focus();
			return;
		}
		this.setWorking(true);
		let intent: AccountIntent =
			this.target.kind === 'desktop'
				? { kind: 'renameDesktop', id: this.target.id, name }
				: { kind: 'renameSession', id: this.target.id, name };
		let result = await this.account.change(intent);
		// A Desktop Session takes its name from the computer's registration.
		if (result !== 'busy' && result.kind === 'namedByDesktop' && !this._store.isDisposed) {
			intent = { kind: 'renameDesktop', id: result.desktopRegistrationId, name };
			result = await this.account.change(intent);
		}
		if (this._store.isDisposed) return;
		this.setWorking(false);
		if (
			result !== 'busy' &&
			(result.kind === 'success' ||
				(result.kind === 'error' && failureNeedsRead(result.reason)))
		) {
			this.dispose();
			this.onDidComplete(result);
			return;
		}
		this.feedback.set(
			result === 'busy'
				? this.format.text('busy')
				: this.format.failure(result.kind === 'error' ? result.reason : 'invalid'),
			'error'
		);
		this.save.focus();
	}

	private setWorking(working: boolean): void {
		this.working = working;
		this.dialog.setClosable(!working);
		if (working) this.feedback.set();
		this.field.setState({ value: this.value, required: true, disabled: working });
		this.cancel.setState({ label: this.format.text('cancel'), disabled: working });
		this.save.setState({
			label: this.format.text('renameAction'),
			icon: RENAME_ICON,
			busy: working
		});
	}
}

/** Everything the page knows about one session or registered computer, as label and value. */
export class SessionDetailsDialog extends Disposable {
	constructor(
		title: string,
		details: readonly { readonly label: string; readonly value: string }[],
		@IAccountFormatService format: IAccountFormatService,
		@IPagePaneContext pane: IPagePaneContext
	) {
		super();
		const dialog = this._register(new PageDialog(pane, { title }));
		const $ = createElementFactory(pane.document);
		dialog.body.append(
			$(
				'dl.prctr-account-session-details',
				{},
				...details.map((detail) =>
					$(
						'div.prctr-account-session-details__row',
						{},
						$('dt.prctr-account-session-details__label', { textContent: detail.label }),
						$('dd.prctr-account-session-details__value', { textContent: detail.value })
					)
				)
			)
		);
		const close = this._register(
			new ButtonControl(dialog.actions, {
				variant: 'secondary',
				label: format.text('detailsClose')
			})
		);
		this._register(close.onDidRequest(() => this.dispose()));
		this._register(dialog.onDidRequestCancel(() => this.dispose()));
		dialog.show(close.element);
	}
}
