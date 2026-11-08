/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import type {
	AccountProfile,
	AccountResponse
} from '../../../../platform/account/common/accountProtocol.js';
import {
	createProctorIcon,
	proctorIconFactory,
	type ProctorIconControl
} from '../../../../platform/theme/browser/proctorIcon.js';
import {
	clientKind,
	groupSessions,
	initialsOf,
	noticePresentation
} from '../common/accountPresentation.js';
import { AccountConfirmation } from './accountConfirmation.js';
import { AccountFeedback } from './accountFeedback.js';
import type { AccountPageServices, AccountPageView } from './accountPageServices.js';
import { AccountPhotoDialog } from './accountPhotoDialog.js';
import { AccountRead } from './accountRead.js';
import { AccountSection, type AccountRowModel } from './accountSection.js';

type Photo = Extract<AccountResponse, { kind: 'photo' }>;

interface DetailRow {
	readonly value: HTMLElement;
	readonly note: HTMLElement;
	readonly row: HTMLElement;
}

const CHANGE_PHOTO_ICON = proctorIconFactory('action.changePhoto');
const SEND_EMAIL_ICON = proctorIconFactory('action.sendEmail', 14);

type DetailKey =
	'firstName' | 'lastName' | 'email' | 'language' | 'timeZone' | 'memberSince' | 'lastSignIn';

/**
 * Profile: the photo and name, the read-only account details the institution
 * manages, and any exam records due for deletion. The name and details come from
 * the profile read; the last sign-in is this window's own session.
 */
export class ProfilePage extends Disposable implements AccountPageView {
	private readonly profile: AccountRead<'profile'>;
	private readonly sessions: AccountRead<'sessions'>;
	private readonly notices: AccountRead<'notices'>;

	private readonly avatar: HTMLElement;
	private readonly name: HTMLElement;
	private readonly username: HTMLElement;
	private readonly changePhoto: ButtonControl;
	private readonly removePhoto: ButtonControl;
	private readonly fileInput: HTMLInputElement;
	private readonly photoFeedback: AccountFeedback;
	private readonly details: AccountSection;
	private readonly detailRows: Readonly<Record<DetailKey, DetailRow>>;
	private readonly unverified: HTMLElement;
	private readonly noteIcon: ProctorIconControl;
	private readonly sendVerification: ButtonControl;
	private readonly verificationFeedback: AccountFeedback;
	private readonly noticeSection: AccountSection;
	private readonly noticesMore: HTMLElement;
	private readonly dialog = this._register(new MutableDisposable());

	private photo: Photo | undefined;
	private photoRead = 0;

	constructor(
		body: HTMLElement,
		private readonly services: AccountPageServices
	) {
		super();
		const document = body.ownerDocument;
		const $ = createElementFactory(document);
		this.profile = this._register(new AccountRead(services, 'profile'));
		this.sessions = this._register(new AccountRead(services, 'sessions'));
		this.notices = this._register(new AccountRead(services, 'notices'));

		this.avatar = $('span.prctr-account-profile__avatar', { attrs: { 'aria-hidden': 'true' } });
		this.name = $('p.prctr-account-profile__name');
		this.username = $('p.prctr-account-profile__username');
		const names = $('div.prctr-account-profile__names', {}, this.name, this.username);
		if (services.institution !== undefined)
			names.append(
				$(
					'p.prctr-account-profile__institution',
					{},
					this._register(
						createProctorIcon(document, { id: 'object.institution', size: 14 })
					).element,
					services.institution
				)
			);
		const identity = $('div.prctr-account-profile__identity', {}, this.avatar, names);
		const photoActions = $('div.prctr-account-profile__photo-actions');
		identity.append(photoActions);
		this.removePhoto = this._register(
			new ButtonControl(photoActions, {
				variant: 'ghost',
				label: services.text('removePhoto'),
				icon: proctorIconFactory('action.delete')
			})
		);
		this.changePhoto = this._register(
			new ButtonControl(photoActions, {
				variant: 'secondary',
				label: services.text('changePhoto'),
				icon: CHANGE_PHOTO_ICON,
				disabled: true
			})
		);
		this.removePhoto.element.hidden = true;
		this.fileInput = $('input', {
			type: 'file',
			accept: '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp',
			hidden: true
		});
		const identityBlock = $('div.prctr-account-profile', {}, identity, this.fileInput);
		body.append(identityBlock);
		this.photoFeedback = this._register(new AccountFeedback(identityBlock));

		this.details = this._register(
			new AccountSection(body, services, {
				title: services.text('accountDetails'),
				description: services.institutionText('detailsManaged', 'detailsManagedGeneric')
			})
		);
		const list = $('dl.prctr-account-details');
		this.detailRows = {
			firstName: this.detailRow($, list, 'firstName'),
			lastName: this.detailRow($, list, 'lastName'),
			email: this.detailRow($, list, 'email'),
			language: this.detailRow($, list, 'language'),
			timeZone: this.detailRow($, list, 'timeZone'),
			memberSince: this.detailRow($, list, 'memberSince'),
			lastSignIn: this.detailRow($, list, 'lastSignIn')
		};
		this.noteIcon = this._register(
			createProctorIcon(document, { id: 'status.verified', size: 14 })
		);
		this.detailRows.email.value.classList.add('prctr-account-details__mono');
		this.detailRows.timeZone.value.classList.add('prctr-account-details__mono');
		this.details.content.append(list);

		const noticeIcon = this._register(
			createProctorIcon(document, { id: 'action.sendEmail', size: 18 })
		);
		const noticeText = $('p.prctr-account-notice__text', {
			textContent: services.text('unverifiedNotice')
		});
		this.unverified = $(
			'div.prctr-account-notice',
			{ hidden: true },
			noticeIcon.element,
			noticeText
		);
		this.sendVerification = this._register(
			new ButtonControl(this.unverified, {
				variant: 'secondary',
				size: 'small',
				label: services.text('sendVerification'),
				icon: SEND_EMAIL_ICON
			})
		);
		// A lasting condition of the account, shown as a banner at the top of the page.
		identityBlock.before(this.unverified);
		this.verificationFeedback = this._register(new AccountFeedback(body));
		this.unverified.after(this.verificationFeedback.element);

		const identityContext = services.binding.identity;
		if (identityContext?.noCurrentAffiliation)
			this.details.element.before(this.plainNotice($, services.text('noAffiliation')));
		if (identityContext?.noAssignedAccess)
			this.details.element.before(this.plainNotice($, services.text('noAccess')));

		this.noticeSection = this._register(
			new AccountSection(body, services, {
				title: services.text('noticesTitle'),
				description: services.institutionText(
					'noticesDescription',
					'noticesDescriptionGeneric'
				)
			})
		);
		this.noticesMore = $('p.prctr-account-section__more', {
			hidden: true,
			textContent: services.text('noticesMore')
		});
		this.noticeSection.element.append(this.noticesMore);
		this.noticeSection.hidden = true;

		this.registerListeners();
		this.renderProfile();
		this.renderNotices();
	}

	setVisible(visible: boolean): void {
		this.profile.setActive(visible);
		this.sessions.setActive(visible);
		this.notices.setActive(visible);
		if (visible && this.photo === undefined) void this.loadPhoto();
	}

	private registerListeners(): void {
		this._register(this.profile.onDidChange(() => this.renderProfile()));
		this._register(this.sessions.onDidChange(() => this.renderProfile()));
		this._register(this.notices.onDidChange(() => this.renderNotices()));
		this._register(this.changePhoto.onDidRequest(() => this.fileInput.click()));
		this._register(this.removePhoto.onDidRequest(() => this.confirmRemovePhoto()));
		this._register(
			addDisposableListener(this.fileInput, 'cancel', () => this.changePhoto.focus())
		);
		this._register(addDisposableListener(this.fileInput, 'change', () => this.onFileChosen()));
		this._register(this.sendVerification.onDidRequest(() => void this.requestVerification()));
	}

	private detailRow(
		$: ReturnType<typeof createElementFactory>,
		list: HTMLElement,
		label: DetailKey
	): DetailRow {
		const value = $('dd.prctr-account-details__value');
		const note = $('dd.prctr-account-details__note', { hidden: true });
		const row = $(
			'div.prctr-account-details__row',
			{},
			$('dt.prctr-account-details__label', { textContent: this.services.text(label) }),
			value,
			note
		);
		list.append(row);
		return { value, note, row };
	}

	private plainNotice($: ReturnType<typeof createElementFactory>, text: string): HTMLElement {
		return $('p.prctr-account-notice.prctr-account-notice--plain', { textContent: text });
	}

	private renderProfile(): void {
		const data = this.profile.data?.profile;
		this.details.setState(this.profile.state, false, () => void this.profile.refresh());
		const list = this.details.content;
		list.hidden = data === undefined;
		const displayName =
			data === undefined
				? (this.services.binding.identity?.displayName ?? '')
				: data.displayName || data.username;
		this.name.textContent = displayName;
		this.username.textContent = data?.username ?? '';
		this.username.hidden = data === undefined;
		if (this.photo === undefined) this.avatar.textContent = initialsOf(displayName);
		if (data === undefined) {
			this.unverified.hidden = true;
			return;
		}
		this.renderDetails(data);
	}

	private renderDetails(profile: AccountProfile): void {
		const text = (key: DetailKey, value: string | undefined): void => {
			const row = this.detailRows[key];
			row.value.textContent = value || this.services.text('notProvided');
			row.value.dataset.empty = String(!value);
		};
		text('firstName', profile.firstName);
		text('lastName', profile.lastName);
		text('email', profile.email);
		text(
			'language',
			profile.locale === undefined ? undefined : this.services.languageName(profile.locale)
		);
		text('timeZone', profile.timezone);
		text('memberSince', this.services.date(profile.createdAt));
		const emailNote = this.detailRows.email.note;
		const verified = profile.emailVerified;
		emailNote.hidden = profile.email === undefined || verified === undefined;
		emailNote.dataset.verified = String(verified === true);
		emailNote.replaceChildren(
			this.noteIcon.element,
			this.services.text(verified ? 'emailVerified' : 'emailUnverified')
		);
		this.noteIcon.setState({ id: verified ? 'status.verified' : 'status.warning', size: 14 });
		this.unverified.hidden = profile.email === undefined || verified !== false;
		const current = groupSessions(this.sessions.data?.sessions ?? []).current;
		const lastSignIn = this.detailRows.lastSignIn;
		lastSignIn.row.hidden = current === undefined;
		if (current !== undefined)
			text(
				'lastSignIn',
				this.services.text('lastSignInValue', {
					when: this.services.relative(current.createdAt),
					client: this.services.text(clientKind(current.client))
				})
			);
	}

	private renderNotices(): void {
		const state = this.notices.state;
		const data = this.notices.data;
		// The section exists only when there is something to say: notices, or a failure to read them.
		const hasNotices = (data?.notices.length ?? 0) > 0;
		this.noticeSection.hidden = !hasNotices && state.kind !== 'failed';
		this.noticeSection.setState(state, false, () => void this.notices.refresh());
		this.noticesMore.hidden = !(data?.more ?? false);
		const rows: AccountRowModel[] = (data?.notices ?? []).map((notice) => {
			const presentation = noticePresentation(notice);
			return {
				id: notice.retirementId,
				glyph:
					notice.category === 'browser_activity'
						? 'object.browserActivity'
						: 'object.file',
				title: notice.examTitle,
				detail: this.services.join(
					this.services.text('noticeKind', {
						category: this.services.text(presentation.category),
						date: this.services.date(notice.sittingStartAt)
					}),
					this.services.date(notice.createdAt)
				),
				status: {
					text: this.noticeWhen(presentation.when, presentation.date),
					icon:
						presentation.when === 'noticeDeletedAfter' ? 'status.time' : 'action.close',
					tone: presentation.when === 'noticeDeletedAfter' ? 'warning' : 'quiet'
				}
			};
		});
		this.noticeSection.setRows(rows);
	}

	private noticeWhen(
		when: 'noticeDeletedAfter' | 'noticeDeletionCanceled' | 'noticeDeleted',
		date: number | undefined
	): string {
		if (when === 'noticeDeleted') return this.services.text('noticeDeleted');
		if (date === undefined) return this.services.text('noticeDeletionCanceledUndated');
		return this.services.text(when, { date: this.services.date(date) });
	}

	// #region Photo

	private async loadPhoto(): Promise<void> {
		const read = ++this.photoRead;
		const result = await this.services.request({ kind: 'readPhoto' });
		if (this._store.isDisposed || read !== this.photoRead) return;
		if (result.kind === 'photo') {
			this.applyPhoto(result);
			return;
		}
		this.changePhoto.setState({
			label: this.services.text('changePhoto'),
			icon: CHANGE_PHOTO_ICON,
			disabled: true
		});
		this.photoFeedback.set(this.services.text('photoUnavailable'), 'error');
	}

	private applyPhoto(photo: Photo): void {
		this.photo = photo;
		const image = createElementFactory(this.avatar.ownerDocument)('img', {
			alt: '',
			src: photo.dataUrl
		});
		this.avatar.replaceChildren(image);
		this.services.hooks.setProfilePhoto(photo.dataUrl);
		this.changePhoto.setState({
			label: this.services.text('changePhoto'),
			icon: CHANGE_PHOTO_ICON
		});
		this.removePhoto.element.hidden = !this.services.customPhotos.has(photo.etag);
	}

	private onFileChosen(): void {
		const file = this.fileInput.files?.[0];
		this.fileInput.value = '';
		if (!file || !this.photo) return;
		this.photoFeedback.set();
		this.dialog.value = new AccountPhotoDialog(
			this.services,
			this.photo.etag,
			file,
			(photo) => {
				if (this._store.isDisposed) return;
				this.services.customPhotos.add(photo.etag);
				this.applyPhoto(photo);
				this.photoFeedback.set(this.services.text('photoUpdated'), 'success');
			},
			(needsRefresh) => {
				if (this._store.isDisposed) return;
				if (needsRefresh) {
					this.photo = undefined;
					void this.loadPhoto();
				}
				this.changePhoto.focus();
			}
		);
	}

	private confirmRemovePhoto(): void {
		const photo = this.photo;
		if (photo === undefined) return;
		this.dialog.value = new AccountConfirmation(
			this.services,
			{
				title: this.services.text('confirmRemovePhotoTitle'),
				message: this.services.text('confirmRemovePhotoBody'),
				confirmLabel: this.services.text('removePhoto'),
				run: () => this.services.change({ kind: 'removePhoto', etag: photo.etag }),
				onDidComplete: (result) => {
					if (result.kind === 'success') {
						this.services.customPhotos.delete(photo.etag);
						this.photoFeedback.set(this.services.text('photoRemoved'), 'success');
					} else if (result.kind === 'error') {
						this.photoFeedback.set(this.services.failure(result.reason), 'error');
					}
					this.photo = undefined;
					void this.loadPhoto();
					this.changePhoto.focus();
				}
			},
			() => undefined
		);
	}

	// #endregion

	private async requestVerification(): Promise<void> {
		this.sendVerification.setState({
			label: this.services.text('sendVerification'),
			icon: SEND_EMAIL_ICON,
			busy: true
		});
		const result = await this.services.change({ kind: 'requestEmailVerification' });
		if (this._store.isDisposed) return;
		this.sendVerification.setState({
			label: this.services.text('sendVerification'),
			icon: SEND_EMAIL_ICON
		});
		if (result === 'busy') this.verificationFeedback.set(this.services.text('busy'), 'error');
		else if (result.kind === 'error')
			this.verificationFeedback.set(this.services.failure(result.reason), 'error');
		else this.verificationFeedback.set(this.services.text('verificationSent'), 'success');
	}
}
