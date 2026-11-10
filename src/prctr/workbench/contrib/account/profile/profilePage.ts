/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createStatusBadge } from '../../../../base/browser/ui/badge/statusBadge.js';
import { IAccountService } from '../../../services/account/common/account.js';
import { IAccountFormatService } from '../accountFormat.js';
import { IWorkbenchWindowService } from '../../../browser/workbenchServices.js';
import type { AuthenticatedWindowDescriptor } from '../../../../platform/windows/common/windowProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
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
	proctorIconFactory
} from '../../../../platform/theme/browser/proctorIcon.js';
import {
	clientKind,
	groupSessions,
	initialsOf,
	noticePresentation
} from '../common/accountPresentation.js';
import { AccountConfirmation } from '../widgets/accountConfirmation.js';
import { PageFeedback } from '../../../browser/authenticated/pages/pageFeedback.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { AccountPhotoDialog } from './photoDialog.js';
import { AccountRead } from '../widgets/accountRead.js';
import {
	PageSection,
	type PageRowModel
} from '../../../browser/authenticated/pages/pageSection.js';

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
export class ProfilePage extends Disposable implements PageView {
	private readonly profile: AccountRead<'profile'>;
	private readonly sessions: AccountRead<'sessions'>;
	private readonly notices: AccountRead<'notices'>;

	private readonly avatar: HTMLElement;
	private readonly name: HTMLElement;
	private readonly username: HTMLElement;
	private readonly changePhoto: ButtonControl;
	private readonly removePhoto: ButtonControl;
	private readonly fileInput: HTMLInputElement;
	private readonly photoFeedback: PageFeedback;
	private readonly details: PageSection;
	private readonly detailRows: Readonly<Record<DetailKey, DetailRow>>;
	private readonly unverified: HTMLElement;
	private readonly sendVerification: ButtonControl;
	private readonly verificationFeedback: PageFeedback;
	private readonly noticeSection: PageSection;
	private readonly noticesMore: HTMLElement;
	private readonly dialog = this._register(new MutableDisposable());

	private photo: Photo | undefined;
	private photoRead = 0;

	/** Who the window's privileged binding says is signed in, before the profile is read. */
	private readonly identity: AuthenticatedWindowDescriptor['identity'];

	constructor(
		body: HTMLElement,
		_headerActions: HTMLElement,
		@IAccountService private readonly account: IAccountService,
		@IAccountFormatService private readonly format: IAccountFormatService,
		@IWorkbenchWindowService windowService: IWorkbenchWindowService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
		const binding = windowService.binding;
		this.identity = binding.kind === 'authenticated' ? binding.identity : undefined;
		const document = body.ownerDocument;
		const $ = createElementFactory(document);
		this.profile = this._register(
			this.instantiationService.createInstance(AccountRead<'profile'>, 'profile')
		);
		this.sessions = this._register(
			this.instantiationService.createInstance(AccountRead<'sessions'>, 'sessions')
		);
		this.notices = this._register(
			this.instantiationService.createInstance(AccountRead<'notices'>, 'notices')
		);

		this.avatar = $('span.prctr-account-profile__avatar', { attrs: { 'aria-hidden': 'true' } });
		this.name = $('p.prctr-account-profile__name');
		this.username = $('p.prctr-account-profile__username');
		const names = $('div.prctr-account-profile__names', {}, this.name, this.username);
		if (this.format.institution !== undefined)
			names.append(
				$(
					'p.prctr-account-profile__institution',
					{},
					this._register(
						createProctorIcon(document, { id: 'object.institution', size: 14 })
					).element,
					this.format.institution
				)
			);
		const identity = $('div.prctr-account-profile__identity', {}, this.avatar, names);
		const photoActions = $('div.prctr-account-profile__photo-actions');
		identity.append(photoActions);
		this.removePhoto = this._register(
			new ButtonControl(photoActions, {
				variant: 'ghost',
				label: this.format.text('removePhoto'),
				icon: proctorIconFactory('action.delete')
			})
		);
		this.changePhoto = this._register(
			new ButtonControl(photoActions, {
				variant: 'secondary',
				label: this.format.text('changePhoto'),
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
		this.photoFeedback = this._register(new PageFeedback(identityBlock));

		this.details = this._register(
			this.instantiationService.createInstance(PageSection, body, {
				title: this.format.text('accountDetails'),
				description: this.format.institutionText('detailsManaged', 'detailsManagedGeneric')
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
		this.detailRows.email.value.classList.add('prctr-account-details__mono');
		this.detailRows.timeZone.value.classList.add('prctr-account-details__mono');
		this.details.content.append(list);

		const noticeIcon = this._register(
			createProctorIcon(document, { id: 'action.sendEmail', size: 18 })
		);
		const noticeText = $('p.prctr-account-notice__text', {
			textContent: this.format.text('unverifiedNotice')
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
				label: this.format.text('sendVerification'),
				icon: SEND_EMAIL_ICON
			})
		);
		// A lasting condition of the account, shown as a banner at the top of the page.
		identityBlock.before(this.unverified);
		this.verificationFeedback = this._register(new PageFeedback(body));
		this.unverified.after(this.verificationFeedback.element);

		const identityContext = this.identity;
		if (identityContext?.noCurrentAffiliation)
			this.details.element.before(this.plainNotice($, this.format.text('noAffiliation')));
		if (identityContext?.noAssignedAccess)
			this.details.element.before(this.plainNotice($, this.format.text('noAccess')));

		this.noticeSection = this._register(
			this.instantiationService.createInstance(PageSection, body, {
				title: this.format.text('noticesTitle'),
				description: this.format.institutionText(
					'noticesDescription',
					'noticesDescriptionGeneric'
				)
			})
		);
		this.noticesMore = $('p.prctr-page-section__more', {
			hidden: true,
			textContent: this.format.text('noticesMore')
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
			$('dt.prctr-account-details__label', { textContent: this.format.text(label) }),
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
		this.renderRemovePhoto();
		this.details.setState(this.profile.state, false, () => void this.profile.refresh());
		const list = this.details.content;
		list.hidden = data === undefined;
		const displayName =
			data === undefined
				? (this.identity?.displayName ?? '')
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
			row.value.textContent = value || this.format.text('notProvided');
			row.value.dataset.empty = String(!value);
		};
		text('firstName', profile.firstName);
		text('lastName', profile.lastName);
		text('email', profile.email);
		text(
			'language',
			profile.locale === undefined ? undefined : this.format.languageName(profile.locale)
		);
		text('timeZone', profile.timezone);
		text('memberSince', this.format.date(profile.createdAt));
		const emailNote = this.detailRows.email.note;
		const verified = profile.emailVerified;
		emailNote.hidden = profile.email === undefined || verified === undefined;
		emailNote.replaceChildren(
			createStatusBadge(emailNote.ownerDocument, {
				text: this.format.text(verified ? 'emailVerified' : 'emailUnverified'),
				tone: verified ? 'success' : 'warning'
			})
		);
		this.unverified.hidden = profile.email === undefined || verified !== false;
		const current = groupSessions(this.sessions.data?.sessions ?? []).current;
		const lastSignIn = this.detailRows.lastSignIn;
		lastSignIn.row.hidden = current === undefined;
		if (current !== undefined)
			text(
				'lastSignIn',
				this.format.text('lastSignInValue', {
					when: this.format.relativeStandalone(current.createdAt),
					client: this.format.text(clientKind(current.client))
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
		const rows: PageRowModel[] = (data?.notices ?? []).map((notice) => {
			const presentation = noticePresentation(notice);
			return {
				id: notice.retirementId,
				glyph:
					notice.category === 'browser_activity'
						? 'object.browserActivity'
						: 'object.file',
				title: notice.examTitle,
				detail: this.format.join(
					this.format.text('noticeKind', {
						category: this.format.text(presentation.category),
						date: this.format.date(notice.sittingStartAt)
					}),
					this.format.date(notice.createdAt)
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
		if (when === 'noticeDeleted') return this.format.text('noticeDeleted');
		if (date === undefined) return this.format.text('noticeDeletionCanceledUndated');
		return this.format.text(when, { date: this.format.date(date) });
	}

	// #region Photo

	private async loadPhoto(): Promise<void> {
		const read = ++this.photoRead;
		const result = await this.account.request({ kind: 'readPhoto' });
		if (this._store.isDisposed || read !== this.photoRead) return;
		if (result.kind === 'photo') {
			this.applyPhoto(result);
			return;
		}
		this.changePhoto.setState({
			label: this.format.text('changePhoto'),
			icon: CHANGE_PHOTO_ICON,
			disabled: true
		});
		this.photoFeedback.set(this.format.text('photoUnavailable'), 'error');
	}

	private applyPhoto(photo: Photo): void {
		this.photo = photo;
		const image = createElementFactory(this.avatar.ownerDocument)('img', {
			alt: '',
			src: photo.dataUrl
		});
		this.avatar.replaceChildren(image);
		this.account.setPhoto(photo.dataUrl);
		this.changePhoto.setState({
			label: this.format.text('changePhoto'),
			icon: CHANGE_PHOTO_ICON
		});
		this.renderRemovePhoto();
	}

	/** Remove is offered only for the person's own upload, as the account itself reports it. */
	private renderRemovePhoto(): void {
		this.removePhoto.element.hidden =
			this.photo === undefined || this.profile.data?.profile.photoKind !== 'custom';
	}

	private onFileChosen(): void {
		const file = this.fileInput.files?.[0];
		this.fileInput.value = '';
		if (!file || !this.photo) return;
		this.photoFeedback.set();
		this.dialog.value = this.instantiationService.createInstance(
			AccountPhotoDialog,
			this.photo.etag,
			file,
			(photo) => {
				if (this._store.isDisposed) return;
				this.applyPhoto(photo);
				// The account now reports the upload as the person's own.
				void this.profile.refresh();
				this.photoFeedback.set(this.format.text('photoUpdated'), 'success');
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
		this.dialog.value = this.instantiationService.createInstance(
			AccountConfirmation,
			{
				title: this.format.text('confirmRemovePhotoTitle'),
				message: this.format.text('confirmRemovePhotoBody'),
				confirmLabel: this.format.text('removePhoto'),
				run: () => this.account.change({ kind: 'removePhoto', etag: photo.etag }),
				onDidComplete: (result) => {
					if (result.kind === 'success') {
						void this.profile.refresh();
						this.photoFeedback.set(this.format.text('photoRemoved'), 'success');
					} else if (result.kind === 'error') {
						this.photoFeedback.set(this.format.failure(result.reason), 'error');
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
			label: this.format.text('sendVerification'),
			icon: SEND_EMAIL_ICON,
			busy: true
		});
		const result = await this.account.change({ kind: 'requestEmailVerification' });
		if (this._store.isDisposed) return;
		this.sendVerification.setState({
			label: this.format.text('sendVerification'),
			icon: SEND_EMAIL_ICON
		});
		if (result === 'busy') this.verificationFeedback.set(this.format.text('busy'), 'error');
		else if (result.kind === 'error')
			this.verificationFeedback.set(this.format.failure(result.reason), 'error');
		else this.verificationFeedback.set(this.format.text('verificationSent'), 'success');
	}
}
