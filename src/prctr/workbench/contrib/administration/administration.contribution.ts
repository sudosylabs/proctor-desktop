/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import type { MessageDescriptor } from '../../../base/common/localization.js';
import { SyncDescriptor } from '../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import type { WorkbenchContributionRegistration } from '../../browser/bootstrap.js';
import {
	IWorkbenchItemResolverService,
	IWorkbenchPaneHostService
} from '../../browser/workbenchServices.js';
import type { WorkbenchItem } from '../../common/workbenchItem.js';
import {
	administrationPages,
	IAuthenticatedNavigationService,
	type AdministrationLocation
} from '../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { ILocalizationService } from '../../services/localization/common/localization.js';
import { administrationMessages as messages } from './administrationMessages.js';
import { administrationPageRegistry } from './administrationPages.js';
import { AdministrationPane, type AdministrationModel } from './administrationPane.js';

const ADMINISTRATION_ITEM_TYPE = 'prctr.authenticated.administration';

/**
 * Administration's pages in the content area, opened from its sidebar or from a list's row.
 * The server's product areas decide whether the area is shown; each page's reads and changes
 * are authorized by the server, which a page shows as a refusal rather than guessing ahead.
 */
class AdministrationContribution extends Disposable {
	private readonly items = new Map<string, WorkbenchItem>();
	private disposed = false;
	private sequence = 0;

	constructor(
		@IAuthenticatedNavigationService
		private readonly navigation: IAuthenticatedNavigationService,
		@IWorkbenchPaneHostService private readonly host: IWorkbenchPaneHostService,
		@IWorkbenchItemResolverService registry: IWorkbenchItemResolverService,
		@ILocalizationService private readonly localization: ILocalizationService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		const models = new WeakMap<WorkbenchItem, AdministrationLocation>();
		this.itemFor = (location) => {
			const identity =
				location.subject === undefined
					? location.page
					: `${location.page}/${location.subject}`;
			let item = this.items.get(identity);
			if (item === undefined) {
				item = this.createItem(identity, location);
				models.set(item, location);
				this.items.set(identity, item);
			}
			return item;
		};
		this._register(
			registry.register({
				typeId: ADMINISTRATION_ITEM_TYPE,
				async resolve(item): Promise<AdministrationModel> {
					const location = models.get(item);
					if (location === undefined || !administrationPages.includes(location.page))
						throw new Error('Unknown administration item');
					return { item, page: location.page, subject: location.subject, dispose() {} };
				},
				createPane(document) {
					return instantiationService.createInstance(AdministrationPane, document);
				}
			})
		);
		this._register(navigation.onDidChange(() => this.show(true)));
		this._register(navigation.onDidChangeAdministration(() => this.show(true)));
		this._register({
			dispose: () => {
				this.disposed = true;
				this.sequence++;
			}
		});
		this.show(false);
	}

	private readonly itemFor: (location: AdministrationLocation) => WorkbenchItem;

	private show(focus: boolean): void {
		if (this.navigation.current === 'administration') void this.open(focus);
		else this.sequence++;
	}

	private async open(focus: boolean): Promise<void> {
		const serial = ++this.sequence;
		const item = this.itemFor(this.navigation.administration);
		try {
			this.host.element.hidden = false;
			const assigned = await this.host.assign(item);
			if (assigned && !this.disposed && serial === this.sequence && focus) this.host.focus();
		} catch {
			if (!this.disposed && serial === this.sequence)
				this.navigation.setProductStatus(
					this.localization.format(messages.pageUnavailable)
				);
		}
	}

	private createItem(identity: string, location: AdministrationLocation): WorkbenchItem {
		const title = this.localization.format(
			messages[administrationPageRegistry[location.page].title]
		);
		return {
			typeId: ADMINISTRATION_ITEM_TYPE,
			logicalIdentity: identity,
			presentation: { title, accessibleLabel: title },
			closable: false,
			restorable: false,
			onDidChangePresentation: Event.None,
			matches(other) {
				return (
					other.typeId === this.typeId && other.logicalIdentity === this.logicalIdentity
				);
			}
		};
	}
}

export const administrationContribution: WorkbenchContributionRegistration = Object.freeze({
	id: 'prctr.authenticated.administration' as const,
	phase: 'ready' as const,
	dependencies: Object.freeze(['prctr.authenticated.navigation' as const]),
	messages: Object.freeze(Object.values(messages) as MessageDescriptor[]),
	descriptor: new SyncDescriptor(AdministrationContribution)
});
