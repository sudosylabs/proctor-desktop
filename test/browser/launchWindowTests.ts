import type {
	LaunchIdentityProjection,
	LaunchIdentityClient
} from '../../src/prctr/platform/identity/common/launchIdentity.ts';
import { launchStates } from '../../src/prctr/platform/identity/common/launchIdentity.ts';
import { bootstrapLaunchWindow } from '../../src/prctr/workbench/browser/launch/launchWindow.ts';

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
	frame.style.width = '440px';
	frame.style.height = '600px';
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
			revision: projection.revision + 1,
			state,
			developmentOrigin: false,
			canSignIn: false,
			authorizationAvailable: false,
			...extra
		};
		listener?.(projection);
	};
	let cancels = 0;
	let reopens = 0;
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
		},
		cancel: async () => {
			cancels++;
		},
		reopenBrowser: async () => {
			reopens++;
		}
	};
	const launch = await bootstrapLaunchWindow(owner, {
		bootstrap: async () => ({
			kind: 'launch',
			windowId: 'launch-ui-test',
			institutionOrigin: 'https://not-readiness.example.test'
		}),
		windowChrome: {
			configuration: async () => {
				fullscreenListener?.(true);
				return {
					platform: 'win32',
					mode: 'nativeOverlay',
					controlsLocation: 'right',
					titlebarHeight: 35,
					fullscreen: false,
					material: 'none' as const
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
	const counts = (): { cancels: number; reopens: number } => ({ cancels, reopens });
	const view = owner.defaultView!;
	const frameTick = (): Promise<void> =>
		new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve()));
	const button = (text: string): HTMLButtonElement => {
		const found = Array.from(owner.querySelectorAll('button')).find(
			(element) => element.textContent === text
		);
		check(found, 'Missing Launch action: ' + text);
		return found;
	};
	const painted = (element: Element): boolean => element.getBoundingClientRect().height > 0;
	const announcer = (): HTMLElement =>
		launch.element.querySelector<HTMLElement>('.prctr-launch-window__announcer')!;
	const rows = (): HTMLElement[] =>
		Array.from(launch.element.querySelectorAll<HTMLElement>('.prctr-launch-checks__row'));
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

		const heading = owner.querySelector('h1');
		check(
			heading?.textContent === 'Proctor' &&
				owner.querySelector('.prctr-launch-header__mark')?.getAttribute('aria-hidden') ===
					'true',
			'The header names the product once and keeps the mark decorative'
		);
		const input = owner.querySelector('input')!;
		const form = owner.querySelector('form')!;
		check(owner.activeElement === input, 'Launch must focus server entry');
		check(
			!form.hidden && !owner.body.textContent?.includes('not-readiness'),
			'Bootstrap origin must not imply verified readiness'
		);
		check(
			rows().length === 4 && rows().every((row) => row.dataset.status === 'pending'),
			'Server selection previews four pending checks'
		);

		input.value = 'example.edu';
		button('Continue').click();
		check(
			selected === 'example.edu' && form.hidden,
			'Continue must send one bounded selection intent'
		);
		check(view.getComputedStyle(form).display === 'none', 'The hidden form was made visible');
		check(
			owner.activeElement === button('Cancel'),
			'A pending check moves focus to an available action, not hidden input or message text'
		);
		check(
			rows()[0]?.dataset.status === 'active' &&
				rows()
					.slice(1)
					.every((row) => row.dataset.status === 'pending'),
			'Checking shows the first check running and the rest waiting'
		);
		const spinner = owner.querySelector<HTMLElement>(
			'[data-prctr-semantic-icon="state.loading"]'
		);
		check(spinner, 'Server checks must show the loading glyph');
		if (!view.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			await frameTick();
			const before = view.getComputedStyle(spinner).transform;
			await new Promise((resolve) => view.setTimeout(resolve, 100));
			check(
				view.getComputedStyle(spinner).transform !== before,
				'The loading spinner must visibly rotate while checking'
			);
		}
		button('Cancel').click();
		await tick();
		check(counts().cancels === 1, 'Cancel must reach the identity coordinator');
		button('Change').click();
		await tick();
		check(!form.hidden && owner.activeElement === input, 'Change must restore input focus');
		finish();
		await tick();

		publish('invalidServer');
		const describedBy = input.getAttribute('aria-describedby') ?? '';
		check(
			input.getAttribute('aria-invalid') === 'true' &&
				describedBy.split(' ').some((id) => owner.getElementById(id)?.textContent),
			'An invalid address needs an associated field error'
		);
		check(
			announcer().textContent?.includes('without a path') &&
				announcer().getAttribute('role') === 'status' &&
				announcer().getAttribute('aria-atomic') === 'true',
			'The invalid address is announced once through the window announcer'
		);

		const stale = projection;
		publish('ready', {
			origin: 'https://example.edu',
			institutionName: '<img src=x onerror=alert(1)>',
			administratorMessage: '<script>unsafe</script>'
		});
		check(
			owner.querySelector('script') === null &&
				launch.element.querySelector(
					'.prctr-launch-server img, .prctr-launch-status img'
				) === null,
			'Server text became markup'
		);
		check(
			button('Sign in').disabled &&
				owner.body.textContent?.includes('Sign-in isn’t available in this build'),
			'A build without a sign-in owner explains itself and keeps sign-in disabled'
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
			authorizationAvailable: true,
			build: { release: '0.1.0', platform: 'windows' }
		});
		await frameTick();
		const signIn = button('Sign in to Example University');
		check(
			!signIn.disabled &&
				signIn.dataset.variant === 'brand' &&
				signIn.getBoundingClientRect().height >= 40,
			'Ready offers one large branded sign-in action'
		);
		check(
			Array.from(owner.querySelectorAll<HTMLButtonElement>('button[data-variant]')).filter(
				(element) => painted(element)
			).length === 1,
			'Ready shows exactly one footer action'
		);
		check(
			rows().every((row) => row.dataset.status === 'done') &&
				owner.body.textContent?.includes('Proctor 0.1.0 · Windows') &&
				owner.querySelector('.prctr-launch-header__version')?.textContent === '0.1.0',
			'Ready marks every check done and names the build that was checked'
		);
		check(
			rows().every((row) => row.querySelector('.prctr-launch-checks__status')?.textContent),
			'Every check carries a status word for screen readers'
		);
		check(
			!launch.element.querySelector('.prctr-notifications-indicator, .prctr-notifications'),
			'Launch must not mount the workbench notification UI'
		);
		check(
			view.getComputedStyle(launch.element.firstElementChild!).backgroundColor ===
				view.getComputedStyle(launch.element).backgroundColor,
			'Native chrome must blend into the window canvas'
		);
		signIn.focus();
		signIn.click();
		await tick();
		check(
			painted(launch.element.querySelector('.prctr-launch-status__failure')!) &&
				announcer().textContent?.includes('That didn’t work'),
			'A failed action gives visible, announced, recoverable feedback'
		);

		publish('authorizing', {
			origin: 'https://example.edu',
			institutionName: 'Example University',
			authorizationAvailable: true
		});
		button('Open the sign-in page again').click();
		await tick();
		check(counts().reopens === 1, 'The reopen link must reach the identity coordinator');
		button('Cancel').click();
		await tick();
		check(counts().cancels === 2, 'Cancel during sign-in must reach the identity coordinator');

		const ending = {
			sequence: 1,
			origin: 'https://example.edu',
			institutionName: 'Example University',
			authentication: 'ending',
			sessionValidity: 'verificationRequired',
			credentialReadiness: 'locked',
			reason: 'signOut',
			localCleanup: 'pending',
			remoteRevocation: 'pending'
		} as const;
		publish('authorizationFailed', {
			origin: ending.origin,
			institutionName: ending.institutionName,
			sessionOutcome: ending
		});
		check(
			button('Continue').disabled && !painted(button('Change')),
			'Sign-out cleanup must settle before a new identity action'
		);
		check(
			announcer().textContent === 'Signing out…',
			'Pending cleanup needs its own announcement'
		);
		publish('authorizationFailed', {
			origin: ending.origin,
			institutionName: ending.institutionName,
			sessionOutcome: {
				...ending,
				authentication: 'signedOut',
				localCleanup: 'cleared',
				remoteRevocation: 'unconfirmed'
			}
		});
		check(
			!button('Continue').disabled && painted(button('Change')),
			'Settled cleanup must restore recovery actions'
		);
		check(
			owner
				.querySelector('.prctr-launch-notice')
				?.textContent?.includes('couldn’t confirm sign-out with the server'),
			'A stale access token must never render successful remote sign-out'
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
			check(launch.element.dataset.state === state, 'Missing rendered state: ' + state);
			check(
				!painted(button('Change')) === selection,
				'Change must only be offered after a server has been submitted: ' + state
			);
			check(rows().length === 4, 'Every state shows the four checks: ' + state);
			const loading = Array.from(
				owner.querySelectorAll(
					'[data-prctr-semantic-icon="state.loading"][data-prctr-icon-modifier="spin"]'
				)
			).some(painted);
			check(
				loading === ['checking', 'authorizing'].includes(state),
				'Spinner must follow pending work and stop for settled states: ' + state
			);
			check(
				owner.querySelectorAll('[role=status], [role=alert], [aria-live]').length === 1,
				'Exactly one live region announces state: ' + state
			);
		}

		publish('maintenance', {
			origin: 'http://localhost:8080',
			institutionName: 'Long Institution '.repeat(20),
			administratorMessage: 'Please retry after maintenance. '.repeat(8),
			developmentOrigin: true,
			retryAt: Date.now() + 60000
		});
		check(
			painted(launch.element.querySelector('.prctr-launch-window__development')!),
			'HTTP development selection must be visible'
		);
		check(
			button('Retry').dataset.variant === 'brand',
			'A retryable state promotes Retry as its primary action'
		);
		owner.documentElement.dir = 'rtl';
		owner.documentElement.style.zoom = '2';
		await frameTick();
		check(
			owner.documentElement.scrollWidth <= owner.documentElement.clientWidth + 1,
			'Launch surface overflows at 200% zoom'
		);
		const scroller = launch.element.querySelector<HTMLElement>('.prctr-launch-window__page');
		check(scroller !== null, 'Launch scroll container is missing');
		const slider = launch.element.querySelector<HTMLElement>('.scrollbar.vertical > .slider');
		check(slider !== null, 'Launch must use the admitted VS Code scrollbar');
		check(
			view.getComputedStyle(scroller).overflowY === 'hidden' &&
				view.getComputedStyle(slider).borderRadius === '4px',
			'Launch must use the shared rounded scrollbar without a native scrollbar'
		);
		scroller.scrollTop = scroller.scrollHeight;
		await frameTick();
		await frameTick();
		check(scroller.scrollTop > 0, 'Long Launch state must remain vertically scrollable');
		const bottomPosition = slider.getBoundingClientRect().top;
		check(
			slider.getBoundingClientRect().height > 0 &&
				slider.getBoundingClientRect().height < scroller.getBoundingClientRect().height,
			'Scrollbar must measure the zoomed content and viewport'
		);
		check(
			button('Retry').getBoundingClientRect().bottom <= view.innerHeight + 1,
			'The footer action stays reachable at 200% zoom'
		);
		scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
		check(
			scroller.scrollTop === 0 && slider.getBoundingClientRect().top < bottomPosition,
			'Keyboard scrolling must move both the page and the thumb'
		);
		const previousTop = scroller.scrollHeight;
		scroller.scrollTop = previousTop;
		await frameTick();
		const scrolledTop = scroller.scrollTop;
		const wheel = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
		// Chromium's synthetic event leaves the legacy delta with the modern sign.
		// Match real wheel input, which supplies opposite signs for these two fields.
		Object.defineProperty(wheel, 'wheelDeltaY', { value: 120 });
		scroller.dispatchEvent(wheel);
		check(
			scroller.scrollTop < scrolledTop,
			`Wheel input must scroll the Launch page (${scrolledTop} -> ${scroller.scrollTop})`
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
		revision: 0,
		state: 'selectingServer',
		developmentOrigin: false,
		authorizationAvailable: false,
		canSignIn: false
	};
	const launch = await bootstrapLaunchWindow(owner, {
		bootstrap: async () => ({ kind: 'launch', windowId: 'launch-race' }),
		windowChrome: {
			configuration: async () => ({
				platform: 'win32',
				mode: 'nativeOverlay',
				controlsLocation: 'right',
				titlebarHeight: 35,
				fullscreen: false,
				material: 'none' as const
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
			signIn: async () => {},
			cancel: async () => {},
			reopenBrowser: async () => {}
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
