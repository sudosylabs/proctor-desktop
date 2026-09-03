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
	let released = false;
	let selected = '';
	let exits = 0;
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
		identity,
		exit: async () => {
			exits++;
		}
	});
	try {
		const brand = owner.querySelector<HTMLElement>('.prctr-brand-lockup');
		check(
			brand?.getAttribute('aria-hidden') === 'true' &&
				brand.querySelector('img')?.alt === '' &&
				owner.querySelector('h1')?.textContent === 'Connect to your Institution',
			'Launch branding must remain decorative beside a task-oriented heading'
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
			!action('Change server').disabled && !action('Exit Proctor').disabled,
			'Cancellation and exit must remain available'
		);
		action('Exit Proctor').click();
		await tick();
		check(exits === 1, 'Exit blocked behind pending check');
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
			action('Sign in to <img src=x onerror=alert(1)>').disabled,
			'Unavailable auth owner must keep sign-in disabled'
		);
		check(
			owner.body.textContent?.includes('Sign-in is not available in this build.'),
			'Unwired auth must be explained'
		);
		listener?.(stale);
		check(
			launch.element.dataset.state === 'ready',
			'Stale projection replaced current readiness'
		);
		for (const state of launchStates) {
			publish(
				state,
				state === 'selectingServer' || state === 'invalidServer'
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
		owner.documentElement.dir = 'rtl';
		owner.documentElement.style.zoom = '2';
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		check(
			owner.documentElement.scrollWidth <= owner.documentElement.clientWidth + 1,
			'Launch surface overflows at narrow width and 200% zoom'
		);
		launch.element.scrollTop = launch.element.scrollHeight;
		check(launch.element.scrollTop > 0, 'Long Launch state must remain vertically scrollable');
		check(
			action('Exit Proctor').getBoundingClientRect().bottom <=
				launch.element.getBoundingClientRect().bottom,
			'Exit cannot be reached at 200% zoom'
		);
	} finally {
		launch.disposables.dispose();
		check(
			released && owner.body.querySelector('main') === null,
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
