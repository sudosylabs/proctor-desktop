import { ToastHost } from '../../src/prctr/base/browser/ui/toast/toastHost.ts';
import { proctorIconFactory } from '../../src/prctr/platform/theme/browser/proctorIcon.ts';
import { AccountPhotoDialog } from '../../src/prctr/workbench/contrib/account/profile/photoDialog.ts';
import {
	IPagePaneContext,
	PagePaneContext
} from '../../src/prctr/workbench/browser/authenticated/pages/pagePaneContext.ts';
import { ServiceCollection } from '../../src/prctr/platform/instantiation/common/serviceCollection.ts';
import { createAccountTestServices } from './accountTestServices.ts';
import { MenuControl } from '../../src/prctr/base/browser/ui/menu/menuControl.ts';
import { Event as Events } from '../../src/prctr/base/common/event.ts';
import {
	inspectPhoto,
	photoCropRect,
	decodePhoto
} from '../../src/prctr/workbench/contrib/account/profile/photoImage.ts';
import { WorkbenchOverlayHost } from '../../src/prctr/workbench/browser/overlayHost.ts';
import { createLocalization } from '../../src/prctr/base/common/localization.ts';
import { accountText } from '../../src/prctr/workbench/contrib/account/accountMessages.ts';
import type {
	AccountIntent,
	AccountResponse
} from '../../src/prctr/platform/account/common/accountProtocol.ts';

export async function runAccountPhotoTests(document: Document): Promise<void> {
	const assert = (value: unknown, message: string): void => {
		if (!value) throw new Error(message);
	};
	const wait = async (predicate: () => boolean): Promise<void> => {
		for (let i = 0; i < 100; i++) {
			if (predicate()) return;
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		}
		throw new Error('Photo editor did not settle');
	};
	const source = document.createElement('canvas');
	source.width = 900;
	source.height = 600;
	const ctx = source.getContext('2d')!;
	ctx.fillStyle = 'red';
	ctx.fillRect(0, 0, 450, 600);
	ctx.fillStyle = 'blue';
	ctx.fillRect(450, 0, 450, 600);
	const blob = await new Promise<Blob>((resolve) =>
		source.toBlob((value) => resolve(value!), 'image/png')
	);
	const file = new File([blob], 'photo.png', { type: 'image/png' });
	const large = new File([blob, new Uint8Array(6 * 1024 * 1024)], 'large.png', {
		type: 'image/png'
	});
	const largeBitmap = await decodePhoto(large);
	assert(largeBitmap.width === 900, 'Safely reducible image above upload limit was rejected');
	largeBitmap.close();
	const jpeg = await new Promise<Blob>((resolve) =>
		source.toBlob((value) => resolve(value!), 'image/jpeg')
	);
	const jpegBytes = new Uint8Array(await jpeg.arrayBuffer());
	// APP1 Exif with TIFF orientation 6 (90 degrees clockwise).
	const exif = new Uint8Array([
		255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1,
		0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0
	]);
	const rotated = await decodePhoto(
		new File([jpegBytes.slice(0, 2), exif, jpegBytes.slice(2)], 'rotated.jpg', {
			type: 'image/jpeg'
		})
	);
	assert(
		rotated.width === 600 && rotated.height === 900,
		'EXIF orientation was not honored before cropping'
	);
	rotated.close();
	const header = inspectPhoto(new Uint8Array(await file.arrayBuffer()));
	assert(header.width === 900 && header.height === 600, 'PNG bounds are incorrect');
	const rect = photoCropRect(900, 600, { x: -100, y: 100, zoom: 2 });
	assert(rect.x === 0 && rect.y === 300 && rect.size === 300, 'Crop escaped the source');
	const oversized = new Uint8Array(await file.arrayBuffer());
	new DataView(oversized.buffer).setUint32(16, 100000);
	let rejected = false;
	try {
		inspectPhoto(oversized);
	} catch {
		rejected = true;
	}
	assert(rejected, 'Oversized dimensions reached the decoder');
	rejected = false;
	try {
		await decodePhoto(new File(['garbage'], 'bad.png', { type: 'image/png' }));
	} catch {
		rejected = true;
	}
	assert(rejected, 'An image extension bypassed image validation');
	const host = document.createElement('div'),
		background = document.createElement('div');
	document.body.append(host, background);
	const overlays = new WorkbenchOverlayHost(host, background);
	const requests: AccountIntent[] = [];
	let mode: 'success' | 'uncertain' | 'conflict' | 'reject' = 'success';
	let refreshOnClose = false;
	let saved = 0,
		closed = 0;
	const initial = '"' + 'a'.repeat(64) + '"',
		newer = '"' + 'b'.repeat(64) + '"';
	const photo = source.toDataURL('image/webp');
	const client = {
		async request(intent: AccountIntent): Promise<AccountResponse> {
			requests.push(intent);
			if (intent.kind === 'uploadPhoto') {
				const size = inspectPhoto(intent.bytes);
				assert(
					size.width === size.height && size.width <= 512,
					'Upload was not a bounded square'
				);
				return mode === 'success'
					? { kind: 'success' }
					: {
							kind: 'error',
							reason:
								mode === 'uncertain'
									? 'unconfirmed'
									: mode === 'conflict'
										? 'conflict'
										: 'invalid'
						};
			}
			return { kind: 'photo', dataUrl: photo, etag: mode === 'uncertain' ? initial : newer };
		}
	};
	const localization = createLocalization({
		requestedLocale: 'en',
		messages: Object.values(accountText)
	});
	const services = createAccountTestServices({
		document,
		overlays,
		account: client,
		localization,
		now: Date.now,
		binding: {
			kind: 'authenticated',
			windowId: 'test:photo',
			institutionOrigin: 'https://institution.example.test',
			principalId: 'y'.repeat(26),
			sessionId: 'b'.repeat(26),
			initialDestination: 'account'
		}
	});
	const menu = new MenuControl(host, {
		canInteract: () => true,
		onDidChangeInteraction: Events.None,
		restoreFocus: () => undefined,
		onActionError: () => undefined
	});
	const pane = services.instantiationService.createChild(
		new ServiceCollection([
			IPagePaneContext,
			new PagePaneContext(
				document,
				overlays,
				menu,
				new ToastHost(host, {
					dismissLabel: 'Dismiss',
					dismissIcon: proctorIconFactory('action.close', 14)
				}),
				'Try again',
				() => undefined,
				(reason) => reason,
				() => undefined
			)
		])
	);
	const button = (label: string) =>
		[...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(
			(b) => b.textContent === label
		)!;
	const dialogText = (): string => document.querySelector('dialog')?.textContent ?? '';
	const open = () =>
		pane.createInstance(
			AccountPhotoDialog,
			initial,
			file,
			() => saved++,
			(refresh) => {
				refreshOnClose = refresh;
				closed++;
			}
		);
	let editor: AccountPhotoDialog | undefined;
	try {
		editor = open();
		await wait(() => !!button('Save photo') && !button('Save photo').disabled);
		assert(overlays.visible, 'Modal did not gate the workbench');
		assert(dialogText().includes('Change photo'), 'The dialog is titled Change photo');
		assert(!requests.length, 'Selection uploaded without explicit save');
		const stage = document.querySelector<HTMLElement>('dialog .prctr-account-photo__stage')!;
		const canvas = stage.querySelector('canvas')!;
		const before = canvas.toDataURL();
		stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
		assert(before !== canvas.toDataURL(), 'Keyboard framing did not move the image');
		const zoom = document.querySelector<HTMLInputElement>('dialog input[type=range]')!;
		zoom.value = '2';
		zoom.dispatchEvent(new Event('input'));
		assert(zoom.getAttribute('aria-valuetext') === '200%', 'Zoom does not report its value');
		const input = document.querySelector<HTMLInputElement>('dialog input[type=file]')!;
		const moved = canvas.toDataURL();
		input.dispatchEvent(new Event('cancel'));
		assert(moved === canvas.toDataURL(), 'Cancelling a replacement discarded the crop');
		button('Cancel').click();
		assert(
			!document.querySelector('dialog') && !overlays.visible && saved === 0,
			'Cancel changed the account or left modal gating'
		);
		editor = open();
		await wait(() => !button('Save photo')?.disabled);
		button('Save photo').click();
		await wait(() => !document.querySelector('dialog'));
		assert(saved === 1, 'Confirmed save did not update the photo');
		assert(
			requests
				.slice(-2)
				.map((r) => r.kind)
				.join() === 'uploadPhoto,readPhoto',
			'A save is confirmed by reading the photo again'
		);
		mode = 'reject';
		editor = open();
		await wait(() => !button('Save photo')?.disabled);
		button('Save photo').click();
		await wait(() => dialogText().includes('didn’t accept'));
		assert(!button('Save photo').disabled, 'A known rejection prevented retry');
		editor.dispose();
		mode = 'uncertain';
		editor = open();
		await wait(() => !button('Save photo')?.disabled);
		const count = requests.length;
		button('Save photo').click();
		await wait(() => requests.length === count + 2 && !button('Save photo').disabled);
		assert(
			requests
				.slice(count)
				.map((r) => r.kind)
				.join(',') === 'uploadPhoto,readPhoto',
			'An unknown outcome was retried before reading the photo'
		);
		editor.dispose();
		mode = 'conflict';
		editor = open();
		await wait(() => !button('Save photo')?.disabled);
		refreshOnClose = false;
		button('Save photo').click();
		await wait(() => dialogText().includes('changed somewhere else'));
		mode = 'success';
		button('Save photo').click();
		await wait(() => !document.querySelector('dialog'));
		const upload = requests
			.filter(
				(r): r is Extract<AccountIntent, { kind: 'uploadPhoto' }> =>
					r.kind === 'uploadPhoto'
			)
			.at(-1)!;
		assert(upload.etag === newer, 'A conflict did not adopt the refreshed revision');
		editor = open();
		editor.dispose();
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert(
			!document.querySelector('dialog') && !overlays.visible,
			'A late decode resurrected a disposed dialog'
		);
		assert(closed >= 6, 'Dialog closure was not reported');
		assert(!refreshOnClose, 'A settled dialog asked the page to refresh');
	} finally {
		editor?.dispose();
		menu.dispose();
		overlays.dispose();
		host.remove();
		background.remove();
	}
}
