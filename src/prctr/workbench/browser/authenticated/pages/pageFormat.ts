/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { PagerLabels } from '../../../../base/browser/ui/pager/pagerControl.js';
import { relativeDay } from '../../../../base/common/calendarDays.js';
import type { LocalizationValue } from '../../../../base/common/localization.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILocalizationService } from '../../../services/localization/common/localization.js';
import { IWorkbenchWindowService } from '../../workbenchServices.js';
import { pageMessages, type PageMessage } from './pageMessages.js';

export const IPageFormatService = createDecorator<IPageFormatService>('pageFormatService');

/** How every AuthenticatedWindow page writes shared text, numbers, dates and list labels. */
export interface PageFormat {
	/** The institution's name, when the window knows it. */
	readonly institution: string | undefined;
	/** The current time, against which relative dates and expiries are shown. */
	now(): number;
	join(first: string, second: string): string;
	/** A whole number with the locale's grouping, as in "10,000". */
	count(value: number): string;
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

/** Page text in the window's locale, shared by every product area's pages. */
export interface IPageFormatService extends PageFormat {
	readonly _serviceBrand: undefined;
	text(key: PageMessage, values?: Readonly<Record<string, LocalizationValue>>): string;
	/** Uses the institution-named message when the institution is known, else its generic form. */
	institutionText(named: PageMessage, generic: PageMessage): string;
}

export class PageFormatService implements IPageFormatService {
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

	text(key: PageMessage, values?: Readonly<Record<string, LocalizationValue>>): string {
		return this.localization.format(pageMessages[key], values);
	}

	institutionText(named: PageMessage, generic: PageMessage): string {
		const institution = this.institution;
		return institution === undefined ? this.text(generic) : this.text(named, { institution });
	}

	/** "A · B", where B starts with a capital, as every part of a detail line does. */
	join(first: string, second: string): string {
		return this.text('detailSeparator', { first, second: capitalize(second, this.locale) });
	}

	count(value: number): string {
		return new Intl.NumberFormat(this.locale).format(value);
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
			range: (first, last, total, atLeast) =>
				total === undefined
					? this.text('pagerRangeOpen', { first, last })
					: this.text(atLeast ? 'pagerRangeAtLeast' : 'pagerRange', {
							first,
							last,
							total: this.count(total)
						}),
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
		if (day === 'other') return this.date(time);
		const clock = new Intl.DateTimeFormat(this.locale, { timeStyle: 'short' }).format(time);
		return this.text(day === 'today' ? today : yesterday, { time: clock });
	}

	private get locale(): string {
		return this.localization.locale === 'pseudo' ? 'en' : this.localization.locale;
	}
}

/** The text with its first letter in upper case, as each part of a detail line starts. */
export function capitalize(text: string, locale?: string): string {
	const first = text.codePointAt(0);
	if (first === undefined) return text;
	const letter = String.fromCodePoint(first);
	return letter.toLocaleUpperCase(locale) + text.slice(letter.length);
}
