/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../base/browser/dom.js';
import { ButtonControl } from '../../base/browser/ui/button/button.js';
import { TextFieldControl } from '../../base/browser/ui/field/textField.js';
import { DomScrollableElement } from '../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility } from '../../base/common/scrollable.js';
import { createLocalization } from '../../base/common/localization.js';
import { DisposableStore } from '../../base/common/lifecycle.js';
import {
	validateLaunchIdentityProjection,
	type LaunchIdentityClient,
	type LaunchIdentityProjection
} from '../../platform/identity/common/launchIdentity.js';
import { createSemanticIcon } from '../../platform/theme/browser/semanticIcon.js';
import { BrowserThemeService } from '../../platform/theme/browser/themeService.js';
import type { LaunchWindowDescriptor } from '../../platform/windows/common/windowProtocol.js';
import { ProductWindowChrome } from '../../platform/windows/browser/productWindowChrome.js';
import type { ProductWindowChromeClient } from '../../platform/windows/common/windowChrome.js';
import { prepareWorkbenchDocument } from './documentLayout.js';
import { BrandLockup, brandLockupAppearance } from './brandLockup.js';
import { launchMessages as messages } from './launchWindowMessages.js';
import { createStartupSurface } from './startupSurface.js';
import './launchWindow.css';

export interface LaunchRendererClient {
	bootstrap(): Promise<LaunchWindowDescriptor>;
	readonly windowChrome: ProductWindowChromeClient;
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
				'dark',
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
		const root = document.createElement('div');
		root.className = 'prctr-launch-window';
		const titlebar = document.createElement('header');
		titlebar.className = 'prctr-launch-window__titlebar';
		titlebar.setAttribute('aria-hidden', 'true');
		const page = document.createElement('div');
		page.className = 'prctr-launch-window__page';
		const task = document.createElement('main');
		task.className = 'prctr-launch-window__task';
		task.setAttribute('aria-labelledby', 'prctr-launch-title');
		const brand = presentation.add(
			new BrandLockup(document, brandLockupAppearance(activeTheme.theme))
		);
		presentation.add(
			activeTheme.onDidChangeTheme((theme) =>
				brand.setAppearance(brandLockupAppearance(theme))
			)
		);
		const heading = document.createElement('h1');
		heading.id = 'prctr-launch-title';
		heading.className = 'prctr-launch-window__brand';
		heading.setAttribute('aria-label', localization.format(messages.title));
		heading.append(brand.element);
		const server = document.createElement('section');
		server.className = 'prctr-launch-window__server';
		const institution = document.createElement('p');
		institution.className = 'prctr-launch-window__institution';
		const development = document.createElement('p');
		development.textContent = localization.format(messages.development);
		server.append(institution, development);
		const feedback = document.createElement('div');
		feedback.className = 'prctr-launch-window__feedback';
		const feedbackIcon = presentation.add(createSemanticIcon(document, { id: 'state.error' }));
		const feedbackMark = document.createElement('span');
		feedbackMark.className = 'prctr-launch-window__feedback-mark';
		feedbackMark.append(feedbackIcon.element);
		const feedbackBody = document.createElement('div');
		feedbackBody.className = 'prctr-launch-window__feedback-body';
		feedback.append(feedbackMark, feedbackBody);
		const status = document.createElement('p');
		status.className = 'prctr-launch-window__status';
		status.id = 'prctr-launch-feedback-error';
		status.setAttribute('role', 'status');
		status.setAttribute('aria-atomic', 'true');
		const administrator = document.createElement('p');
		administrator.className = 'prctr-launch-window__administrator';
		administrator.dir = 'auto';
		const retryTime = document.createElement('p');
		const authUnavailable = document.createElement('p');
		authUnavailable.textContent = localization.format(messages.authUnavailable);
		const actionError = document.createElement('p');
		actionError.className = 'prctr-launch-window__error';
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
		const submitHost = document.createElement('div');
		submitHost.className = 'prctr-launch-window__primary';
		form.append(submitHost);
		const submit = disposables.add(
			new ButtonControl(submitHost, {
				variant: 'primary',
				size: 'large',
				type: 'submit',
				label: localization.format(messages.check)
			})
		);
		const actions = document.createElement('div');
		actions.className = 'prctr-launch-window__actions';
		const primary = document.createElement('div');
		primary.className = 'prctr-launch-window__primary';
		actions.append(primary);
		const signIn = disposables.add(
			new ButtonControl(primary, {
				variant: 'primary',
				size: 'large',
				label: localization.format(messages.signInGeneric),
				disabled: true
			})
		);
		const retry = disposables.add(
			new ButtonControl(primary, {
				variant: 'primary',
				size: 'large',
				label: localization.format(messages.retry)
			})
		);
		const secondary = document.createElement('div');
		secondary.className = 'prctr-launch-window__button-host';
		actions.append(secondary);
		const change = disposables.add(
			new ButtonControl(secondary, {
				variant: 'secondary',
				size: 'large',
				label: localization.format(messages.changeServer)
			})
		);
		feedbackBody.append(status, administrator, retryTime, authUnavailable, actionError);
		const flow = document.createElement('div');
		flow.className = 'prctr-launch-window__flow';
		flow.append(form, actions, feedback);
		task.append(heading, server, flow);
		page.append(task);
		const scrollable = disposables.add(
			new DomScrollableElement(page, {
				className: 'prctr-launch-window__scrollable',
				horizontal: ScrollbarVisibility.Hidden,
				vertical: ScrollbarVisibility.Auto,
				useShadows: false
			})
		);
		root.append(titlebar, scrollable.getDomNode());
		// Observe both the viewport and content: messages, zoom, and window resizing
		// can change the scroll range independently.
		const resizeObserver = new ResizeObserver(() => scrollable.scanDomNode());
		disposables.add({ dispose: () => resizeObserver.disconnect() });
		resizeObserver.observe(page);
		resizeObserver.observe(task);
		// Browser focus navigation can scroll the DOM without going through the control.
		disposables.add(addDisposableListener(page, 'scroll', () => scrollable.scanDomNode()));
		disposables.add(
			addDisposableListener(page, 'keydown', (event: KeyboardEvent) => {
				if (
					event.defaultPrevented ||
					event.altKey ||
					event.ctrlKey ||
					event.metaKey ||
					event.shiftKey
				)
					return;
				if (event.target === field.input) return;
				let scrollTop: number;
				switch (event.key) {
					case 'PageDown':
						scrollTop = page.scrollTop + page.clientHeight;
						break;
					case 'PageUp':
						scrollTop = page.scrollTop - page.clientHeight;
						break;
					case 'Home':
						scrollTop = 0;
						break;
					case 'End':
						scrollTop = page.scrollHeight;
						break;
					case 'ArrowDown':
						scrollTop = page.scrollTop + 40;
						break;
					case 'ArrowUp':
						scrollTop = page.scrollTop - 40;
						break;
					default:
						return;
				}
				scrollable.setScrollPosition({ scrollTop });
				event.preventDefault();
			})
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
		const updateFeedback = (value: LaunchIdentityProjection): void => {
			const visible =
				!['selectingServer', 'ready'].includes(value.state) ||
				!authUnavailable.hidden ||
				!administrator.hidden ||
				!retryTime.hidden ||
				!!actionError.textContent;
			feedback.dataset.announcementOnly = String(!visible);
			let tone: 'error' | 'warning' | 'info' = 'info';
			if (value.state === 'invalidServer' || retryableStates.has(value.state)) tone = 'error';
			if (
				['maintenance', 'unavailable', 'updateRequired'].includes(value.state) ||
				!authUnavailable.hidden
			)
				tone = 'warning';
			if (actionError.textContent) tone = 'error';
			feedback.dataset.tone = tone;
			const busy =
				!actionError.textContent &&
				(value.state === 'checking' || value.state === 'authorizing');
			feedbackIcon.setState(
				busy ? { id: 'state.loading', modifier: 'spin' } : { id: `state.${tone}` }
			);
			scrollable.scanDomNode();
		};
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
			server.hidden = next.institutionName === undefined && !next.developmentOrigin;
			institution.hidden = next.institutionName === undefined;
			institution.textContent = next.institutionName ?? '';
			institution.dir = 'auto';
			development.hidden = !next.developmentOrigin;
			// Keep readiness announcements without repeating the form label or ready action.
			status.textContent = localization.format(messages[next.state]);
			status.dataset.announcementOnly = String(
				next.state === 'selectingServer' || next.state === 'ready'
			);
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
			signIn.element.hidden = next.state !== 'ready';
			signIn.setState({
				label: localization.format(messages.signInGeneric),
				accessibleLabel:
					next.institutionName === undefined
						? localization.format(messages.signInGeneric)
						: localization.format(messages.signIn, {
								institution: next.institutionName
							}),
				disabled: !next.canSignIn
			});
			retry.element.hidden = !retryableStates.has(next.state);
			primary.hidden = signIn.element.hidden && retry.element.hidden;
			secondary.hidden = selection;
			actions.hidden = primary.hidden && secondary.hidden;
			actionError.textContent = '';
			field.setState({
				value:
					next.state === 'selectingServer' && previousState !== 'selectingServer'
						? ''
						: field.input.value,
				required: true
			});
			if (next.state === 'invalidServer') {
				field.input.setAttribute('aria-invalid', 'true');
				field.input.setAttribute(
					'aria-describedby',
					`${field.input.getAttribute('aria-describedby') ?? ''} ${status.id}`.trim()
				);
			}
			updateFeedback(next);
			if (root.isConnected && selection && previousState !== next.state) field.focus();
			else if (
				root.isConnected &&
				!selection &&
				(focusWasHidden ||
					(focused === signIn.element && signIn.element.disabled) ||
					(focused === retry.element && retry.element.hidden))
			) {
				if (next.canSignIn) signIn.focus();
				else if (!retry.element.hidden) retry.focus();
				else change.focus();
			}
		};
		// Subscribe before the snapshot so an older invoke reply cannot overwrite an event.
		disposables.add(client.identity.onDidChange(render));
		render(await client.identity.projection());
		presentation.add(
			await ProductWindowChrome.create(titlebar, client.windowChrome, activeTheme)
		);
		const request = async (
			operation: () => Promise<void>,
			interrupt = false
		): Promise<void> => {
			if (disposed || (pendingAction !== undefined && !interrupt)) return;
			const sequence = ++actionSequence;
			pendingAction = sequence;
			submit.element.disabled = true;
			actionError.textContent = '';
			if (projection) updateFeedback(projection);
			try {
				await operation();
			} catch {
				if (!disposed && sequence === actionSequence) {
					actionError.textContent = localization.format(messages.failed);
					if (projection) updateFeedback(projection);
				}
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
		disposables.add(presentation);
		document.body.replaceChildren(root);
		scrollable.scanDomNode();
		if (!form.hidden) field.focus();
		else if (projection?.canSignIn) signIn.focus();
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

const retryableStates = new Set<LaunchIdentityProjection['state']>([
	'identityChanged',
	'maintenance',
	'unavailable',
	'unreachable',
	'timedOut',
	'invalidResponse',
	'redirectBlocked',
	'originMismatch',
	'updateRequired',
	'serverIncompatible',
	'unsupportedTarget',
	'authorizationDisabled',
	'authorizationUnsupported',
	'authorizationFailed'
]);
