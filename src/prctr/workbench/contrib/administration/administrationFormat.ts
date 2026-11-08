/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { PagerLabels } from '../../../base/browser/ui/pager/pagerControl.js';
import type { LocalizationValue } from '../../../base/common/localization.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import {
	IPageFormatService,
	type PageFormat
} from '../../browser/authenticated/pages/pageFormat.js';
import { pageMessages } from '../../browser/authenticated/pages/pageMessages.js';
import { ILocalizationService } from '../../services/localization/common/localization.js';
import { administrationMessages } from './administrationMessages.js';

/** Administration text by key, including the page text the window's frame registers. */
export const administrationText = Object.freeze({ ...pageMessages, ...administrationMessages });
export type AdministrationText = keyof typeof administrationText;

export const IAdministrationFormatService = createDecorator<IAdministrationFormatService>(
	'administrationFormatService'
);

/** Administration text in the window's locale: its messages and failures, plus the page format. */
export interface IAdministrationFormatService extends PageFormat {
	readonly _serviceBrand: undefined;
	text(key: AdministrationText, values?: Readonly<Record<string, LocalizationValue>>): string;
	/** Uses the institution-named message when the institution is known, else its generic form. */
	institutionText(named: AdministrationText, generic: AdministrationText): string;
	/** The sentence for an Administration failure reason. */
	failure(reason: string): string;
}

const failureMessages: Readonly<Record<string, AdministrationText>> = Object.freeze({
	unavailable: 'failureUnavailable',
	sessionEnded: 'failureSessionEnded',
	noAccess: 'failureNoAccess',
	denied: 'failureNoAccess',
	notFound: 'failureNotFound',
	reauthenticationRequired: 'failureReauthentication',
	strongRequired: 'failureStrong',
	strongAuthenticationRequired: 'failureStrong',
	unconfirmed: 'failureUnconfirmed',
	conflict: 'failureConflict',
	invalid: 'failureInvalid',
	cancelled: 'failureCancelled',
	expired: 'failureExpired'
});

export class AdministrationFormatService implements IAdministrationFormatService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ILocalizationService private readonly localization: ILocalizationService,
		@IPageFormatService private readonly page: IPageFormatService
	) {}

	get institution(): string | undefined {
		return this.page.institution;
	}

	now(): number {
		return this.page.now();
	}

	text(key: AdministrationText, values?: Readonly<Record<string, LocalizationValue>>): string {
		return this.localization.format(administrationText[key], values);
	}

	institutionText(named: AdministrationText, generic: AdministrationText): string {
		const institution = this.institution;
		return institution === undefined ? this.text(generic) : this.text(named, { institution });
	}

	failure(reason: string): string {
		return this.text(
			Object.hasOwn(failureMessages, reason) ? failureMessages[reason] : 'failureUnavailable'
		);
	}

	join(first: string, second: string): string {
		return this.page.join(first, second);
	}

	count(value: number): string {
		return this.page.count(value);
	}

	date(time: number): string {
		return this.page.date(time);
	}

	dateTime(time: number): string {
		return this.page.dateTime(time);
	}

	relative(time: number): string {
		return this.page.relative(time);
	}

	relativeStandalone(time: number): string {
		return this.page.relativeStandalone(time);
	}

	languageName(locale: string): string {
		return this.page.languageName(locale);
	}

	pagerLabels(list: string): PagerLabels {
		return this.page.pagerLabels(list);
	}
}
