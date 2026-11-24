/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	AdministrationChangeIntent,
	AdministrationResponse
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import {
	PageFormDialog,
	type PageFormField,
	type PageFormOptions,
	type PageFormValues
} from '../../../browser/authenticated/pages/pageFormDialog.js';
import { IPageFormatService } from '../../../browser/authenticated/pages/pageFormat.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { AdminChanges } from './adminChanges.js';

export type AdminFormField = PageFormField;
export type AdminFormValues = PageFormValues;
export type AdminFormOptions = PageFormOptions<AdministrationChangeIntent, AdministrationResponse>;

/** An Administration form dialog: the shared form, sending through Administration's changes. */
export class AdminFormDialog extends PageFormDialog<
	AdministrationChangeIntent,
	AdministrationResponse
> {
	constructor(
		options: AdminFormOptions,
		@IPageFormatService format: IPageFormatService,
		@IPagePaneContext pane: IPagePaneContext,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super(options, instantiationService.createInstance(AdminChanges), format, pane);
	}
}
