/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import type { AdministrationValue } from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { renderDetails } from '../../../browser/authenticated/pages/pageDetails.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import type { ServerRead } from '../../../browser/authenticated/pages/serverRead.js';
import { PageSection } from '../../../browser/authenticated/pages/pageSection.js';
import { IWorkbenchWindowService } from '../../../browser/workbenchServices.js';
import { IServerDataService } from '../../../services/serverData/common/serverData.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { administrationRead } from '../widgets/adminReads.js';

type Institution = AdministrationValue<'institution'>;

/**
 * How the institution appears in Proctor: its name, description and the server Proctor Desktop
 * connects to. The server offers no change to these yet, so the page only shows them.
 */
export class InstitutionPage extends Disposable implements PageView {
	private readonly institution: ServerRead<'administration', Institution>;
	private readonly identity: PageSection;
	private readonly origin: string | undefined;

	constructor(
		body: HTMLElement,
		_headerActions: HTMLElement,
		@IInstantiationService instantiationService: IInstantiationService,
		@IServerDataService serverData: IServerDataService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IWorkbenchWindowService windowService: IWorkbenchWindowService
	) {
		super();
		const binding = windowService.binding;
		this.origin = binding.kind === 'authenticated' ? binding.institutionOrigin : undefined;
		this.identity = this._register(
			instantiationService.createInstance(PageSection, body, {
				title: format.text('institutionIdentity')
			})
		);
		this.institution = this._register(administrationRead(serverData, { kind: 'institution' }));
		this._register(this.institution.onDidChange(() => this.render()));
		this.render();
	}

	setVisible(visible: boolean): void {
		this.institution.setActive(visible);
	}

	private render(): void {
		const institution = this.institution.data;
		this.identity.setState(
			this.institution.state,
			false,
			() => void this.institution.refresh()
		);
		if (institution === undefined) return;
		const none = this.format.text('policyNone');
		renderDetails(this.identity.content, [
			{ label: this.format.text('institutionName'), value: institution.displayName },
			{
				label: this.format.text('institutionDescriptionLabel'),
				value: institution.description || none,
				empty: institution.description === ''
			},
			...(this.origin === undefined
				? []
				: [
						{
							label: this.format.text('institutionServer'),
							value: new URL(this.origin).host
						}
					])
		]);
	}
}
