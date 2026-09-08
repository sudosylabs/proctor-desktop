import type {
	LaunchIdentityProjection,
	LaunchIdentityClient
} from '../../src/prctr/platform/identity/common/launchIdentity.ts';
import { launchStates } from '../../src/prctr/platform/identity/common/launchIdentity.ts';
import { bootstrapLaunchWindow } from '../../src/prctr/workbench/browser/launchWindow.ts';

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}
const tick = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};

export async function runLaunchWindowTests(
	document: Document,
	parent: HTMLElement = document.body
): Promise<void> {
	const frame = document.createElement('iframe');
	frame.style.width = '360px';
	frame.style.height = '640px';
	parent.append(frame);
	const owner = frame.contentDocument!;
	// Exercise the production stylesheet in a real browsing context.
	await Promise.all(
		Array.from(
			document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
			(sheet) =>
				new Promise<void>((resolve, reject) => {
					const link = owner.createElement('link');
					link.rel = 'stylesheet';
					link.href = sheet.href;
					link.onload = () => resolve();
					link.onerror = () =>
						reject(new Error('Launch fixture stylesheet failed to load'));
					owner.head.append(link);
				})
		)
	);
	let listener: ((value: LaunchIdentityProjection) => void) | undefined;
	let fullscreenListener: ((value: boolean) => unknown) | undefined;
	let released = false;
	let chromeReleased = false;
	let selected = '';
	const chromeUpdates: unknown[] = [];
	let finish!: () => void;
	let projection: LaunchIdentityProjection = {
		protocolVersion: 1,
		revision: 0,
		state: 'selectingServer',
		developmentOrigin: false,
		canSignIn: false,
		authorizationAvailable: false
	};
	const publish = (
		state: LaunchIdentityProjection['state'],
		extra: Partial<LaunchIdentityProjection> = {}
	): void => {
		projection = {
			protocolVersion: 1,
			revision: projection.revision + 1,
			state,
			developmentOrigin: false,
			canSignIn: false,
			authorizationAvailable: false,
			...extra
		};
		listener?.(projection);
	};
	const identity: LaunchIdentityClient = {
		projection: async () => projection,
		onDidChange: (accept) => {
			listener = accept;
			return {
				dispose: () => {
					released = true;
					listener = undefined;
				}
			};
		},
		selectServer: async (address) => {
			selected = address;
			publish('checking', { origin: 'https://example.edu' });
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
		},
		changeServer: async () => {
			publish('selectingServer');
		},
		retry: async () => {},
		signIn: async () => {
			throw new Error('No authorization owner');
		}
	};
	const launch = await bootstrapLaunchWindow(owner, {
		bootstrap: async () => ({
			protocolVersion: 1,
			kind: 'launch',
			windowId: 'launch-ui-test',
			institutionOrigin: 'https://not-readiness.example.test'
		}),
		windowChrome: {
			configuration: async () => {
				fullscreenListener?.(true);
				return {
					protocolVersion: 1,
					platform: 'win32',
					mode: 'nativeOverlay',
					controlsLocation: 'right',
					titlebarHeight: 35,
					fullscreen: false
				};
			},
			zoomFactor: () => 1,
			onDidChangeFullscreen: (accept) => {
				fullscreenListener = accept;
				return {
					dispose: () => {
						chromeReleased = true;
						fullscreenListener = undefined;
					}
				};
			},
			update: async (value) => {
				chromeUpdates.push(value);
			}
		},
		identity,
		exit: async () => {}
	});
	try {
		check(
			launch.element.firstElementChild?.classList.contains('prctr-product-window-chrome') &&
				chromeUpdates.length > 0,
			'Launch must initialize the product-owned native window chrome'
		);
		check(
			launch.element.firstElementChild?.getAttribute('data-fullscreen') === 'true',
			'Launch window chrome lost a fullscreen change racing its initial snapshot'
		);
		fullscreenListener?.(false);
		check(
			launch.element.firstElementChild?.getAttribute('data-fullscreen') === 'false',
			'Launch window chrome did not track later native fullscreen changes'
		);
		const brand = owner.querySelector<HTMLElement>('.prctr-brand-lockup');
		check(
			brand?.getAttribute('aria-hidden') === 'true' &&
				brand.querySelector('img')?.alt === '' &&
				owner.querySelector('h1')?.getAttribute('aria-label') === 'Proctor',
			'Launch lockup must supply the accessible product heading without repeated copy'
		);
		const input = owner.querySelector('input')!;
		const form = owner.querySelector('form')!;
		const action = (text: string): HTMLButtonElement => {
			const button = Array.from(owner.querySelectorAll('button')).find(
				(element) => element.textContent === text
			);
			check(button, 'Missing Launch action: ' + text);
			return button;
		};
		check(owner.activeElement === input, 'Launch must focus server entry');
		check(
			!form.hidden && !owner.body.textContent?.includes('not-readiness'),
			'Bootstrap origin must not imply verified readiness'
		);
		input.value = 'example.edu';
		form.requestSubmit();
		check(
			selected === 'example.edu' && form.hidden,
			'Server form must send one bounded selection intent'
		);
		check(
			owner.defaultView!.getComputedStyle(form).display === 'none',
			'Hidden server form was made visible by the cascade'
		);
		check(
			owner.activeElement?.getAttribute('role') === 'status',
			'Pending selection must not leave focus in hidden input'
		);
		check(
			!action('Change server').disabled &&
				action('Change server').closest('[hidden]') === null,
			'Changing server must remain available during a pending check'
		);
		check(
			!owner.querySelector('footer') && !owner.body.textContent?.includes('Exit Proctor'),
			'Native exit must not be repeated in the content'
		);
		action('Change server').click();
		await tick();
		check(
			!form.hidden && owner.activeElement === input,
			'Changing server must restore input focus'
		);
		finish();
		await tick();
		publish('invalidServer');
		check(
			input.getAttribute('aria-invalid') === 'true' &&
				input.getAttribute('aria-describedby')?.includes('-error'),
			'Invalid origin needs associated field error'
		);
		const stale = projection;
		publish('ready', {
			origin: 'https://example.edu',
			institutionName: '<img src=x onerror=alert(1)>',
			administratorMessage: '<script>unsafe</script>'
		});
		check(
			owner.querySelector('script') === null &&
				launch.element.querySelector('.prctr-launch-window__server img') === null &&
				launch.element.querySelector('.prctr-launch-window__administrator img') === null,
			'Server text became markup'
		);
		check(
			action('Sign in').disabled &&
				action('Sign in').getAttribute('aria-label') ===
					'Sign in to <img src=x onerror=alert(1)>',
			'Unavailable auth owner must keep sign-in disabled'
		);
		check(
			owner.body.textContent?.includes('Sign-in is not available in this build.'),
			'Unwired auth must be explained'
		);
		check(
			Array.from(
				owner.querySelectorAll<HTMLButtonElement>("button[data-variant='primary']")
			).filter((button) => button.closest('[hidden]') === null).length === 1,
			'Ready Launch state must expose one primary task action'
		);
		listener?.(stale);
		check(
			launch.element.dataset.state === 'ready',
			'Stale projection replaced current readiness'
		);
		publish('ready', {
			origin: 'https://example.edu',
			institutionName: 'Example University',
			canSignIn: true,
			authorizationAvailable: true
		});
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		const readyTask = launch.element.querySelector<HTMLElement>('main')!;
		const readyPage = launch.element.querySelector<HTMLElement>('.prctr-launch-window__page')!;
		const taskBounds = readyTask.getBoundingClientRect();
		const pageBounds = readyPage.getBoundingClientRect();
		check(
			Math.abs(
				taskBounds.top + taskBounds.height / 2 - pageBounds.top - pageBounds.height / 2
			) <= 1,
			'The entire brand and action group must be vertically centered'
		);
		check(
			Math.abs(action('Sign in').getBoundingClientRect().width - 240) <= 1,
			'The main launch action must retain its intended visual width'
		);
		check(
			action('Sign in').getBoundingClientRect().height >= 40,
			'The main launch action must use the large control size'
		);
		check(
			!owner.body.textContent?.includes('https://example.edu') &&
				!owner.body.textContent?.includes('Opens your browser'),
			'The verified Institution should supply context without the origin or browser hint'
		);
		const signInBounds = action('Sign in').getBoundingClientRect();
		const changeBounds = action('Change server').getBoundingClientRect();
		check(
			action('Change server').dataset.variant === 'secondary' &&
				changeBounds.top > signInBounds.bottom &&
				Math.abs(changeBounds.width - signInBounds.width) <= 1,
			'Change server must be a compact muted button directly below Sign in'
		);
		check(
			owner.defaultView!.getComputedStyle(launch.element.firstElementChild!)
				.backgroundColor ===
				owner.defaultView!.getComputedStyle(launch.element).backgroundColor,
			'Native chrome must blend into the window canvas'
		);
		check(
			owner.querySelector<HTMLElement>('[role=status]')?.dataset.announcementOnly === 'true',
			'Ready status must not repeat the sign-in action visually'
		);
		action('Sign in').focus();
		action('Sign in').click();
		await tick();
		check(
			owner.querySelector('[role=alert]')?.textContent?.includes('could not be completed'),
			'Failed sign-in must provide recoverable feedback'
		);
		for (const state of launchStates) {
			const selection = state === 'selectingServer' || state === 'invalidServer';
			publish(
				state,
				selection
					? {}
					: {
							origin: 'https://example.edu',
							institutionName: 'Example University',
							authorizationAvailable: true,
							canSignIn: state === 'ready'
						}
			);
			check(
				launch.element.dataset.state === state,
				'Missing rendered readiness state: ' + state
			);
			check(
				(action('Change server').closest('[hidden]') !== null) === selection,
				'Change server must only be offered after a server has been submitted'
			);
			const status = owner.querySelector('[role=status]');
			check(
				status?.textContent && status.getAttribute('aria-atomic') === 'true',
				'Readiness state needs an atomic announcement'
			);
		}
		publish('maintenance', {
			origin: 'http://localhost:8080',
			institutionName: 'Long Institution '.repeat(20),
			administratorMessage: 'Please retry after maintenance.',
			developmentOrigin: true,
			retryAt: Date.now() + 60000
		});
		check(
			owner.body.textContent?.includes('Development server'),
			'HTTP development selection must be visible'
		);
		check(
			action('Retry').dataset.variant === 'primary',
			'Retryable Launch state must promote Retry as its primary task action'
		);
		owner.documentElement.dir = 'rtl';
		owner.documentElement.style.zoom = '2';
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		check(
			owner.documentElement.scrollWidth <= owner.documentElement.clientWidth + 1,
			'Launch surface overflows at narrow width and 200% zoom'
		);
		const scroller = launch.element.querySelector<HTMLElement>('.prctr-launch-window__page');
		check(scroller !== null, 'Launch scroll container is missing');
		scroller.scrollTop = scroller.scrollHeight;
		check(scroller.scrollTop > 0, 'Long Launch state must remain vertically scrollable');
		check(
			action('Retry').getBoundingClientRect().bottom <=
				scroller.getBoundingClientRect().bottom,
			'Recovery action cannot be reached at 200% zoom'
		);
	} finally {
		launch.disposables.dispose();
		check(
			released && chromeReleased && owner.body.querySelector('main') === null,
			'Launch disposal leaked subscription or surface'
		);
		frame.remove();
	}
	await verifySnapshotRace(document);
}

async function verifySnapshotRace(document: Document): Promise<void> {
	const owner = document.implementation.createHTMLDocument('launch snapshot race');
	const initial: LaunchIdentityProjection = {
		protocolVersion: 1,
		revision: 0,
		state: 'selectingServer',
		developmentOrigin: false,
		authorizationAvailable: false,
		canSignIn: false
	};
	const launch = await bootstrapLaunchWindow(owner, {
		bootstrap: async () => ({ protocolVersion: 1, kind: 'launch', windowId: 'launch-race' }),
		windowChrome: {
			configuration: async () => ({
				protocolVersion: 1,
				platform: 'win32',
				mode: 'nativeOverlay',
				controlsLocation: 'right',
				titlebarHeight: 35,
				fullscreen: false
			}),
			zoomFactor: () => 1,
			onDidChangeFullscreen: () => ({ dispose() {} }),
			update: async () => {}
		},
		identity: {
			onDidChange: (listener) => {
				listener({
					...initial,
					revision: 2,
					state: 'checking',
					origin: 'https://example.edu'
				});
				return { dispose() {} };
			},
			projection: async () => initial,
			selectServer: async () => {},
			changeServer: async () => {},
			retry: async () => {},
			signIn: async () => {}
		},
		exit: async () => {}
	});
	try {
		check(
			launch.element.dataset.state === 'checking',
			'Initial snapshot overwrote a newer subscription event'
		);
	} finally {
		launch.disposables.dispose();
	}
}
