/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../base/browser/dom.js';
import { ButtonControl } from '../../base/browser/ui/button/button.js';
import { TextFieldControl } from '../../base/browser/ui/field/textField.js';
import { createLocalization } from '../../base/common/localization.js';
import { DisposableStore } from '../../base/common/lifecycle.js';
import {
	validateLaunchIdentityProjection,
	type LaunchIdentityClient,
	type LaunchIdentityProjection
} from '../../platform/identity/common/launchIdentity.js';
import { BrowserThemeService } from '../../platform/theme/browser/themeService.js';
import type { LaunchWindowDescriptor } from '../../platform/windows/common/windowProtocol.js';
import { prepareWorkbenchDocument } from './documentLayout.js';
import { BrandLockup, brandLockupAppearance } from './brandLockup.js';
import { launchMessages as messages } from './launchWindowMessages.js';
import { createStartupSurface } from './startupSurface.js';
import './launchWindow.css';

export interface LaunchRendererClient {
	bootstrap(): Promise<LaunchWindowDescriptor>;
	readonly identity: LaunchIdentityClient;
	exit(): Promise<void>;
}
export interface LaunchWindowResult {
	readonly element: HTMLElement;
	readonly disposables: DisposableStore;
}

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
	const localization = createLocalization({
		requestedLocale: document.documentElement.lang || 'en',
		messages: Object.values(messages),
		catalogs: []
	});
	try {
		prepareWorkbenchDocument(document);
		document.documentElement.lang = localization.locale;
		document.documentElement.dir = localization.direction;
		const activeTheme = ensureTheme();
		const descriptor = await client.bootstrap();
		if (descriptor.kind !== 'launch')
			throw new Error('Launch renderer received a non-launch descriptor');
		const root = document.createElement('main');
		root.className = 'prctr-launch-window';
		const brand = presentation.add(
			new BrandLockup(document, brandLockupAppearance(activeTheme.theme))
		);
		presentation.add(
			activeTheme.onDidChangeTheme((theme) =>
				brand.setAppearance(brandLockupAppearance(theme))
			)
		);
		const heading = document.createElement('h1');
		heading.textContent = localization.format(messages.title);
		const server = document.createElement('section');
		server.className = 'prctr-launch-window__server';
		const institution = document.createElement('h2');
		const origin = document.createElement('p');
		origin.dir = 'ltr';
		const development = document.createElement('p');
		development.textContent = localization.format(messages.development);
		server.append(institution, origin, development);
		const status = document.createElement('p');
		status.className = 'prctr-launch-window__status';
		status.setAttribute('role', 'status');
		status.setAttribute('aria-atomic', 'true');
		status.tabIndex = -1;
		const administrator = document.createElement('p');
		administrator.className = 'prctr-launch-window__administrator';
		administrator.dir = 'auto';
		const retryTime = document.createElement('p');
		const authUnavailable = document.createElement('p');
		authUnavailable.textContent = localization.format(messages.authUnavailable);
		const actionError = document.createElement('p');
		actionError.setAttribute('role', 'alert');
		const form = document.createElement('form');
		form.className = 'prctr-launch-window__form';
		const field = disposables.add(
			new TextFieldControl(form, {
				label: localization.format(messages.serverLabel),
				description: localization.format(messages.serverHint),
				value: '',
				inputMode: 'url',
				autocomplete: 'off',
				required: true
			})
		);
		field.input.maxLength = 2048;
		field.input.spellcheck = false;
		field.input.autocapitalize = 'none';
		field.input.dir = 'ltr';
		const submit = disposables.add(
			new ButtonControl(form, {
				variant: 'primary',
				type: 'submit',
				label: localization.format(messages.check)
			})
		);
		const actions = document.createElement('div');
		actions.className = 'prctr-launch-window__actions';
		const signIn = disposables.add(
			new ButtonControl(actions, {
				variant: 'primary',
				label: localization.format(messages.signInGeneric),
				disabled: true
			})
		);
		const retry = disposables.add(
			new ButtonControl(actions, {
				variant: 'secondary',
				label: localization.format(messages.retry)
			})
		);
		const change = disposables.add(
			new ButtonControl(actions, {
				variant: 'secondary',
				label: localization.format(messages.changeServer)
			})
		);
		const exit = disposables.add(
			new ButtonControl(actions, {
				variant: 'secondary',
				label: localization.format(messages.exit)
			})
		);
		root.append(
			brand.element,
			heading,
			server,
			status,
			administrator,
			retryTime,
			authUnavailable,
			form,
			actionError,
			actions
		);
		let disposed = false;
		let revision = -1;
		let projection: LaunchIdentityProjection | undefined;
		let actionSequence = 0;
		let pendingAction: number | undefined;
		disposables.add({
			dispose: () => {
				disposed = true;
				root.remove();
			}
		});
		const render = (value: LaunchIdentityProjection): void => {
			if (disposed) return;
			const next = validateLaunchIdentityProjection(value);
			if (next.revision <= revision) return;
			const previousState = projection?.state;
			const selection = next.state === 'selectingServer' || next.state === 'invalidServer';
			const focused = document.activeElement;
			const focusWasHidden = form.contains(focused) && !selection;
			revision = next.revision;
			projection = next;
			root.dataset.state = next.state;
			form.hidden = !selection;
			server.hidden = next.origin === undefined;
			institution.hidden = next.institutionName === undefined;
			institution.textContent = next.institutionName ?? '';
			institution.dir = 'auto';
			origin.textContent = next.origin ?? '';
			development.hidden = !next.developmentOrigin;
			status.textContent = localization.format(messages[next.state]);
			administrator.hidden = next.administratorMessage === undefined;
			administrator.textContent = next.administratorMessage ?? '';
			retryTime.hidden = next.retryAt === undefined;
			retryTime.textContent =
				next.retryAt === undefined
					? ''
					: localization.format(messages.retryAt, {
							time: new Intl.DateTimeFormat(localization.locale, {
								dateStyle: 'medium',
								timeStyle: 'short'
							}).format(next.retryAt)
						});
			authUnavailable.hidden = next.state !== 'ready' || next.authorizationAvailable;
			signIn.element.hidden = selection;
			signIn.setState({
				label:
					next.institutionName === undefined
						? localization.format(messages.signInGeneric)
						: localization.format(messages.signIn, {
								institution: next.institutionName
							}),
				disabled: !next.canSignIn
			});
			retry.element.hidden =
				selection || next.state === 'checking' || next.state === 'authorizing';
			change.element.hidden = selection;
			actionError.textContent = '';
			field.setState({
				value:
					next.state === 'selectingServer' && previousState !== 'selectingServer'
						? ''
						: field.input.value,
				required: true,
				...(next.state === 'invalidServer'
					? { error: localization.format(messages.invalidServer) }
					: {})
			});
			if (root.isConnected && selection && previousState !== next.state) field.focus();
			else if (
				focusWasHidden ||
				(focused === signIn.element && signIn.element.disabled) ||
				(focused === retry.element && retry.element.hidden)
			)
				status.focus();
		};
		// Subscribe before the snapshot so an older invoke reply cannot overwrite an event.
		disposables.add(client.identity.onDidChange(render));
		render(await client.identity.projection());
		document.body.replaceChildren(root);
		if (!form.hidden) field.focus();
		const request = async (
			operation: () => Promise<void>,
			interrupt = false
		): Promise<void> => {
			if (disposed || (pendingAction !== undefined && !interrupt)) return;
			const sequence = ++actionSequence;
			pendingAction = sequence;
			submit.element.disabled = true;
			actionError.textContent = '';
			try {
				await operation();
			} catch {
				if (!disposed && sequence === actionSequence)
					actionError.textContent = localization.format(messages.failed);
			} finally {
				if (!disposed && sequence === actionSequence) {
					pendingAction = undefined;
					submit.element.disabled = false;
				}
			}
		};
		disposables.add(
			addDisposableListener(form, 'submit', (event) => {
				event.preventDefault();
				void request(() => client.identity.selectServer(field.input.value));
			})
		);
		disposables.add(
			signIn.onDidRequest(() => {
				void request(() => client.identity.signIn());
			})
		);
		disposables.add(
			retry.onDidRequest(() => {
				void request(() => client.identity.retry());
			})
		);
		disposables.add(
			change.onDidRequest(() => {
				void request(() => client.identity.changeServer(), true);
			})
		);
		disposables.add(
			exit.onDidRequest(() => {
				void request(() => client.exit(), true);
			})
		);
		disposables.add(presentation);
		return Object.freeze({ element: root, disposables });
	} catch (error) {
		disposables.dispose();
		ensureTheme();
		document.body.replaceChildren(
			createStartupSurface(document, 'launchRecovery', localization.format(messages.recovery))
		);
		throw error;
	}
}
