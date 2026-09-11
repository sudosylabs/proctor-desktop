import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type { LocalizationContext } from '../../../../base/common/localization.js';
import type {
	AccountClient,
	AccountResponse
} from '../../../../platform/account/common/accountProtocol.js';
import type { WorkbenchOverlayHost } from '../../../browser/overlayHost.js';
import { AccountFeedback } from './accountFeedback.js';
import { accountMessages as m } from './accountMessages.js';
import {
	decodePhoto,
	encodePhoto,
	photoCropRect,
	PhotoImportError,
	type PhotoCrop
} from './photoImage.js';
import './accountPhotoEditor.css';

type Photo = Extract<AccountResponse, { kind: 'photo' }>;

/** A local draft. The injected account client retains authority over every mutation. */
export class AccountPhotoEditor extends Disposable {
	private readonly dialog: HTMLDialogElement;
	private readonly canvas: HTMLCanvasElement;
	private readonly zoom: HTMLInputElement;
	private readonly input: HTMLInputElement;
	private readonly save: ButtonControl;
	private readonly cancel: ButtonControl;
	private readonly choose: ButtonControl;
	private readonly review: ButtonControl;
	private readonly check: ButtonControl;
	private readonly current: HTMLImageElement;
	private readonly feedback: AccountFeedback;
	private readonly lowResolution: HTMLElement;
	private bitmap: ImageBitmap | undefined;
	private crop: PhotoCrop = { x: 0.5, y: 0.5, zoom: 1 };
	private generation = 0;
	private disposed = false;
	private busy = false;
	private pendingRevision: string | undefined;
	private needsCheck = false;
	private saved = false;
	private submitting = false;
	private touchedServer = false;
	private completed = false;
	constructor(
		document: Document,
		overlays: WorkbenchOverlayHost,
		private readonly client: AccountClient,
		private readonly localization: LocalizationContext,
		private etag: string,
		file: File,
		private readonly onSaved: (photo: Photo) => void,
		private readonly onClose: (reconcile: boolean) => void
	) {
		super();
		this.dialog = document.createElement('dialog');
		this.dialog.className = 'prctr-account-photo-editor';
		this.dialog.ariaLabel = this.text('adjustPhoto');
		const heading = document.createElement('h2');
		heading.textContent = this.text('adjustPhoto');
		const help = document.createElement('p');
		help.textContent = this.text('photoCropHelp');
		this.canvas = document.createElement('canvas');
		this.canvas.width = this.canvas.height = 512;
		this.canvas.tabIndex = 0;
		this.canvas.role = 'img';
		this.canvas.ariaLabel = this.text('photoCropLabel');
		const label = document.createElement('label');
		label.textContent = this.text('photoZoom');
		this.zoom = document.createElement('input');
		this.zoom.type = 'range';
		this.zoom.min = '1';
		this.zoom.max = '4';
		this.zoom.step = '.05';
		this.zoom.value = '1';
		label.append(this.zoom);
		this.lowResolution = document.createElement('p');
		this.lowResolution.textContent = this.text('photoLowResolution');
		this.lowResolution.hidden = true;
		this.input = document.createElement('input');
		this.input.type = 'file';
		this.input.accept = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
		this.input.hidden = true;
		this.current = document.createElement('img');
		this.current.alt = this.text('photoCurrent');
		this.current.hidden = true;
		const recovery = document.createElement('div');
		recovery.className = 'prctr-account-photo-editor__recovery';
		this.review = this.button(recovery, 'photoKeepCrop', () => {
			if (!this.pendingRevision) return;
			this.etag = this.pendingRevision;
			this.pendingRevision = undefined;
			this.current.hidden = true;
			this.feedback.set('photoRetrySafe');
			this.update();
		});
		this.check = this.button(recovery, 'photoRecheck', () => void this.reconcile());
		const actions = document.createElement('footer');
		this.choose = this.button(actions, 'chooseAnother', () => this.input.click());
		this.cancel = this.button(actions, 'cancel', () => this.dispose());
		this.save = this.button(actions, 'savePhoto', () => void this.upload(), 'primary');
		this.dialog.append(
			heading,
			help,
			this.canvas,
			label,
			this.lowResolution,
			this.input,
			this.current,
			recovery,
			actions
		);
		this.feedback = this._register(new AccountFeedback(this.dialog, localization));
		overlays.element.parentElement!.append(this.dialog);
		this._register(overlays.acquireExternalModal());
		this._register(
			addDisposableListener(this.dialog, 'cancel', (event) => {
				event.preventDefault();
				if (!this.submitting) this.dispose();
			})
		);
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
		let pointer: { id: number; x: number; y: number } | undefined;
		this._register(
			addDisposableListener(this.canvas, 'pointerdown', (event) => {
				if (this.busy || !this.bitmap) return;
				this.canvas.focus();
				this.canvas.setPointerCapture(event.pointerId);
				pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
			})
		);
		this._register(
			addDisposableListener(this.canvas, 'pointermove', (event) => {
				if (!pointer || pointer.id !== event.pointerId || this.busy) return;
				const size = this.canvas.getBoundingClientRect().width;
				this.move((pointer.x - event.clientX) / size, (pointer.y - event.clientY) / size);
				pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
			})
		);
		for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
			this._register(
				addDisposableListener(this.canvas, type, () => {
					pointer = undefined;
				})
			);
		this._register(
			addDisposableListener(this.canvas, 'keydown', (event) => {
				const directions: Record<string, [number, number]> = {
					ArrowLeft: [1, 0],
					ArrowRight: [-1, 0],
					ArrowUp: [0, 1],
					ArrowDown: [0, -1]
				};
				const direction = directions[event.key];
				if (!direction || this.busy) return;
				event.preventDefault();
				event.stopPropagation();
				this.move(
					direction[0] * (event.shiftKey ? 0.1 : 0.02),
					direction[1] * (event.shiftKey ? 0.1 : 0.02)
				);
			})
		);
		this.dialog.showModal();
		void this.load(file);
	}
	private text(key: keyof typeof m): string {
		return this.localization.format(m[key]);
	}
	private button(
		host: HTMLElement,
		key: keyof typeof m,
		action: () => void,
		variant: 'primary' | 'secondary' = 'secondary'
	): ButtonControl {
		const button = this._register(new ButtonControl(host, { label: this.text(key), variant }));
		this._register(button.onDidRequest(action));
		return button;
	}
	private update(): void {
		this.save.setState({
			label: this.text(this.busy && this.saved ? 'photoChecking' : 'savePhoto'),
			disabled:
				this.busy || !this.bitmap || this.needsCheck || !!this.pendingRevision || this.saved
		});
		this.cancel.setState({
			label: this.text(this.saved ? 'close' : 'cancel'),
			disabled: this.submitting
		});
		this.choose.setState({
			label: this.text('chooseAnother'),
			disabled: this.busy || this.saved
		});
		this.zoom.disabled = this.busy || !this.bitmap || this.saved;
		this.canvas.setAttribute('aria-disabled', String(this.busy || this.saved));
		this.review.element.hidden = !this.pendingRevision;
		this.review.setState({ label: this.text('photoKeepCrop'), disabled: this.busy });
		this.check.element.hidden = !this.needsCheck;
		this.check.setState({ label: this.text('photoRecheck'), disabled: this.busy });
	}
	private async load(file: File): Promise<void> {
		if (this.busy) return;
		const generation = ++this.generation;
		this.busy = true;
		this.feedback.set('photoPreparing', 'loading');
		this.update();
		try {
			const bitmap = await decodePhoto(file);
			if (this.disposed || generation !== this.generation) {
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
			if (!this.disposed && generation === this.generation)
				this.feedback.set(
					error instanceof PhotoImportError ? error.reason : 'photoInvalid',
					'error'
				);
		} finally {
			if (!this.disposed && generation === this.generation) {
				this.busy = false;
				this.update();
				(this.bitmap ? this.canvas : this.choose.element).focus();
			}
		}
	}
	private move(x: number, y: number): void {
		if (!this.bitmap || this.saved) return;
		const rect = photoCropRect(this.bitmap.width, this.bitmap.height, this.crop);
		this.crop = {
			zoom: this.crop.zoom,
			x: (rect.x + rect.size / 2 + x * rect.size) / this.bitmap.width,
			y: (rect.y + rect.size / 2 + y * rect.size) / this.bitmap.height
		};
		this.draw();
	}
	private draw(): void {
		if (!this.bitmap) return;
		const rect = photoCropRect(this.bitmap.width, this.bitmap.height, this.crop);
		this.crop = {
			zoom: this.crop.zoom,
			x: (rect.x + rect.size / 2) / this.bitmap.width,
			y: (rect.y + rect.size / 2) / this.bitmap.height
		};
		const context = this.canvas.getContext('2d')!;
		context.clearRect(0, 0, 512, 512);
		context.drawImage(this.bitmap, rect.x, rect.y, rect.size, rect.size, 0, 0, 512, 512);
		this.zoom.setAttribute('aria-valuetext', `${Math.round(this.crop.zoom * 100)}%`);
		this.lowResolution.hidden = rect.size >= 512;
	}
	private async request(
		intent: Parameters<AccountClient['request']>[0]
	): Promise<AccountResponse> {
		try {
			return await this.client.request(intent);
		} catch {
			return {
				kind: 'error',
				reason: intent.kind === 'readPhoto' ? 'unavailable' : 'unconfirmed'
			};
		}
	}
	private async upload(): Promise<void> {
		if (this.busy || !this.bitmap || this.needsCheck || this.pendingRevision || this.saved)
			return;
		this.busy = true;
		this.submitting = true;
		this.feedback.set('photoSaving', 'loading');
		this.update();
		try {
			const bytes = await encodePhoto(this.dialog.ownerDocument, this.bitmap, this.crop);
			if (this.disposed) return;
			const result = await this.request({
				kind: 'uploadPhoto',
				bytes,
				mediaType: 'image/png',
				etag: this.etag
			});
			if (this.disposed) return;
			if (result.kind === 'success') {
				this.touchedServer = true;
				this.saved = true;
				this.busy = false;
				await this.reconcile();
				return;
			}
			if (
				result.kind !== 'error' ||
				result.reason === 'unconfirmed' ||
				result.reason === 'conflict'
			) {
				this.touchedServer = true;
				this.needsCheck = true;
				this.busy = false;
				await this.reconcile();
				return;
			}
			this.feedback.set(result.kind === 'error' ? result.reason : 'unconfirmed', 'error');
		} catch {
			if (!this.disposed) this.feedback.set('photoInvalid', 'error');
		} finally {
			if (!this.disposed) {
				this.busy = false;
				this.submitting = false;
				this.update();
				if (!this.save.element.disabled) this.save.focus();
			}
		}
	}
	private async reconcile(): Promise<void> {
		if (this.busy || this.disposed) return;
		this.busy = true;
		this.feedback.set('photoChecking', 'loading');
		this.update();
		const result = await this.request({ kind: 'readPhoto' });
		if (this.disposed) return;
		this.busy = false;
		if (result.kind !== 'photo') {
			this.needsCheck = true;
			this.feedback.set(this.saved ? 'photoSavedUnavailable' : 'unconfirmed', 'error');
			this.update();
			this.check.focus();
			return;
		}
		if (this.saved) {
			this.completed = true;
			this.onSaved(result);
			this.dispose();
			return;
		}
		this.needsCheck = false;
		if (result.etag !== this.etag) {
			this.pendingRevision = result.etag;
			this.current.src = result.dataUrl;
			this.current.hidden = false;
			this.feedback.set('photoReview');
		} else this.feedback.set('photoRetrySafe');
		this.update();
		(this.pendingRevision ? this.review : this.save).focus();
	}
	override dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.generation++;
		this.bitmap?.close();
		this.bitmap = undefined;
		this.dialog.close();
		this.dialog.remove();
		super.dispose();
		this.onClose(this.touchedServer && !this.completed);
	}
}
