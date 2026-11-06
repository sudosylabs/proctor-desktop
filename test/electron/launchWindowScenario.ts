import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { BrowserWindow, nativeTheme, type WebContents } from 'electron';
import { createLaunchWindowComposition } from '../../src/prctr/code/electron-main/launchWindowComposition.js';
import { Color } from '../../src/prctr/base/common/color.js';
import { getTheme } from '../../src/prctr/platform/theme/common/themes.js';

export async function verifyLaunchWindowScenario(root: string): Promise<void> {
	let serverOrigin = '';
	let availability = 'ready';
	const requests: URL[] = [];
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', serverOrigin);
		requests.push(url);
		assert.equal(request.headers.authorization, undefined);
		assert.equal(request.headers.cookie, undefined);
		response.setHeader('Content-Type', 'application/json');
		response.setHeader('Cache-Control', 'no-store');
		if (url.pathname === '/api/v1/system/ping')
			response.end(
				JSON.stringify({
					schema_version: 1,
					server_time: new Date().toISOString(),
					availability,
					reason: availability,
					compatibility: 'compatible',
					compatibility_reason: 'compatible',
					...(availability === 'maintenance'
						? {
								administrator_message:
									'Scheduled maintenance. Please try again later.'
							}
						: {})
				})
			);
		else if (url.pathname === '/api/v1/discovery')
			response.end(
				JSON.stringify({
					discovery_version: 1,
					canonical_origin: serverOrigin,
					initialized: true,
					installation_id: 'institution-1',
					institution: {
						id: 'institution-1',
						name: 'Example University',
						display_name: 'Example University'
					},
					capabilities: { desktop_authorization: true },
					providers: [{ name: 'Provider must stay private to the server page' }],
					desktop_authorization: {
						protocol: 'proctor-desktop-authorization',
						minimum_version: 1,
						maximum_version: 1
					}
				})
			);
		else {
			response.statusCode = 404;
			response.end('{}');
		}
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	serverOrigin = 'http://127.0.0.1:' + address.port;
	let composition: ReturnType<typeof createLaunchWindowComposition> | undefined;
	const previousTheme = nativeTheme.themeSource;
	try {
		const html = join(root, 'launch.html');
		const preloads = {
			launch: join(root, 'launchPreload.cjs'),
			authenticated: join(root, 'authenticatedPreload.cjs'),
			candidate: join(root, 'candidatePreload.cjs')
		};
		const window = {
			production: false,
			rendererByKind: { launch: html, authenticated: html, candidate: html },
			preloadByKind: preloads
		};
		assert.throws(() =>
			createLaunchWindowComposition({
				window: { ...window, production: true },
				windowId: 'launch-production',
				target: {
					release: '1.2.3',
					buildId: 'test-build',
					platform: 'darwin',
					architecture: 'arm64',
					realtimeProtocol: 1,
					authorizationProtocol: 1
				},
				allowDevelopmentLoopback: true,
				onExit() {}
			})
		);
		nativeTheme.themeSource = 'light';
		composition = createLaunchWindowComposition({
			window,
			windowId: 'launch-readiness',
			target: {
				release: '1.2.3',
				buildId: 'test-build',
				platform: 'darwin',
				architecture: 'arm64',
				realtimeProtocol: 1,
				authorizationProtocol: 1
			},
			allowDevelopmentLoopback: true,
			onExit() {}
		});
		const contents = BrowserWindow.getAllWindows()[0]!.webContents;
		if (contents.isLoading()) await once(contents, 'did-finish-load');
		const waitForState = async (state: string): Promise<void> => {
			await contents.executeJavaScript(`(async () => {
				for (let count = 0; count < 100; count++) {
					if (document.querySelector('.prctr-launch-window')?.dataset.state === ${JSON.stringify(state)}) return;
					await new Promise(resolve => setTimeout(resolve, 20));
				}
				throw new Error('Launch UI state did not settle at ${state}; current state: ' + (document.querySelector('.prctr-launch-window')?.dataset.state ?? 'missing'));
			})()`);
		};
		await waitForState('selectingServer');
		// LaunchWindow releases any pinned scheme and follows the operating system.
		assert.equal(nativeTheme.themeSource, 'system');
		assert.ok(
			['light', 'dark'].includes(
				await contents.executeJavaScript('document.documentElement.dataset.prctrTheme')
			)
		);
		await contents.executeJavaScript(
			`document.querySelector('input').value = ${JSON.stringify(serverOrigin)}; document.querySelector('form').requestSubmit();`
		);
		await waitForState('ready');
		await verifyWindowChromeGeometry(contents);
		const presentation = (await contents.executeJavaScript(`({
			text: document.body.textContent,
			canSignIn: !document.querySelector('.prctr-launch-actions__primary').disabled,
			focusedRole: document.activeElement?.getAttribute('role'),
			hasNode: 'process' in globalThis || 'require' in globalThis
		})`)) as { text: string; canSignIn: boolean; hasNode: boolean; focusedRole: string | null };
		assert.ok(presentation.text.includes('Example University'));
		assert.ok(presentation.text.includes('Development server'));
		assert.ok(presentation.text.includes('Sign-in isn’t available in this build'));
		assert.ok(!presentation.text.includes('Provider must stay private'));
		// The confirmed Institution is shown with the address it was checked at.
		assert.ok(presentation.text.includes(new URL(serverOrigin).origin));
		assert.equal(presentation.canSignIn, false);
		assert.equal(presentation.hasNode, false);
		assert.equal(presentation.focusedRole, null);
		assert.equal(
			await contents.executeJavaScript(
				"getComputedStyle(document.querySelector('form')).display"
			),
			'none'
		);
		assert.equal(requests.length, 2);
		// Exercise the production theme owner against Chromium's real media-query changes.
		contents.debugger.attach('1.3');
		try {
			for (const scheme of ['light', 'dark']) {
				for (const contrast of ['none', 'active']) {
					await contents.debugger.sendCommand('Emulation.setEmulatedMedia', {
						features: [
							{ name: 'prefers-color-scheme', value: scheme },
							{ name: 'forced-colors', value: contrast },
							{ name: 'prefers-reduced-motion', value: 'reduce' }
						]
					});
					const state =
						await contents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
						const root = document.querySelector('.prctr-launch-window');
						resolve({ theme: document.documentElement.dataset.prctrTheme, forced: document.documentElement.dataset.prctrForcedColors, motion: document.documentElement.dataset.prctrMotion, uniform: getComputedStyle(root).backgroundColor === getComputedStyle(root.firstElementChild).backgroundColor, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth });
					})))`);
					assert.equal(state.theme, scheme);
					assert.equal(state.forced, contrast);
					assert.equal(state.motion, 'reduced');
					assert.equal(state.uniform, true);
					assert.equal(state.overflow, false);
				}
			}
		} finally {
			await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
			contents.debugger.detach();
		}
		assert.deepEqual(
			Object.fromEntries(
				requests.find((value) => value.pathname.endsWith('/ping'))!.searchParams
			),
			{
				desktop_release: '1.2.3',
				desktop_build_id: 'test-build',
				platform: 'darwin',
				architecture: 'arm64',
				realtime_protocol: '1'
			}
		);
		availability = 'maintenance';
		await contents.executeJavaScript('globalThis.proctorLaunch.identity.retry()');
		await waitForState('maintenance');
		assert.equal(requests.length, 4);
		await verifyPrimaryButtonInteractionColors(contents);
		writeFileSync(join(root, 'launch-maintenance.png'), (await contents.capturePage()).toPNG());
		await contents.executeJavaScript(
			"Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Change').click()"
		);
		await waitForState('selectingServer');
		assert.equal(
			await contents.executeJavaScript(
				"document.activeElement === document.querySelector('input')"
			),
			true
		);
	} finally {
		composition?.dispose();
		nativeTheme.themeSource = previousTheme;
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
	}
}

async function verifyPrimaryButtonInteractionColors(contents: WebContents): Promise<void> {
	contents.debugger.attach('1.3');
	try {
		await contents.debugger.sendCommand('DOM.enable');
		await contents.debugger.sendCommand('CSS.enable');
		const { root } = await contents.debugger.sendCommand('DOM.getDocument');
		const { nodeId } = await contents.debugger.sendCommand('DOM.querySelector', {
			nodeId: root.nodeId,
			selector: '.prctr-launch-actions__primary:not([hidden])'
		});
		assert.ok(nodeId > 0, 'A retryable state must have a visible primary action');
		for (const scheme of ['light', 'dark'] as const) {
			await contents.debugger.sendCommand('Emulation.setEmulatedMedia', {
				features: [{ name: 'prefers-color-scheme', value: scheme }]
			});
			for (const state of [
				{ pseudo: [], token: 'color.brand.accent' },
				{ pseudo: ['hover'], token: 'color.brand.accentHover' },
				{ pseudo: ['hover', 'active'], token: 'color.brand.accentHover' }
			] as const) {
				await contents.debugger.sendCommand('CSS.forcePseudoState', {
					nodeId,
					forcedPseudoClasses: state.pseudo
				});
				const colors =
					await contents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
					const button = document.querySelector('.prctr-launch-actions__primary:not([hidden])');
					const style = getComputedStyle(button);
					resolve({ background: style.backgroundColor, border: style.borderTopColor, foreground: style.color });
				})))`);
				const theme = getTheme(scheme);
				const expected = Color.Format.CSS.parseHex(theme.values[state.token])!;
				assert.ok(
					Color.Format.CSS.parse(colors.background)?.equals(expected),
					`${scheme} ${state.token} must retain its accent background`
				);
				assert.ok(
					Color.Format.CSS.parse(colors.border)?.equals(expected),
					`${scheme} ${state.token} border must follow its background`
				);
				assert.ok(
					Color.Format.CSS.parse(colors.foreground)?.equals(
						Color.Format.CSS.parseHex(theme.values['color.brand.onAccent'])!
					),
					`${scheme} primary action must retain readable text`
				);
			}
		}
		await contents.debugger.sendCommand('CSS.forcePseudoState', {
			nodeId,
			forcedPseudoClasses: []
		});
	} finally {
		await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
		contents.debugger.detach();
	}
}

async function verifyWindowChromeGeometry(contents: WebContents): Promise<void> {
	const expectedPlatform =
		process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux';
	const geometry = (await contents.executeJavaScript(`(() => {
		const chrome = document.querySelector('.prctr-product-window-chrome');
		const inset = chrome?.querySelector('.prctr-product-window-chrome__controls-inset');
		if (!(chrome instanceof HTMLElement) || !(inset instanceof HTMLElement)) throw new Error('Product window chrome geometry is unavailable');
		const chromeBounds = chrome.getBoundingClientRect();
		const insetBounds = inset.getBoundingClientRect();
		return {
			platform: chrome.dataset.chromePlatform,
			mode: chrome.dataset.chromeMode,
			location: chrome.dataset.controlsLocation,
			insetWidth: insetBounds.width,
			leftGap: Math.abs(insetBounds.left - chromeBounds.left),
			rightGap: Math.abs(insetBounds.right - chromeBounds.right),
			overflow: chrome.scrollWidth > chrome.clientWidth
		};
	})()`)) as {
		platform: string;
		mode: string;
		location: string;
		insetWidth: number;
		leftGap: number;
		rightGap: number;
		overflow: boolean;
	};
	assert.equal(geometry.platform, expectedPlatform);
	assert.equal(
		geometry.mode,
		expectedPlatform === 'darwin' ? 'nativeTrafficLights' : 'nativeOverlay'
	);
	assert.equal(geometry.overflow, false);
	assert.ok((geometry.location === 'left' ? geometry.leftGap : geometry.rightGap) <= 1);
	if (expectedPlatform === 'darwin') assert.ok(Math.abs(geometry.insetWidth - 70) <= 1);
	if (expectedPlatform === 'win32') {
		assert.ok(Math.abs(geometry.insetWidth - 138) <= 1);
		contents.setZoomFactor(2);
		const zoomed = (await contents.executeJavaScript(`new Promise(resolve => {
			requestAnimationFrame(() => requestAnimationFrame(() => {
				const chrome = document.querySelector('.prctr-product-window-chrome');
				const inset = chrome.querySelector('.prctr-product-window-chrome__controls-inset');
				resolve({
					zoom: getComputedStyle(chrome).getPropertyValue('--prctr-product-window-zoom-factor').trim(),
					width: inset.getBoundingClientRect().width
				});
			}));
		})`)) as { zoom: string; width: number };
		assert.equal(zoomed.zoom, '2');
		assert.ok(Math.abs(zoomed.width - 69) <= 1);
		contents.setZoomFactor(1);
		await contents.executeJavaScript(
			'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
		);
	}
}
