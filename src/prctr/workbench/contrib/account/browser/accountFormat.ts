/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { PagerLabels } from '../../../../base/browser/ui/pager/pagerControl.js';
import type { LocalizationValue } from '../../../../base/common/localization.js';
import type { AccountFailure } from '../../../../platform/account/common/accountProtocol.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchWindowService } from '../../../browser/workbenchServices.js';
import { ILocalizationService } from '../../../services/localization/common/localization.js';
import { failureMessage, relativeDay } from '../common/accountPresentation.js';
import { accountMessages, type AccountMessage } from './accountMessages.js';

export const IAccountFormatService = createDecorator<IAccountFormatService>('accountFormatService');

/** Account text in the window's locale: messages, dates, failures and list labels. */
export interface IAccountFormatService {
	readonly _serviceBrand: undefined;
	/** The institution's name, when the window knows it. */
	readonly institution: string | undefined;
	/** The current time, against which relative dates and expiries are shown. */
	now(): number;
	text(key: AccountMessage, values?: Readonly<Record<string, LocalizationValue>>): string;
	/** Uses the institution-named message when the institution is known, else its generic form. */
	institutionText(named: AccountMessage, generic: AccountMessage): string;
	failure(reason: AccountFailure): string;
	join(first: string, second: string): string;
	date(time: number): string;
	dateTime(time: number): string;
	/** "today, 08:41", "yesterday, 17:20", or a date, for use inside a sentence. */
	relative(time: number): string;
	/** "Today, 08:41", "Yesterday, 17:20", or a date, for a value shown on its own. */
	relativeStandalone(time: number): string;
	languageName(locale: string): string;
	/** The text of a pager under the list called `list`. */
	pagerLabels(list: string): PagerLabels;
}

export class AccountFormatService implements IAccountFormatService {
	declare readonly _serviceBrand: undefined;

	readonly institution: string | undefined;

	constructor(
		private readonly clock: () => number,
		@ILocalizationService private readonly localization: ILocalizationService,
		@IWorkbenchWindowService windowService: IWorkbenchWindowService
	) {
		const binding = windowService.binding;
		const name =
			binding.kind === 'authenticated' ? binding.identity?.institutionName.trim() : '';
		this.institution = name ? name : undefined;
	}

	now(): number {
		return this.clock();
	}

	text(key: AccountMessage, values?: Readonly<Record<string, LocalizationValue>>): string {
		return this.localization.format(accountMessages[key], values);
	}

	institutionText(named: AccountMessage, generic: AccountMessage): string {
		const institution = this.institution;
		return institution === undefined ? this.text(generic) : this.text(named, { institution });
	}

	failure(reason: AccountFailure): string {
		return this.text(failureMessage(reason));
	}

	join(first: string, second: string): string {
		return this.text('detailSeparator', { first, second });
	}

	date(time: number): string {
		return new Intl.DateTimeFormat(this.locale, { dateStyle: 'medium' }).format(time);
	}

	dateTime(time: number): string {
		return new Intl.DateTimeFormat(this.locale, {
			dateStyle: 'long',
			timeStyle: 'short'
		}).format(time);
	}

	relative(time: number): string {
		return this.relativeTime(time, 'relativeToday', 'relativeYesterday');
	}

	relativeStandalone(time: number): string {
		return this.relativeTime(time, 'relativeTodayStandalone', 'relativeYesterdayStandalone');
	}

	languageName(locale: string): string {
		try {
			const names = new Intl.DisplayNames([this.locale], {
				type: 'language',
				languageDisplay: 'standard'
			});
			return names.of(locale) ?? locale;
		} catch {
			return locale;
		}
	}

	pagerLabels(list: string): PagerLabels {
		return {
			name: this.text('pagerName', { list }),
			previous: this.text('pagerPrevious'),
			next: this.text('pagerNext'),
			page: (page) => this.text('pagerPage', { page }),
			range: (first, last, total) =>
				total === undefined
					? this.text('pagerRangeOpen', { first, last })
					: this.text('pagerRange', { first, last, total }),
			compact: (page, count) =>
				count === undefined
					? this.text('pagerCompactOpen', { page })
					: this.text('pagerCompact', { page, count })
		};
	}

	private relativeTime(
		time: number,
		today: 'relativeToday' | 'relativeTodayStandalone',
		yesterday: 'relativeYesterday' | 'relativeYesterdayStandalone'
	): string {
		const day = relativeDay(time, this.now());
		if (day === 'other') {
			return this.date(time);
		}
		const clock = new Intl.DateTimeFormat(this.locale, { timeStyle: 'short' }).format(time);
		return this.text(day === 'today' ? today : yesterday, { time: clock });
	}

	private get locale(): string {
		return this.localization.locale === 'pseudo' ? 'en' : this.localization.locale;
	}
}
