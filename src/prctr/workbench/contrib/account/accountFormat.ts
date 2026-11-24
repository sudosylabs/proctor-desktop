/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { PagerLabels } from '../../../base/browser/ui/pager/pagerControl.js';
import type { LocalizationValue } from '../../../base/common/localization.js';
import type { AccountFailure } from '../../../platform/account/common/accountProtocol.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import {
	IPageFormatService,
	type PageFormat
} from '../../browser/authenticated/pages/pageFormat.js';
import { ILocalizationService } from '../../services/localization/common/localization.js';
import { failureMessage } from './common/accountPresentation.js';
import { accountText, type AccountMessage } from './accountMessages.js';

export const IAccountFormatService = createDecorator<IAccountFormatService>('accountFormatService');

/** Account text in the window's locale: its messages and failures, plus the shared page format. */
export interface IAccountFormatService extends PageFormat {
	readonly _serviceBrand: undefined;
	text(key: AccountMessage, values?: Readonly<Record<string, LocalizationValue>>): string;
	/** Uses the institution-named message when the institution is known, else its generic form. */
	institutionText(named: AccountMessage, generic: AccountMessage): string;
	failure(reason: AccountFailure): string;
}

export class AccountFormatService implements IAccountFormatService {
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

	text(key: AccountMessage, values?: Readonly<Record<string, LocalizationValue>>): string {
		return this.localization.format(accountText[key], values);
	}

	institutionText(named: AccountMessage, generic: AccountMessage): string {
		const institution = this.institution;
		return institution === undefined ? this.text(generic) : this.text(named, { institution });
	}

	failure(reason: AccountFailure): string {
		return this.text(failureMessage(reason));
	}

	join(first: string, second: string): string {
		return this.page.join(first, second);
	}

	count(value: number): string {
		return this.page.count(value);
	}

	plural(count: number): Intl.LDMLPluralRule {
		return this.page.plural(count);
	}

	date(time: number): string {
		return this.page.date(time);
	}

	shortDate(time: number): string {
		return this.page.shortDate(time);
	}

	time(time: number): string {
		return this.page.time(time);
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
