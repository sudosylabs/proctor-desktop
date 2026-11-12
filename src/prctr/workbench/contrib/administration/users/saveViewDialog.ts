/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { TextFieldControl } from '../../../../base/browser/ui/field/textField.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import { PageDialog } from '../../../browser/authenticated/pages/pageDialog.js';
import { PageFeedback } from '../../../browser/authenticated/pages/pageFeedback.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAdministrationFormatService } from '../administrationFormat.js';

const NAME_LIMIT = 60;

/** Names the current Users filters as a view, kept in the person's settings. */
export class SaveViewDialog extends Disposable {
	private readonly dialog: PageDialog;
	private readonly input: HTMLInputElement;
	private readonly feedback: PageFeedback;
	private readonly save: ButtonControl;
	private working = false;

	constructor(
		filters: string,
		private readonly onSave: (name: string) => Promise<boolean>,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IPagePaneContext pane: IPagePaneContext
	) {
		super();
		this.dialog = this._register(
			new PageDialog(pane, {
				title: format.text('viewsSaveTitle'),
				description: format.text('viewsSaveBody', { filters }),
				size: 'small'
			})
		);
		const field = this._register(
			new TextFieldControl(this.dialog.body, {
				label: format.text('viewsName'),
				value: '',
				required: true
			})
		);
		this.input = field.input;
		this.input.maxLength = NAME_LIMIT;
		this.feedback = this._register(new PageFeedback(this.dialog.body));
		const cancel = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'secondary',
				label: format.text('cancel')
			})
		);
		this.save = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'brand',
				label: format.text('viewsSave'),
				icon: proctorIconFactory('action.confirm'),
				disabled: true
			})
		);
		this._register(cancel.onDidRequest(() => this.close()));
		this._register(this.dialog.onDidRequestCancel(() => this.close()));
		this._register(this.save.onDidRequest(() => void this.submit()));
		this._register(addDisposableListener(this.input, 'input', () => this.update()));
		this._register(
			addDisposableListener(this.input, 'keydown', (event) => {
				if (event.key !== 'Enter') return;
				event.preventDefault();
				void this.submit();
			})
		);
		this.dialog.show(this.input);
	}

	private update(): void {
		this.save.setState({
			label: this.format.text('viewsSave'),
			icon: proctorIconFactory('action.confirm'),
			disabled: this.working || this.input.value.trim() === '',
			busy: this.working
		});
	}

	private async submit(): Promise<void> {
		const name = this.input.value.trim();
		if (name === '' || this.working) return;
		this.working = true;
		this.update();
		const saved = await this.onSave(name);
		if (this._store.isDisposed) return;
		this.working = false;
		if (saved) {
			this.dispose();
			return;
		}
		this.update();
		this.feedback.set(this.format.text('viewsNotSaved'), 'error');
	}

	private close(): void {
		if (!this.working) this.dispose();
	}
}
