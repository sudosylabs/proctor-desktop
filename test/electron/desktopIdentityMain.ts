import { DesktopIdentityCoordinator } from '../../src/prctr/platform/identity/electron-main/desktopIdentityCoordinator.js';
import { HttpServerReadinessTransport } from '../../src/prctr/platform/identity/electron-main/httpServerReadinessTransport.js';
import {
	createDesktopAuthCallbackPages,
	callbackPageMessages
} from '../../src/prctr/workbench/node/desktopAuthCallbackPage.js';
import { createLocalization } from '../../src/prctr/base/common/localization.js';
import { acquireDesktopInstanceLock } from '../../src/prctr/platform/identity/electron-main/desktopInstanceLock.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadNativeDesktopKeyCustody } from '../../src/prctr/platform/identity/electron-main/nativeDesktopKeyCustody.js';
import { OsDesktopCredentialStore } from '../../src/prctr/platform/identity/electron-main/desktopCredentialStore.js';
import { DesktopAuthorizationService } from '../../src/prctr/platform/identity/electron-main/desktopAuthorizationService.js';
import { DesktopAuthHttp } from '../../src/prctr/platform/identity/node/desktopAuthHttp.js';
import {
	installationKeyScope,
	createDPoPProof
} from '../../src/prctr/platform/identity/node/desktopSigningKey.js';
import { CancellationToken } from '../../src/prctr/base/common/cancellation.js';
import { ProductWindowCoordinator } from '../../src/prctr/platform/windows/common/windowCoordinator.js';
import { ElectronProductWindowFactory } from '../../src/prctr/platform/windows/electron-main/electronProductWindowFactory.js';

const random = (): string => randomBytes(32).toString('base64url');
/** Its own identity, so the test never touches a development or installed application's keys. */
const applicationId = 'fr.sudosy.proctor.test';
const probe = process.argv[2] === '--probe-instance';
const stateDirectory = probe
	? process.argv[3]!
	: await mkdtemp(join(tmpdir(), 'proctor-identity-test-'));
// The coordinator owns closure; a secure replacement briefly has no window.
app.on('window-all-closed', () => {});
app.setPath('userData', stateDirectory);
const instanceLock = acquireDesktopInstanceLock(() => {});
if (probe) {
	process.stdout.write(JSON.stringify({ acquired: instanceLock !== undefined }));
	instanceLock?.dispose();
	app.exit(instanceLock ? 1 : 0);
} else {
	assert.ok(instanceLock);
	void app
		.whenReady()
		.then(async () => {
			const child = await promisify(execFile)(
				process.execPath,
				[resolve('.build/desktop-identity-tests'), '--probe-instance', stateDirectory],
				{ timeout: 15000 }
			);
			assert.deepEqual(JSON.parse(child.stdout), { acquired: false });
			const root = resolve('.build/desktop-development');
			const keys = loadNativeDesktopKeyCustody(join(root, 'desktop_key_custody.node'));
			const origin = 'https://identity-test.example';
			const institutionId = randomBytes(13).toString('hex');
			const scope = installationKeyScope(applicationId, origin, institutionId);
			const credentials = new OsDesktopCredentialStore(join(stateDirectory, 'credentials'));
			const principalId = 'a'.repeat(26),
				sessionId = 'b'.repeat(26),
				registrationId = 'c'.repeat(26);
			let started: Record<string, unknown>;
			let refreshToken = random();
			let browserOpens = 0;
			let service: DesktopAuthorizationService | undefined;
			let windows: ProductWindowCoordinator | undefined;
			let launch: DesktopIdentityCoordinator | undefined;
			try {
				const key = await keys.loadOrCreate(scope);
				assert.deepEqual((await keys.loadOrCreate(scope)).publicJwk, key.publicJwk);
				// createDPoPProof independently verifies the native signature against the public key.
				await createDPoPProof(key, 'POST', `${origin}/api/v1/auth/refresh`, random());
				const createWindows = (): ProductWindowCoordinator => {
					if (!service) throw new Error('Authorization service is not initialized');
					launch?.dispose();
					launch = new DesktopIdentityCoordinator({
						target: {
							release: '1.0.0',
							buildId: 'test',
							platform: process.platform,
							architecture: process.arch,
							realtimeProtocol: 1,
							authorizationProtocol: 1
						},
						transport: new HttpServerReadinessTransport(async () => {
							throw Error('Readiness network is outside this authentication fixture');
						}),
						allowDevelopmentLoopback: false,
						authorization: service
					});
					return new ProductWindowCoordinator(
						new ElectronProductWindowFactory({
							production: false,
							account: service,
							examActivity: service,
							settings: service,
							launchIdentity: launch,
							rendererByKind: {
								launch: join(root, 'launch.html'),
								authenticated: join(root, 'authenticated.html'),
								candidate: join(root, 'unavailable.html')
							},
							preloadByKind: {
								launch: join(root, 'launchPreload.cjs'),
								authenticated: join(root, 'authenticatedPreload.cjs'),
								candidate: join(root, 'unavailable.cjs')
							}
						}),
						{ accept: () => {} }
					);
				};
				const http = new DesktopAuthHttp(async (input, init) => {
					const path = new URL(String(input)).pathname;
					const response = (value: unknown, status = 200): Response =>
						new Response(JSON.stringify(value), {
							status,
							headers: { 'Content-Type': 'application/json', 'DPoP-Nonce': random() }
						});
					if (path.endsWith('/authorizations')) {
						started = JSON.parse(String(init?.body));
						return response(
							{
								authorization_url: `${origin}/authorize`,
								expires_at: new Date(Date.now() + 60000).toISOString()
							},
							201
						);
					}
					if (path.endsWith('/token') || path.endsWith('/refresh')) {
						if (path.endsWith('/token')) {
							const body = JSON.parse(String(init?.body));
							assert.equal(
								createHash('sha256').update(body.code_verifier).digest('base64url'),
								started.code_challenge
							);
						}
						refreshToken = random();
						return response({
							session: {
								id: sessionId,
								user_id: principalId,
								desktop_registration_id: registrationId,
								client_type: 'desktop',
								mfa_recovery_required: false
							},
							tokens: {
								token_type: 'DPoP',
								access_token: random(),
								refresh_token: refreshToken,
								access_expires_at: new Date(Date.now() + 300000).toISOString(),
								refresh_expires_at: new Date(Date.now() + 3600000).toISOString()
							}
						});
					}
					if (path.endsWith('/context'))
						return response({
							user: {
								id: principalId,
								username: 'identity-test',
								profile_picture_reference: '',
								display_name: 'Identity Test',
								locale: 'en',
								timezone: 'UTC'
							},
							unresolved_attempt: null,
							session_management_available: true,
							current_desktop_registration_id: registrationId,
							available_product_areas: ['account', 'settings'],
							no_current_affiliation: true,
							no_assigned_access: true,
							management_scopes: [],
							management_scopes_has_more: false
						});
					if (path === '/api/v1/users/me/exam-activity') {
						assert.equal(new URL(String(input)).search, '?limit=20');
						assert.equal(init?.method, 'GET');
						const headers = new Headers(init?.headers);
						assert.ok(headers.get('Authorization')?.startsWith('DPoP '));
						assert.ok(headers.get('DPoP'));
						return response({ server_time: '2026-09-11T08:00:00Z', items: [] });
					}
					if (path === '/api/v1/users/me')
						return response({
							id: principalId,
							username: 'identity-test',
							display_name: 'Identity Test',
							first_name: 'Identity',
							last_name: 'Test',
							created_at: '1970-01-01T00:00:00Z',
							updated_at: '1970-01-01T00:00:00Z',
							profile_picture_url: ''
						});
					if (path === '/api/v1/users/me/settings')
						return response({
							source: '{}',
							revision: 'b'.repeat(26),
							format_version: 1,
							updated_at: '1970-01-01T00:00:00Z',
							writable: true
						});
					if (path === '/api/v1/authentication-methods')
						return response({ password: true, providers: [] });
					if (path === '/api/v1/users/me/mfa')
						return response(
							{
								type: 'about:blank',
								title: 'Not found',
								status: 404,
								code: 'resource.not_found'
							},
							404
						);
					if (path.endsWith('/profile-picture'))
						return response(
							{
								type: 'about:blank',
								title: 'Not found',
								status: 404,
								code: 'resource.not_found'
							},
							404
						);
					if (path.endsWith('/logout')) return new Response(null, { status: 204 });
					throw new Error('Unexpected test route');
				});
				const createService = () =>
					new DesktopAuthorizationService({
						applicationId,
						target: {
							release: '1.0.0',
							buildId: 'test',
							platform: process.platform,
							architecture: process.arch,
							realtimeProtocol: 1,
							authorizationProtocol: 1
						},
						keys,
						credentials,
						http,
						callbackPages: createDesktopAuthCallbackPages(
							createLocalization({
								requestedLocale: 'en',
								messages: Object.values(callbackPageMessages)
							}),
							join(root, 'branding')
						),
						confirmationPages: createDesktopAuthCallbackPages(
							createLocalization({
								requestedLocale: 'en',
								messages: Object.values(callbackPageMessages)
							}),
							join(root, 'branding'),
							'dark',
							'confirm'
						),
						async openBrowser() {
							browserOpens++;
							const callback = new URL(String(started.callback_url));
							callback.searchParams.set('state', String(started.state));
							callback.searchParams.set('code', random());
							assert.equal((await fetch(callback)).status, 200);
						},
						async onAuthenticated(identity) {
							windows!.completeSignIn({
								kind: 'authenticated',
								windowId: 'identity-test-account',
								principalId,
								sessionId,
								institutionOrigin: origin,
								initialDestination: 'account',
								identity
							});
						}
					});
				service = createService();
				windows = createWindows();
				windows.openInitial({
					kind: 'launch',
					windowId: 'identity-test-launch'
				});
				await service.start(
					{
						origin,
						institutionId,
						institutionName: 'Test Institution',
						installationId: 'test-installation',
						developmentOrigin: false
					},
					CancellationToken.None
				);
				assert.equal(windows.current?.kind, 'authenticated');
				const window = BrowserWindow.getAllWindows()[0]!;
				if (window.webContents.isLoading())
					await new Promise<void>((resolve) =>
						window.webContents.once('did-finish-load', () => resolve())
					);
				await new Promise<void>((resolve, reject) => {
					const deadline = Date.now() + 10000;
					const check = async (): Promise<void> => {
						const text: string =
							await window.webContents.executeJavaScript('document.body.innerText');
						if (text.includes('Identity Test') && text.includes('Profile')) resolve();
						else if (Date.now() > deadline)
							reject(new Error('Authenticated view did not mount'));
						else
							setTimeout(() => {
								void check().catch(reject);
							}, 50);
					};
					void check().catch(reject);
				});
				assert.deepEqual(
					await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
     const timer = setTimeout(() => reject(new Error('Observation did not publish')), 5000);
     const subscription = globalThis.proctorAuthenticated.examActivity.observe({kind:'activity'}, response => {
      clearTimeout(timer); subscription.dispose(); resolve(response);
     });
    })`),
					{ kind: 'activity', serverTime: '2026-09-11T08:00:00Z', items: [] }
				);
				assert.equal(
					await window.webContents.executeJavaScript('typeof process'),
					'undefined'
				);
				assert.deepEqual(
					await window.webContents.executeJavaScript(
						"globalThis.proctorAuthenticated.examActivity.request({kind:'activity'})"
					),
					{ kind: 'activity', serverTime: '2026-09-11T08:00:00Z', items: [] }
				);
				assert.equal(
					(
						await service.examActivity(
							{ principalId: 'b'.repeat(26), sessionId },
							{ kind: 'context' }
						)
					).kind,
					'error'
				);
				assert.equal((await credentials.read(scope))?.refreshToken, refreshToken);
				const file = (await readdir(join(stateDirectory, 'credentials')))[0]!;
				assert.equal(
					(await readFile(join(stateDirectory, 'credentials', file))).includes(
						Buffer.from(refreshToken)
					),
					false
				);
				service.dispose();
				windows.shutdown();
				service = createService();
				windows = createWindows();
				windows.openInitial({
					kind: 'launch',
					windowId: 'identity-test-relaunch'
				});
				await service.start(
					{
						origin,
						institutionId,
						institutionName: 'Test Institution',
						installationId: 'test-installation',
						developmentOrigin: false
					},
					CancellationToken.None
				);
				assert.equal(browserOpens, 1);
				await service.refresh();
				await service.signOut();
				assert.deepEqual(
					await service.examActivity({ principalId, sessionId }, { kind: 'activity' }),
					{ kind: 'error', reason: 'sessionEnded' }
				);
				assert.equal(await credentials.read(scope), undefined);
				windows.returnToLaunch('identity-test-signed-out');
				assert.equal(windows.current?.kind, 'launch');
				console.log(
					JSON.stringify({
						exclusiveCustody: true,
						nativeSignature: true,
						persistentKey: true,
						encryptedRefresh: true,
						authenticatedHandoff: true,
						signedOut: true
					})
				);
			} catch (error) {
				console.error(
					'Desktop identity conformance failed.',
					error instanceof Error ? error.stack : String(error)
				);
				process.exitCode = 1;
			} finally {
				service?.dispose();
				windows?.shutdown();
				launch?.dispose();
				await keys.delete(scope);
				// The credentials always go; on Windows Chromium keeps its profile databases
				// in this folder open until the process exits, so the rest may stay in temp.
				await rm(join(stateDirectory, 'credentials'), { recursive: true, force: true });
				await rm(stateDirectory, { recursive: true, force: true }).catch(
					(error: unknown) => {
						if (
							process.platform !== 'win32' ||
							(error as NodeJS.ErrnoException).code !== 'EBUSY'
						)
							throw error;
					}
				);
				instanceLock.dispose();
				app.exit(Number(process.exitCode ?? 0));
			}
		})
		.catch((error: unknown) => {
			console.error(
				'Identity test startup failed.',
				error instanceof Error ? error.stack : String(error)
			);
			app.exit(1);
		});
}
