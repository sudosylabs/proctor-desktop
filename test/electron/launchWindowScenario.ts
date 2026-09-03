import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import { createLaunchWindowComposition } from '../../src/prctr/code/electron-main/launchWindowComposition.js';

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
					if (document.querySelector('main')?.dataset.state === ${JSON.stringify(state)}) return;
					await new Promise(resolve => setTimeout(resolve, 20));
				}
				throw new Error('Launch UI state did not settle');
			})()`);
		};
		await waitForState('selectingServer');
		await contents.executeJavaScript(
			`document.querySelector('input').value = ${JSON.stringify(serverOrigin)}; document.querySelector('form').requestSubmit();`
		);
		await waitForState('ready');
		const presentation = (await contents.executeJavaScript(`({
			text: document.body.textContent,
			canSignIn: !document.querySelector('.prctr-launch-window__actions button').disabled,
			focusedRole: document.activeElement?.getAttribute('role'),
			hasNode: 'process' in globalThis || 'require' in globalThis
		})`)) as { text: string; canSignIn: boolean; hasNode: boolean; focusedRole: string };
		assert.ok(presentation.text.includes('Example University'));
		assert.ok(presentation.text.includes('Development server'));
		assert.ok(presentation.text.includes('Sign-in is not available in this build.'));
		assert.ok(!presentation.text.includes('Provider must stay private'));
		assert.equal(presentation.canSignIn, false);
		assert.equal(presentation.hasNode, false);
		assert.equal(presentation.focusedRole, 'status');
		assert.equal(
			await contents.executeJavaScript(
				"getComputedStyle(document.querySelector('form')).display"
			),
			'none'
		);
		assert.equal(requests.length, 2);
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
		await contents.executeJavaScript(
			"Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Retry').click()"
		);
		await waitForState('maintenance');
		assert.equal(requests.length, 4);
		writeFileSync(join(root, 'launch-maintenance.png'), (await contents.capturePage()).toPNG());
		await contents.executeJavaScript(
			"Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Change server').click()"
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
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
	}
}
