/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IAccountService } from '../../../services/account/common/account.js';
import { IAccountFormatService } from '../accountFormat.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { AccountResponse } from '../../../../platform/account/common/accountProtocol.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import { PageDialog } from '../../../browser/authenticated/pages/pageDialog.js';
import { PageFeedback } from '../../../browser/authenticated/pages/pageFeedback.js';
import {
	decodePhoto,
	encodePhoto,
	photoCropRect,
	PhotoImportError,
	type PhotoCrop
} from './photoImage.js';
import './media/photoDialog.css';

type Photo = Extract<AccountResponse, { kind: 'photo' }>;

/** The circle's diameter in CSS pixels; the saved photo is the square behind it. */
const CIRCLE = 200;
const SAVED_SIZE = 512;

const photoActionIcons = Object.freeze({
	chooseAnother: 'object.image',
	photoRecheck: 'action.retry',
	cancel: 'action.close',
	savePhoto: 'action.confirm'
} as const);

/**
 * A local crop draft of one chosen image. Nothing reaches the server until Save;
 * the account capability then decides, against the exact photo revision. A
 * conflicting or unknown outcome is read again before another save.
 */
export class AccountPhotoDialog extends Disposable {
	private readonly dialog: PageDialog;
	private readonly stage: HTMLElement;
	private readonly canvas: HTMLCanvasElement;
	private readonly zoom: HTMLInputElement;
	private readonly input: HTMLInputElement;
	private readonly lowResolution: HTMLElement;
	private readonly feedback: PageFeedback;
	private readonly choose: ButtonControl;
	private readonly cancel: ButtonControl;
	private readonly save: ButtonControl;
	private readonly check: ButtonControl;

	private bitmap: ImageBitmap | undefined;
	private crop: PhotoCrop = { x: 0.5, y: 0.5, zoom: 1 };
	private generation = 0;
	private busy = false;
	private needsCheck = false;
	private pointer: { readonly id: number; x: number; y: number } | undefined;

	constructor(
		private etag: string,
		file: File,
		private readonly onDidSave: (photo: Photo) => void,
		private readonly onDidClose: (needsRefresh: boolean) => void,
		@IAccountService private readonly account: IAccountService,
		@IAccountFormatService private readonly format: IAccountFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext
	) {
		super();
		const document = this.pane.document;
		const $ = createElementFactory(document);
		this.dialog = this._register(
			new PageDialog(this.pane, {
				title: this.format.text('photoDialogTitle'),
				description: this.format.text('photoDialogHelp')
			})
		);
		this.canvas = $('canvas.prctr-account-photo__canvas');
		this.stage = $(
			'div.prctr-account-photo__stage',
			{
				tabIndex: 0,
				attrs: {
					role: 'img',
					'aria-label': this.format.text('photoCropLabel'),
					'aria-disabled': 'true'
				}
			},
			this.canvas,
			$('span.prctr-account-photo__circle', { attrs: { 'aria-hidden': 'true' } })
		);
		this.zoom = $('input.prctr-account-photo__zoom', {
			type: 'range',
			min: '1',
			max: '4',
			step: '0.05',
			value: '1',
			disabled: true
		});
		this.lowResolution = $('p.prctr-account-photo__note', {
			hidden: true,
			textContent: this.format.text('photoLowResolution')
		});
		this.input = $('input', {
			type: 'file',
			accept: '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp',
			hidden: true
		});
		this.dialog.body.append(
			this.stage,
			$(
				'label.prctr-account-photo__zoom-label',
				{},
				$('span', { textContent: this.format.text('photoZoom') }),
				this.zoom
			),
			this.lowResolution,
			this.input
		);
		this.feedback = this._register(new PageFeedback(this.dialog.body));
		this.choose = this.button('chooseAnother', 'secondary');
		this.dialog.actions.append($('span.prctr-page-dialog__spacer'));
		this.check = this.button('photoRecheck', 'secondary');
		this.cancel = this.button('cancel', 'secondary');
		this.save = this.button('savePhoto', 'brand');
		this.registerListeners();
		this.update();
		this.dialog.show(this.choose.element);
		void this.load(file);
	}

	private button(
		key: 'chooseAnother' | 'photoRecheck' | 'cancel' | 'savePhoto',
		variant: 'secondary' | 'brand'
	): ButtonControl {
		return this._register(
			new ButtonControl(this.dialog.actions, {
				variant,
				label: this.format.text(key),
				icon: proctorIconFactory(photoActionIcons[key])
			})
		);
	}

	private registerListeners(): void {
		this._register(this.choose.onDidRequest(() => this.input.click()));
		this._register(this.cancel.onDidRequest(() => this.close()));
		this._register(this.dialog.onDidRequestCancel(() => this.close()));
		this._register(this.save.onDidRequest(() => void this.upload()));
		this._register(this.check.onDidRequest(() => void this.reconcile(false)));
		this._register(addDisposableListener(this.input, 'cancel', () => this.choose.focus()));
		this._register(
			addDisposableListener(this.input, 'change', () => {
				const next = this.input.files?.[0];
				this.input.value = '';
				if (next) void this.load(next);
			})
		);
		this._register(
			addDisposableListener(this.zoom, 'input', () => {
				this.crop = { ...this.crop, zoom: Number(this.zoom.value) };
				this.draw();
			})
		);
		this._register(
			addDisposableListener(this.stage, 'pointerdown', (event) => this.onPointerDown(event))
		);
		this._register(
			addDisposableListener(this.stage, 'pointermove', (event) => this.onPointerMove(event))
		);
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
			this._register(
				addDisposableListener(this.stage, type, () => {
					this.pointer = undefined;
				})
			);
		this._register(
			addDisposableListener(this.stage, 'keydown', (event) => this.onKeyDown(event))
		);
		const observer = new ResizeObserver(() => this.draw());
		observer.observe(this.stage);
		this._register({ dispose: () => observer.disconnect() });
	}

	private onPointerDown(event: PointerEvent): void {
		if (this.busy || !this.bitmap) return;
		this.stage.focus();
		this.stage.setPointerCapture(event.pointerId);
		this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
	}

	private onPointerMove(event: PointerEvent): void {
		const pointer = this.pointer;
		if (pointer === undefined || pointer.id !== event.pointerId || this.busy) return;
		this.move((pointer.x - event.clientX) / CIRCLE, (pointer.y - event.clientY) / CIRCLE);
		pointer.x = event.clientX;
		pointer.y = event.clientY;
	}

	private onKeyDown(event: KeyboardEvent): void {
		const directions: Record<string, readonly [number, number]> = {
			ArrowLeft: [1, 0],
			ArrowRight: [-1, 0],
			ArrowUp: [0, 1],
			ArrowDown: [0, -1]
		};
		const direction = directions[event.key];
		if (direction === undefined || this.busy) return;
		event.preventDefault();
		event.stopPropagation();
		const step = event.shiftKey ? 0.1 : 0.02;
		this.move(direction[0] * step, direction[1] * step);
	}

	private close(): void {
		if (this.busy) return;
		this.dispose();
	}

	private update(): void {
		const ready = this.bitmap !== undefined && !this.busy;
		this.save.setState({
			label: this.format.text('savePhoto'),
			icon: proctorIconFactory(photoActionIcons.savePhoto),
			disabled: !ready || this.needsCheck,
			busy: this.busy && this.bitmap !== undefined
		});
		this.cancel.setState({
			label: this.format.text('cancel'),
			icon: proctorIconFactory(photoActionIcons.cancel),
			disabled: this.busy
		});
		this.choose.setState({
			label: this.format.text('chooseAnother'),
			icon: proctorIconFactory(photoActionIcons.chooseAnother),
			disabled: this.busy
		});
		this.check.element.hidden = !this.needsCheck;
		this.check.setState({
			label: this.format.text('photoRecheck'),
			icon: proctorIconFactory(photoActionIcons.photoRecheck),
			disabled: this.busy
		});
		this.zoom.disabled = !ready;
		this.stage.setAttribute('aria-disabled', String(!ready));
	}

	private async load(file: File): Promise<void> {
		if (this.busy) return;
		const generation = ++this.generation;
		this.busy = true;
		this.feedback.set(this.format.text('photoPreparing'), 'loading');
		this.update();
		try {
			const bitmap = await decodePhoto(file);
			if (this._store.isDisposed || generation !== this.generation) {
				bitmap.close();
				return;
			}
			this.bitmap?.close();
			this.bitmap = bitmap;
			this.crop = { x: 0.5, y: 0.5, zoom: 1 };
			this.zoom.value = '1';
			this.feedback.set();
			this.draw();
		} catch (error) {
			if (!this._store.isDisposed && generation === this.generation)
				this.feedback.set(
					this.format.text(
						error instanceof PhotoImportError ? error.reason : 'photoInvalid'
					),
					'error'
				);
		} finally {
			if (!this._store.isDisposed && generation === this.generation) {
				this.busy = false;
				this.update();
				(this.bitmap ? this.stage : this.choose.element).focus();
			}
		}
	}

	private move(x: number, y: number): void {
		if (!this.bitmap) return;
		const rect = photoCropRect(this.bitmap.width, this.bitmap.height, this.crop);
		this.crop = {
			zoom: this.crop.zoom,
			x: (rect.x + rect.size / 2 + x * rect.size) / this.bitmap.width,
			y: (rect.y + rect.size / 2 + y * rect.size) / this.bitmap.height
		};
		this.draw();
	}

	/** Draws the whole image so the crop square fills the circle; the rest shows dimmed around it. */
	private draw(): void {
		const bitmap = this.bitmap;
		if (!bitmap) return;
		const rect = photoCropRect(bitmap.width, bitmap.height, this.crop);
		this.crop = {
			zoom: this.crop.zoom,
			x: (rect.x + rect.size / 2) / bitmap.width,
			y: (rect.y + rect.size / 2) / bitmap.height
		};
		const width = this.stage.clientWidth;
		const height = this.stage.clientHeight;
		const ratio = this.pane.document.defaultView?.devicePixelRatio ?? 1;
		this.canvas.width = Math.max(1, Math.round(width * ratio));
		this.canvas.height = Math.max(1, Math.round(height * ratio));
		const context = this.canvas.getContext('2d');
		if (!context) return;
		const scale = CIRCLE / rect.size;
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, width, height);
		context.drawImage(
			bitmap,
			width / 2 - (rect.x + rect.size / 2) * scale,
			height / 2 - (rect.y + rect.size / 2) * scale,
			bitmap.width * scale,
			bitmap.height * scale
		);
		this.zoom.setAttribute('aria-valuetext', `${Math.round(this.crop.zoom * 100)}%`);
		this.lowResolution.hidden = rect.size >= SAVED_SIZE;
	}

	private async upload(): Promise<void> {
		const bitmap = this.bitmap;
		if (this.busy || !bitmap || this.needsCheck) return;
		this.busy = true;
		this.feedback.set(this.format.text('photoSaving'), 'loading');
		this.update();
		let bytes: Uint8Array;
		try {
			bytes = await encodePhoto(this.pane.document, bitmap, this.crop);
		} catch {
			if (this._store.isDisposed) return;
			this.busy = false;
			this.feedback.set(this.format.text('photoInvalid'), 'error');
			this.update();
			return;
		}
		if (this._store.isDisposed) return;
		const result = await this.account.request({
			kind: 'uploadPhoto',
			bytes,
			mediaType: 'image/png',
			etag: this.etag
		});
		if (this._store.isDisposed) return;
		this.busy = false;
		if (result.kind === 'success') {
			await this.reconcile(true);
			return;
		}
		if (
			result.kind === 'error' &&
			result.reason !== 'unconfirmed' &&
			result.reason !== 'conflict'
		) {
			this.feedback.set(this.format.failure(result.reason), 'error');
			this.update();
			this.save.focus();
			return;
		}
		this.needsCheck = true;
		await this.reconcile(false);
	}

	/** Reads the saved photo: after a save it completes the dialog; otherwise it decides whether Save is safe again. */
	private async reconcile(saved: boolean): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		this.feedback.set(this.format.text('photoChecking'), 'loading');
		this.update();
		const result = await this.account.request({ kind: 'readPhoto' });
		if (this._store.isDisposed) return;
		this.busy = false;
		if (result.kind !== 'photo') {
			this.needsCheck = true;
			this.feedback.set(
				this.format.text(saved ? 'photoSavedUnconfirmed' : 'photoCheckAgain'),
				'error'
			);
			this.update();
			this.check.focus();
			return;
		}
		if (saved) {
			this.onDidSave(result);
			this.dispose();
			return;
		}
		this.needsCheck = false;
		const changedElsewhere = result.etag !== this.etag;
		this.etag = result.etag;
		this.feedback.set(changedElsewhere ? this.format.text('photoChangedElsewhere') : undefined);
		this.update();
		this.save.focus();
	}

	override dispose(): void {
		if (this._store.isDisposed) return;
		this.generation++;
		this.bitmap?.close();
		this.bitmap = undefined;
		const needsRefresh = this.needsCheck;
		super.dispose();
		this.onDidClose(needsRefresh);
	}
}
