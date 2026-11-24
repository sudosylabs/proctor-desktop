/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { renderDetails } from '../../../browser/authenticated/pages/pageDetails.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAccountService } from '../../../services/account/common/account.js';
import { IAccountFormatService } from '../accountFormat.js';
import { IWorkbenchWindowService } from '../../../browser/workbenchServices.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import type { AuthenticatedWindowDescriptor } from '../../../../platform/windows/common/windowProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import type {
	AccountProfile,
	AccountResponse,
	AccountRetentionNotice
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

const CHANGE_PHOTO_ICON = proctorIconFactory('action.changePhoto');
const SEND_EMAIL_ICON = proctorIconFactory('action.sendEmail', 14);

/**
 * Profile: the photo and name, the read-only account details the institution
 * manages, and any exam records due for deletion. The name and details come from
 * the profile read; the last sign-in is this window's own session.
 */
export class ProfilePage extends Disposable implements PageView {
	private readonly profile: AccountRead<'profile'>;
	private readonly sessions: AccountRead<'sessions'>;
	private readonly notices: AccountRead<'notices'>;

	private readonly changePhoto: ButtonControl;
	private readonly removePhoto: ButtonControl;
	private readonly fileInput: HTMLInputElement;
	private readonly photoFeedback: PageFeedback;
	private readonly details: PageSection;
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
		headerActions: HTMLElement,
		@IAccountService private readonly account: IAccountService,
		@IAccountFormatService private readonly format: IAccountFormatService,
		@IWorkbenchWindowService windowService: IWorkbenchWindowService,
		@IAuthenticatedNavigationService
		private readonly navigation: IAuthenticatedNavigationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IPagePaneContext private readonly pane: IPagePaneContext
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

		// The person is the page's heading, as the board draws it; the photo buttons sit beside it.
		const photoActions = headerActions;
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
				label: this.format.text('addPhoto'),
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
		const identityBlock = $('div.prctr-account-profile', {}, this.fileInput);
		body.append(identityBlock);
		this.photoFeedback = this._register(new PageFeedback(identityBlock));

		// An administrator isn't told to ask one: they can change the details themselves.
		const administrator =
			this.identity?.availableProductAreas.includes('administration') === true;
		this.details = this._register(
			this.instantiationService.createInstance(PageSection, body, {
				title: this.format.text('accountDetails'),
				description: administrator
					? this.format.institutionText(
							'detailsManagedAdministrator',
							'detailsManagedAdministratorGeneric'
						)
					: this.format.institutionText('detailsManaged', 'detailsManagedGeneric'),
				...(administrator
					? {
							action: {
								label: this.format.text('editInAdministration'),
								icon: 'action.edit' as const
							}
						}
					: {}),
				// Seven label and value pairs, as the details it loads.
				skeleton: { kind: 'details', count: 7 }
			})
		);
		const principalId = this.identity?.principalId;
		if (administrator && principalId !== undefined) {
			this.details.setAction(true);
			this._register(
				this.details.onDidRequestAction(() =>
					this.navigation.selectAdministrationPage('user', principalId)
				)
			);
		}

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
		// Having no current affiliation is told once, by the rail's notice.
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

	private plainNotice($: ReturnType<typeof createElementFactory>, text: string): HTMLElement {
		return $('p.prctr-account-notice.prctr-account-notice--plain', { textContent: text });
	}

	private renderProfile(): void {
		const data = this.profile.data?.profile;
		this.renderRemovePhoto();
		this.details.setState(this.profile.state, false, () => void this.profile.refresh());
		const displayName =
			data === undefined
				? (this.identity?.displayName ?? '')
				: data.displayName || data.username;
		this.pane.setHeading({
			title: displayName,
			description: '',
			initials: initialsOf(displayName),
			...(this.photo === undefined ? {} : { photo: this.photo.dataUrl }),
			record: [
				...(data === undefined ? [] : [{ text: data.username, mono: true as const }]),
				...(this.format.institution === undefined ? [] : [this.format.institution])
			]
		});
		if (data === undefined) {
			this.unverified.hidden = true;
			return;
		}
		this.renderDetails(data);
	}

	private renderDetails(profile: AccountProfile): void {
		const value = (text: string | undefined) =>
			text === undefined || text === ''
				? { value: this.format.text('notProvided'), empty: true }
				: { value: text };
		const verified = profile.emailVerified;
		const current = groupSessions(this.sessions.data?.sessions ?? []).current;
		renderDetails(this.details.content, [
			{ label: this.format.text('firstName'), ...value(profile.firstName) },
			{ label: this.format.text('lastName'), ...value(profile.lastName) },
			{ label: this.format.text('username'), value: profile.username },
			{
				label: this.format.text('email'),
				...value(profile.email),
				...(profile.email === undefined || verified === undefined
					? {}
					: {
							note: {
								text: this.format.text(
									verified ? 'emailVerified' : 'emailUnverified'
								),
								tone: verified ? ('safeguard' as const) : ('attention' as const)
							}
						})
			},
			{
				label: this.format.text('language'),
				...value(
					profile.locale === undefined
						? undefined
						: this.format.languageName(profile.locale)
				)
			},
			{ label: this.format.text('timeZone'), ...value(profile.timezone) },
			{ label: this.format.text('memberSince'), value: this.format.date(profile.createdAt) },
			...(current === undefined
				? []
				: [
						{
							label: this.format.text('lastSignIn'),
							value: this.format.text('lastSignInValue', {
								when: this.format.relativeStandalone(current.createdAt),
								client: this.format.text(clientKind(current.client))
							})
						}
					])
		]);
		this.unverified.hidden = profile.email === undefined || verified !== false;
	}

	private renderNotices(): void {
		const state = this.notices.state;
		const data = this.notices.data;
		// The section exists only when there is something to say: notices, or a failure to read them.
		const hasNotices = (data?.notices.length ?? 0) > 0;
		this.noticeSection.hidden = !hasNotices && state.kind !== 'failed';
		this.noticeSection.setState(state, false, () => void this.notices.refresh());
		this.noticesMore.hidden = !(data?.more ?? false);
		// Records still waiting to be deleted come first, the soonest at the top.
		const order = (notice: AccountRetentionNotice): number =>
			notice.state === 'grace' ? notice.retireAfter : Number.MAX_SAFE_INTEGER;
		const notices = [...(data?.notices ?? [])].sort((a, b) => order(a) - order(b));
		const rows: PageRowModel[] = notices.map((notice) => {
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
					tone: 'neutral'
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
			label: this.photoLabel(),
			icon: CHANGE_PHOTO_ICON,
			disabled: true
		});
		this.photoFeedback.set(this.format.text('photoUnavailable'), 'error');
	}

	private applyPhoto(photo: Photo): void {
		this.photo = photo;
		this.renderProfile();
		this.account.setPhoto(photo.dataUrl);
		this.renderRemovePhoto();
	}

	/**
	 * Initials offer only "Add photo"; the person's own upload offers Change and Remove, as the
	 * account itself reports which it is.
	 */
	private renderRemovePhoto(): void {
		const custom = this.profile.data?.profile.photoKind === 'custom';
		this.removePhoto.element.hidden = this.photo === undefined || !custom;
		this.changePhoto.setState({
			label: this.photoLabel(),
			icon: CHANGE_PHOTO_ICON,
			disabled: this.photo === undefined
		});
	}

	private photoLabel(): string {
		return this.format.text(
			this.profile.data?.profile.photoKind === 'custom' ? 'changePhoto' : 'addPhoto'
		);
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
