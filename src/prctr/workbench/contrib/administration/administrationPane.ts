/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { PagePane } from '../../browser/authenticated/pages/pagePane.js';
import type { WorkbenchPane } from '../../browser/workbenchPane.js';
import type { ResolvedWorkbenchItem } from '../../common/workbenchItem.js';
import type { AdministrationPage } from '../../services/authenticatedNavigation/common/authenticatedNavigationModel.js';
import { IAdministrationFormatService } from './administrationFormat.js';
import { administrationPageRegistry } from './administrationPages.js';

export interface AdministrationModel extends ResolvedWorkbenchItem {
	readonly page: AdministrationPage;
	/** The record a record's page shows, such as one user. */
	readonly subject: string | undefined;
}

/** The Administration pages' pane in the content area; each assignment builds the page afresh. */
export class AdministrationPane extends Disposable implements WorkbenchPane {
	private readonly pane: PagePane;

	constructor(
		document: Document,
		@IInstantiationService instantiationService: IInstantiationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService
	) {
		super();
		this.pane = this._register(
			instantiationService.createInstance(PagePane, document, {
				className: 'prctr-administration',
				describeFailure: (reason) => format.failure(reason)
			})
		);
	}

	get element(): HTMLElement {
		return this.pane.element;
	}

	setItem(model: ResolvedWorkbenchItem, token: CancellationToken): void {
		this.pane.clear();
		if (token.isCancellationRequested) return;
		const { page, subject } = model as AdministrationModel;
		const descriptor = administrationPageRegistry[page];
		this.pane.show({
			id: page,
			title: this.format.text(descriptor.title),
			description: descriptor.description(this.format),
			width: descriptor.width,
			create: (instantiationService, body, headerActions) =>
				descriptor.create(instantiationService, body, headerActions, subject)
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
