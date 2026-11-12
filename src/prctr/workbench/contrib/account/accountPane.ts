/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { PagePane } from '../../browser/authenticated/pages/pagePane.js';
import type { WorkbenchPane } from '../../browser/workbenchPane.js';
import type { ResolvedWorkbenchItem } from '../../common/workbenchItem.js';
import type { AccountPage } from '../../services/authenticatedNavigation/common/authenticatedNavigationModel.js';
import { IAccountFormatService } from './accountFormat.js';
import { accountPageRegistry } from './accountPages.js';
import { accountFailureOf } from './common/accountPresentation.js';
import './media/accountPane.css';

export interface AccountModel extends ResolvedWorkbenchItem {
	readonly page: AccountPage;
}

/** The Account pages' pane in the content area; each assignment builds the page afresh. */
export class AccountPane extends Disposable implements WorkbenchPane {
	private readonly pane: PagePane;

	constructor(
		document: Document,
		@IInstantiationService instantiationService: IInstantiationService,
		@IAccountFormatService private readonly format: IAccountFormatService
	) {
		super();
		this.pane = this._register(
			instantiationService.createInstance(PagePane, document, {
				className: 'prctr-account',
				describeFailure: (reason) => format.failure(accountFailureOf(reason))
			})
		);
	}

	get element(): HTMLElement {
		return this.pane.element;
	}

	setItem(model: ResolvedWorkbenchItem, token: CancellationToken): void {
		this.pane.clear();
		if (token.isCancellationRequested) return;
		const page = (model as AccountModel).page;
		const descriptor = accountPageRegistry[page];
		this.pane.show({
			id: page,
			title: this.format.text(descriptor.title),
			description: descriptor.description(this.format),
			// Every Account page keeps the same 760 column and left edge.
			width: 'narrow',
			create: descriptor.create
		});
	}

	clear(): void {
		this.pane.clear();
	}

	setVisible(visible: boolean): void {
		this.pane.setVisible(visible);
	}

	layout(): void {
		this.pane.layout();
	}

	focus(): void {
		this.pane.focus();
	}

	getViewState(): undefined {
		return undefined;
	}
}
