import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { app, BrowserWindow, Menu, MenuItem, nativeTheme } from 'electron';
import { DesktopIdentityCoordinator } from '../../src/prctr/platform/identity/electron-main/desktopIdentityCoordinator.js';
import { ElectronProductWindowFactory } from '../../src/prctr/platform/windows/electron-main/electronProductWindowFactory.js';
import type { ServerReadinessProbe } from '../../src/prctr/platform/identity/electron-main/serverReadiness.js';

// Development-only preview. The production renderer and native chrome use an in-memory server seam.
app.setName('Proctor Preview');
let availability = 'ready';
let compatibility = 'compatible';
let reachable = true;
let institutionName = 'Northbridge University';
const origin = 'https://exams.northbridge.example';
void app
	.whenReady()
	.then(async () => {
		const root = app.getAppPath();
		nativeTheme.themeSource = 'dark';
		const identity = new DesktopIdentityCoordinator({
			target: {
				release: '1.0.0',
				buildId: 'preview',
				platform: process.platform,
				architecture: process.arch,
				realtimeProtocol: 1,
				authorizationProtocol: 1
			},
			allowDevelopmentLoopback: true,
			transport: {
				probe: async (selectedOrigin): Promise<ServerReadinessProbe> => {
					await new Promise((resolve) => setTimeout(resolve, 500));
					if (!reachable)
						return {
							system: { ok: false, reason: 'unreachable' },
							discovery: { ok: false, reason: 'unreachable' }
						};
					return {
						system: {
							ok: true,
							value: {
								schema_version: 1,
								server_time: '2026-09-08T12:00:00Z',
								availability,
								reason: availability,
								compatibility,
								compatibility_reason:
									compatibility === 'compatible'
										? 'compatible'
										: 'release_too_old',
								...(availability === 'maintenance'
									? {
											administrator_message:
												'Scheduled maintenance. Please try again later.'
										}
									: {})
							}
						},
						discovery: {
							ok: true,
							value: {
								discovery_version: 1,
								canonical_origin: selectedOrigin,
								installation_id: 'preview-installation',
								initialized: true,
								institution: {
									id: 'preview-institution',
									name: 'Northbridge',
									display_name: institutionName
								},
								capabilities: { desktop_authorization: true },
								desktop_authorization: {
									protocol: 'proctor-desktop-authorization',
									minimum_version: 1,
									maximum_version: 1
								}
							}
						}
					};
				}
			},
			authorization: {
				start: async (_identity, token) =>
					new Promise<void>((resolve) => {
						const subscription = token.onCancellationRequested(() => {
							subscription.dispose();
							resolve();
						});
					})
			}
		});
		const renderer = join(root, 'launch.html');
		const factory = new ElectronProductWindowFactory({
			production: false,
			launchIdentity: identity,
			rendererByKind: { launch: renderer, authenticated: renderer, candidate: renderer },
			preloadByKind: {
				launch: join(root, 'launchPreload.cjs'),
				authenticated: join(root, 'authenticatedPreload.cjs'),
				candidate: join(root, 'candidatePreload.cjs')
			}
		});
		const managed = factory.create(
			{ kind: 'launch', windowId: 'launch-preview' },
			() => app.quit(),
			() => app.quit()
		);
		app.on('before-quit', () => {
			managed.destroy();
			identity.dispose();
		});
		await identity.handleIntent({ kind: 'selectServer', address: origin });
		const window = BrowserWindow.getAllWindows()[0]!;
		const showState = async (state: string): Promise<void> => {
			await identity.handleIntent({ kind: 'changeServer' });
			availability = state === 'maintenance' ? 'maintenance' : 'ready';
			compatibility = state === 'update' ? 'update_required' : 'compatible';
			reachable = state !== 'unreachable';
			institutionName =
				state === 'long'
					? 'Northbridge University — School of Engineering and Applied Computer Science'
					: 'Northbridge University';
			if (state !== 'selecting')
				await identity.handleIntent({ kind: 'selectServer', address: origin });
		};
		const menu = Menu.getApplicationMenu() ?? Menu.buildFromTemplate([]);
		menu.append(
			new MenuItem({
				label: 'Preview',
				submenu: [
					{ label: 'Sample data — no browser sign-in', enabled: false },
					{ type: 'separator' },
					...[
						['Ready', 'ready'],
						['Choose server', 'selecting'],
						['Maintenance', 'maintenance'],
						['Connection failure', 'unreachable'],
						['Update required', 'update'],
						['Long institution name', 'long']
					].map(([label, state]) => ({
						label: label!,
						click: () => {
							void showState(state!);
						}
					})),
					{ type: 'separator' },
					{
						label: 'Light',
						click: () => {
							nativeTheme.themeSource = 'light';
						}
					},
					{
						label: 'Dark',
						click: () => {
							nativeTheme.themeSource = 'dark';
						}
					},
					{
						label: 'System theme',
						click: () => {
							nativeTheme.themeSource = 'system';
						}
					},
					{
						label: 'Actual size',
						click: () => {
							window.webContents.setZoomFactor(1);
						}
					},
					{
						label: '200% zoom',
						click: () => {
							window.webContents.setZoomFactor(2);
						}
					}
				]
			})
		);
		if (process.platform === 'darwin') Menu.setApplicationMenu(menu);
		else window.setMenu(menu);
		managed.show();
		setTimeout(() => {
			if (!window.isDestroyed())
				void window.webContents.capturePage().then((image) => {
					writeFileSync(join(root, 'launch-preview.png'), image.toPNG());
					process.stdout.write(
						'Launch preview ready. Use the Preview menu to switch states and themes.\n'
					);
				});
		}, 1000);
	})
	.catch((error) => {
		console.error(error);
		app.exit(1);
	});
