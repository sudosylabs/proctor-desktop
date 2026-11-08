/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { status } from '../../../../base/browser/ui/aria/aria.js';
import type { MenuControl } from '../../../../base/browser/ui/menu/menuControl.js';
import type { ToastHost } from '../../../../base/browser/ui/toast/toastHost.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import type { IDisposable } from '../../../../base/common/lifecycle.js';
import type {
	LocalizationContext,
	LocalizationValue
} from '../../../../base/common/localization.js';
import type {
	AccountClient,
	AccountFailure,
	AccountIntent,
	AccountResponse
} from '../../../../platform/account/common/accountProtocol.js';
import type { AuthenticatedWindowDescriptor } from '../../../../platform/windows/common/windowProtocol.js';
import type { WorkbenchOverlayHost } from '../../../browser/overlayHost.js';
import { failureMessage, relativeDay } from '../common/accountPresentation.js';
import { accountMessages, type AccountMessage } from './accountMessages.js';
import { ACCOUNT_READ_DEADLINE_MS } from './accountRead.js';

/** One Account page in the content area. Its pane shows it and says when it is visible. */
export interface AccountPageView extends IDisposable {
	setVisible(visible: boolean): void;
}

/** What Account pages may ask of the rest of the window. */
export interface AccountWindowHooks {
	setProfilePhoto(dataUrl: string): void;
	signOut(): void;
	/** Copies text through the window's privileged clipboard path, when one exists. */
	readonly writeClipboard?: (text: string) => Promise<void>;
}

/**
 * Shared by every Account page in one pane: the bound account capability,
 * text and date formatting, the window's dialogs and menu, and announcements.
 * The account capability owns every read and change; pages only present them.
 */
export class AccountPageServices {
	/** Revisions of photos uploaded in this window session; only those can be removed. */
	readonly customPhotos: Set<string>;

	constructor(
		readonly document: Document,
		private readonly client: AccountClient,
		readonly localization: LocalizationContext,
		readonly binding: AuthenticatedWindowDescriptor,
		readonly overlays: WorkbenchOverlayHost,
		readonly menu: MenuControl,
		private readonly toasts: ToastHost,
		readonly hooks: AccountWindowHooks,
		customPhotos: Set<string>,
		readonly focusPage: () => void,
		readonly now: () => number = Date.now
	) {
		this.customPhotos = customPhotos;
	}

	private changing = false;

	/** Whether a change is waiting for the server; the next one waits until it replies. */
	get isChanging(): boolean {
		return this.changing;
	}

	/** Makes one change at a time; a second request while one is in flight is refused as busy. */
	async change(intent: AccountIntent): Promise<AccountResponse | 'busy'> {
		if (this.changing) return 'busy';
		this.changing = true;
		try {
			return await this.request(intent);
		} finally {
			this.changing = false;
		}
	}

	get observable(): boolean {
		return this.client.observe !== undefined;
	}

	get institution(): string | undefined {
		const name = this.binding.identity?.institutionName.trim();
		return name ? name : undefined;
	}

	text(key: AccountMessage, values?: Readonly<Record<string, LocalizationValue>>): string {
		return this.localization.format(accountMessages[key], values);
	}

	/** Uses the institution-named message when the institution is known, else its generic form. */
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

	/** "today, 08:41", "yesterday, 17:20", or a date. */
	relative(time: number): string {
		const day = relativeDay(time, this.now());
		if (day === 'other') return this.date(time);
		const clock = new Intl.DateTimeFormat(this.locale, { timeStyle: 'short' }).format(time);
		return this.text(day === 'today' ? 'relativeToday' : 'relativeYesterday', { time: clock });
	}

	languageName(locale: string): string {
		try {
			return (
				new Intl.DisplayNames([this.locale], {
					type: 'language',
					languageDisplay: 'standard'
				}).of(locale) ?? locale
			);
		} catch {
			return locale;
		}
	}

	announce(text: string): void {
		status(text);
	}

	/**
	 * Reports the result of something the person just did. A success leaves on its own; a
	 * failure stays until dismissed and can offer to try again.
	 */
	toast(title: string, failure?: { readonly body?: string; readonly retry?: () => void }): void {
		if (failure === undefined) {
			this.toasts.show({
				tone: 'success',
				icon: proctorIconFactory('status.success', 18),
				title
			});
			return;
		}
		this.toasts.show({
			tone: 'failure',
			icon: proctorIconFactory('status.attention', 18),
			title,
			...(failure.body === undefined ? {} : { body: failure.body }),
			...(failure.retry === undefined
				? {}
				: {
						action: {
							label: this.text('retry'),
							icon: proctorIconFactory('action.retry', 14),
							run: failure.retry
						}
					})
		});
	}

	/**
	 * A transport failure becomes a failure reply; a change whose reply was lost is unconfirmed.
	 * A read that has not answered by the deadline fails, so no page waits forever.
	 */
	async request(intent: AccountIntent): Promise<AccountResponse> {
		try {
			if (!isRead(intent)) return await this.client.request(intent);
			let timer: ReturnType<typeof setTimeout> | undefined;
			const deadline = new Promise<AccountResponse>((resolve) => {
				timer = setTimeout(
					() => resolve({ kind: 'error', reason: 'unavailable' }),
					ACCOUNT_READ_DEADLINE_MS
				);
			});
			try {
				return await Promise.race([this.client.request(intent), deadline]);
			} finally {
				clearTimeout(timer);
			}
		} catch {
			return {
				kind: 'error',
				reason: isRead(intent) ? 'unavailable' : 'unconfirmed'
			};
		}
	}

	observe(
		intent: AccountIntent,
		listener: (response: AccountResponse) => void
	): { dispose(): void } | undefined {
		return this.client.observe?.(intent, listener);
	}

	private get locale(): string {
		return this.localization.locale === 'pseudo' ? 'en' : this.localization.locale;
	}
}

function isRead(intent: AccountIntent): boolean {
	return (
		intent.kind === 'read' ||
		intent.kind === 'readHistory' ||
		intent.kind === 'readPhoto' ||
		intent.kind === 'openSecurity'
	);
}
