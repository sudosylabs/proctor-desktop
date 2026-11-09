/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import {
	Disposable,
	MutableDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import type {
	AdministrationResponse,
	AdministrationValue
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import type { PageRowAction } from '../../../browser/authenticated/pages/pageSection.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService } from '../administrationFormat.js';
import { readOnce } from '../widgets/adminReads.js';
import { AdminChanges, AdminConfirmation } from '../widgets/adminChanges.js';
import { AdminFormDialog } from '../widgets/adminFormDialog.js';

export type AdminUser = AdministrationValue<'user'>;

/**
 * What can be done to one user from a list row or their own page: open their page, disable
 * or enable the account, and sign them out everywhere. Each consequential change is confirmed
 * first, and its result is shown as a toast.
 */
export class UserActions extends Disposable {
	private readonly dialog = this._register(new MutableDisposable<IDisposable>());
	private readonly changes: AdminChanges;

	constructor(
		/** Called after a change, so the owner reads the user again. */
		private readonly onDidChange: (userId: string, result: AdministrationResponse) => void,
		/** Where focus returns once a dialog closes. */
		private readonly restoreFocus: (userId: string) => void,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IAuthenticatedNavigationService
		private readonly navigation: IAuthenticatedNavigationService,
		@IPagePaneContext private readonly pane: IPagePaneContext,
		@IAdministrationService private readonly administration: IAdministrationService
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
	}

	/** The row actions for `user`; `open` adds the action that opens their page. */
	for(user: AdminUser, open: boolean): readonly PageRowAction[] {
		const actions: PageRowAction[] = [];
		if (open)
			actions.push({
				label: this.format.text('userOpen'),
				icon: 'action.openExternal',
				run: () => this.navigation.selectAdministrationPage('user', user.id)
			});
		if (user.disabledAt === undefined) {
			actions.push({
				label: this.format.text('userSignOutEverywhere'),
				icon: 'action.signOut',
				run: () => this.signOutEverywhere(user)
			});
			actions.push({
				label: this.format.text('userDisable'),
				icon: 'action.end',
				destructive: true,
				run: () => this.disable(user)
			});
		} else
			actions.push({
				label: this.format.text('userEnable'),
				icon: 'action.enable',
				run: () => void this.enable(user)
			});
		return actions;
	}

	disable(user: AdminUser): void {
		const name = user.displayName;
		this.dialog.value = this.instantiationService.createInstance(AdminFormDialog, {
			title: this.format.text('userDisableTitle', { name }),
			description: this.format.text('userDisableBody'),
			size: 'small',
			fields: [
				{
					kind: 'longText',
					id: 'reason',
					label: this.format.text('userDisableReason'),
					hint: this.format.text('userDisableReasonHint', { name })
				}
			],
			confirmLabel: this.format.text('userDisableConfirm'),
			confirmIcon: 'action.end',
			destructive: true,
			submit: (values) => {
				const reason = values.reason as string | undefined;
				if (reason !== undefined && reason.length > 500)
					return { field: 'reason', error: this.format.text('userDisableReasonLong') };
				return {
					kind: 'disableUser',
					id: user.id,
					...(reason === undefined ? {} : { reason })
				};
			},
			summary: () => [this.format.text('userDisableConfirm'), name],
			onDidComplete: (result) => {
				this.pane.toast(
					result.kind === 'error'
						? this.format.failure(result.reason)
						: this.format.text('userDisabledToast', { name })
				);
				this.onDidChange(user.id, result);
			}
		});
	}

	signOutEverywhere(user: AdminUser): void {
		const name = user.displayName;
		this.confirm(user, {
			title: this.format.text('userSignOutTitle', { name }),
			message: this.format.text('userSignOutBody'),
			confirmLabel: this.format.text('userSignOutConfirm'),
			confirmIcon: 'action.signOut',
			destructive: true,
			run: () => this.changes.send({ kind: 'revokeUserSessions', userId: user.id }, [name]),
			toast: this.format.text('userSignedOutToast', { name })
		});
	}

	/** Replaces the person's photo with an image file the administrator chooses. */
	replacePhoto(user: AdminUser): void {
		const input = createElementFactory(this.pane.document)('input', {
			type: 'file',
			attrs: { accept: 'image/png,image/jpeg,image/webp' }
		});
		input.addEventListener(
			'change',
			() => {
				const file = input.files?.[0];
				if (file !== undefined) void this.uploadPhoto(user, file);
			},
			{ once: true }
		);
		input.click();
	}

	removePhoto(user: AdminUser): void {
		const name = user.displayName;
		this.confirm(user, {
			title: this.format.text('userRemovePhotoTitle', { name }),
			message: this.format.text('userRemovePhotoBody'),
			confirmLabel: this.format.text('userRemovePhotoConfirm'),
			confirmIcon: 'action.delete',
			destructive: true,
			run: async () => {
				const photo = await readOnce(this.administration, {
					kind: 'userPhoto',
					userId: user.id
				});
				if (photo.kind === 'failure') return { kind: 'error', reason: photo.reason };
				return this.changes.send(
					{ kind: 'removeUserPhoto', userId: user.id, etag: photo.value.etag },
					[this.format.text('userRemovePhotoConfirm'), name]
				);
			},
			toast: this.format.text('userPhotoRemoved', { name })
		});
	}

	private async uploadPhoto(user: AdminUser, file: File): Promise<void> {
		const mediaType = file.type;
		if (
			!(
				mediaType === 'image/png' ||
				mediaType === 'image/jpeg' ||
				mediaType === 'image/webp'
			) ||
			file.size < 1 ||
			file.size > 5 * 1024 * 1024
		) {
			this.pane.toast(this.format.text('userPhotoUnsupported'));
			return;
		}
		const image = new Uint8Array(await file.arrayBuffer());
		let etag: string | undefined;
		if (user.photoKind === 'custom') {
			const photo = await readOnce(this.administration, {
				kind: 'userPhoto',
				userId: user.id
			});
			if (photo.kind === 'data') etag = photo.value.etag;
		}
		if (this._store.isDisposed) return;
		const name = user.displayName;
		const result = await this.changes.send(
			{
				kind: 'replaceUserPhoto',
				userId: user.id,
				image,
				mediaType,
				...(etag === undefined ? {} : { etag })
			},
			[this.format.text('userReplacePhoto'), name]
		);
		if (this._store.isDisposed) return;
		if (result !== 'busy' && result.kind !== 'error')
			this.pane.toast(this.format.text('userPhotoReplaced', { name }));
		else if (result === 'busy' || result.reason !== 'cancelled')
			this.pane.toast(this.changes.describe(result));
		if (result !== 'busy') this.onDidChange(user.id, result);
	}

	async enable(user: AdminUser): Promise<void> {
		const result = await this.changes.send({ kind: 'enableUser', id: user.id }, [
			user.displayName
		]);
		if (this._store.isDisposed) return;
		if (result !== 'busy' && result.kind !== 'error')
			this.pane.toast(this.format.text('userEnabledToast', { name: user.displayName }));
		else if (result === 'busy' || result.reason !== 'cancelled')
			this.pane.toast(this.changes.describe(result), { retry: () => void this.enable(user) });
		if (result !== 'busy') this.onDidChange(user.id, result);
	}

	private confirm(
		user: AdminUser,
		options: {
			readonly title: string;
			readonly message: string;
			readonly confirmLabel: string;
			readonly confirmIcon: 'action.end' | 'action.signOut' | 'action.delete';
			readonly destructive: boolean;
			readonly run: () => ReturnType<AdminChanges['send']>;
			readonly toast: string;
		}
	): void {
		this.dialog.value = this.instantiationService.createInstance(
			AdminConfirmation,
			{
				...options,
				onDidComplete: (result) => {
					if (result.kind !== 'error') this.pane.toast(options.toast);
					else this.pane.toast(this.format.failure(result.reason));
					this.onDidChange(user.id, result);
				}
			},
			() => this.restoreFocus(user.id)
		);
	}
}
