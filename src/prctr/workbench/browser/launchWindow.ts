/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../base/browser/dom.js';
import { createLocalization, defineMessage } from '../../base/common/localization.js';
import { DisposableStore } from '../../base/common/lifecycle.js';
import { BrowserThemeService } from '../../platform/theme/browser/themeService.js';
import type { LaunchWindowDescriptor } from '../../platform/windows/common/windowProtocol.js';
import { prepareWorkbenchDocument } from './documentLayout.js';
import { createStartupSurface } from './startupSurface.js';
import './launchWindow.css';

export interface LaunchRendererClient {
	bootstrap(): Promise<LaunchWindowDescriptor>;
	changeServer(): Promise<void>;
	signIn(): Promise<void>;
	exit(): Promise<void>;
}
export interface LaunchWindowResult {
	readonly element: HTMLElement;
	readonly disposables: DisposableStore;
}

const messages = Object.freeze({
	title: defineMessage({
		id: 'launch.title',
		defaultMessage: 'Proctor',
		description: 'Heading for the signed-out Proctor launch surface.'
	}),
	ready: defineMessage({
		id: 'launch.institution.ready',
		defaultMessage: 'Ready to connect to {institution}',
		description: 'Status shown when an Institution origin is configured.'
	}),
	unavailable: defineMessage({
		id: 'launch.institution.unavailable',
		defaultMessage: 'Choose your Institution server to continue.',
		description: 'Status shown before an Institution origin is configured.'
	}),
	signIn: defineMessage({
		id: 'launch.action.sign.in',
		defaultMessage: 'Sign in',
		description: 'Action that starts system-browser authentication.'
	}),
	changeServer: defineMessage({
		id: 'launch.action.change.server',
		defaultMessage: 'Change server',
		description: 'Action that changes the configured Proctor Server.'
	}),
	exit: defineMessage({
		id: 'launch.action.exit',
		defaultMessage: 'Exit Proctor',
		description: 'Action that exits Proctor from the launch surface.'
	}),
	failed: defineMessage({
		id: 'launch.action.failed',
		defaultMessage: 'The requested action could not be completed.',
		description: 'Safe failure shown for a launch action.'
	}),
	recovery: defineMessage({
		id: 'launch.startup.recovery',
		defaultMessage: 'Proctor could not start the launch window safely.',
		description: 'Minimal LaunchWindow startup recovery message.'
	})
});

export async function bootstrapLaunchWindow(
	document: Document,
	client: LaunchRendererClient
): Promise<LaunchWindowResult> {
	const disposables = new DisposableStore();
	const presentation = new DisposableStore();
	let themeService: BrowserThemeService | undefined;
	const ensureTheme = (): BrowserThemeService =>
		(themeService ??= presentation.add(
			new BrowserThemeService(
				document,
				'light',
				{ density: 'default', motion: 'full', transparency: 'full' },
				{ followSystemColorScheme: true }
			)
		));
	try {
		prepareWorkbenchDocument(document);
		const localization = createLocalization({
			requestedLocale: document.documentElement.lang || 'en',
			messages: Object.values(messages),
			catalogs: []
		});
		document.documentElement.lang = localization.locale;
		document.documentElement.dir = localization.direction;
		ensureTheme();
		const descriptor = await client.bootstrap();
		if (descriptor.kind !== 'launch')
			throw new Error('Launch renderer received a non-launch descriptor');
		const root = document.createElement('main');
		root.className = 'prctr-launch-window';
		const heading = document.createElement('h1');
		heading.textContent = localization.format(messages.title);
		const status = document.createElement('p');
		status.setAttribute('role', 'status');
		status.textContent =
			descriptor.institutionOrigin === undefined
				? localization.format(messages.unavailable)
				: localization.format(messages.ready, {
						institution: descriptor.institutionOrigin
					});
		const actions = document.createElement('div');
		actions.className = 'prctr-launch-window__actions';
		const signIn = button(document, localization.format(messages.signIn));
		signIn.disabled = descriptor.institutionOrigin === undefined;
		const changeServer = button(document, localization.format(messages.changeServer));
		const exit = button(document, localization.format(messages.exit));
		actions.append(signIn, changeServer, exit);
		root.append(heading, status, actions);
		document.body.replaceChildren(root);
		disposables.add({ dispose: () => root.remove() });
		const request = async (operation: () => Promise<void>): Promise<void> => {
			for (const action of [signIn, changeServer, exit]) action.disabled = true;
			try {
				await operation();
			} catch {
				status.textContent = localization.format(messages.failed);
			} finally {
				signIn.disabled = descriptor.institutionOrigin === undefined;
				changeServer.disabled = false;
				exit.disabled = false;
			}
		};
		disposables.add(
			addDisposableListener(signIn, 'click', () => {
				void request(() => client.signIn());
			})
		);
		disposables.add(
			addDisposableListener(changeServer, 'click', () => {
				void request(() => client.changeServer());
			})
		);
		disposables.add(
			addDisposableListener(exit, 'click', () => {
				void request(() => client.exit());
			})
		);
		disposables.add(presentation);
		return Object.freeze({ element: root, disposables });
	} catch (error) {
		disposables.dispose();
		ensureTheme();
		document.body.replaceChildren();
		const localization = createLocalization({
			requestedLocale: document.documentElement.lang || 'en',
			messages: Object.values(messages),
			catalogs: []
		});
		document.body.append(
			createStartupSurface(document, 'launchRecovery', localization.format(messages.recovery))
		);
		throw error;
	}
}

function button(document: Document, label: string): HTMLButtonElement {
	const value = document.createElement('button');
	value.type = 'button';
	value.textContent = label;
	return value;
}
