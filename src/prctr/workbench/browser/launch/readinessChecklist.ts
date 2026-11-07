/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../base/browser/documentElements.js';
import type { LocalizationContext, MessageDescriptor } from '../../../base/common/localization.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import {
	createSemanticIcon,
	type SemanticIconControl,
	type SemanticIconState
} from '../../../platform/theme/browser/semanticIcon.js';
import { checklistMessages as messages } from './launchMessages.js';
import { formatLaunchText, type CheckStatus, type ReadinessStep } from './launchPresentation.js';
import './readinessChecklist.css';

/** Each status has its own glyph shape, so the checklist never relies on color alone. */
const statusIcons: Readonly<Record<CheckStatus, SemanticIconState>> = {
	done: { id: 'state.success' },
	failed: { id: 'state.error' },
	attention: { id: 'state.warning' },
	active: { id: 'state.loading', modifier: 'spin' },
	pending: { id: 'state.pending' },
	skipped: { id: 'state.skipped' }
};

const statusWords: Readonly<Record<CheckStatus, MessageDescriptor>> = {
	done: messages.statusDone,
	failed: messages.statusFailed,
	attention: messages.statusAttention,
	active: messages.statusActive,
	pending: messages.statusPending,
	skipped: messages.statusSkipped
};

interface ChecklistRow {
	readonly element: HTMLLIElement;
	readonly icon: SemanticIconControl;
	readonly label: HTMLElement;
	readonly status: HTMLElement;
	readonly detail: HTMLElement;
}

/** The four checks Proctor runs before sign-in, showing which one a state reached or stopped at. */
export class ReadinessChecklist extends Disposable {
	readonly element: HTMLElement;

	private readonly title: HTMLElement;
	private readonly rows: readonly ChecklistRow[];

	constructor(
		host: HTMLElement,
		private readonly localization: LocalizationContext
	) {
		super();
		const document = host.ownerDocument;
		const $ = createElementFactory(document);
		this.title = $('h2.prctr-launch-checks__title', { id: 'prctr-launch-checks-title' });
		const list = $('ol.prctr-launch-checks__list');
		this.rows = [0, 1, 2, 3].map(() => {
			const icon = this._register(
				createSemanticIcon(document, { id: 'state.pending', size: 16 })
			);
			const label = $('span.prctr-launch-checks__label');
			const status = $('span.prctr-launch-checks__status');
			const detail = $('span.prctr-launch-checks__detail', { dir: 'auto' });
			const glyph = $('span.prctr-launch-checks__glyph', {}, icon.element);
			const element = $('li.prctr-launch-checks__row', {}, glyph, label, status, detail);
			list.append(element);
			return { element, icon, label, status, detail };
		});
		this.element = $(
			'section.prctr-launch-checks',
			{ attrs: { 'aria-labelledby': this.title.id } },
			this.title,
			list
		);
		host.append(this.element);
	}

	render(title: MessageDescriptor, steps: readonly ReadinessStep[]): void {
		this.title.textContent = this.localization.format(title);
		steps.forEach((step, index) => {
			this.renderRow(this.rows[index]!, step);
		});
	}

	private renderRow(row: ChecklistRow, step: ReadinessStep): void {
		row.element.dataset.status = step.status;
		row.icon.setState({ ...statusIcons[step.status], size: 16 });
		row.label.textContent = this.localization.format(step.label);
		// Screen readers hear the status as a word; sighted users see the glyph.
		row.status.textContent = this.localization.format(statusWords[step.status]);
		row.detail.textContent =
			step.detail === undefined ? '' : formatLaunchText(this.localization, step.detail);
		// The dash of a step that has not run is visual; the status word already says so.
		const isQuiet = step.status === 'pending' || step.status === 'skipped';
		row.detail.toggleAttribute('aria-hidden', isQuiet);
	}

	override dispose(): void {
		super.dispose();
		this.element.remove();
	}
}
