import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/button.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import type { CancellationToken } from '../../../../base/common/cancellation.js';
import type { LocalizationContext } from '../../../../base/common/localization.js';
import type {
	AccountClient,
	AccountData,
	AccountIntent,
	AccountSection,
	AccountResponse
} from '../../../../platform/account/common/accountProtocol.js';
import { createSemanticIcon } from '../../../../platform/theme/browser/semanticIcon.js';
import type { AuthenticatedWindowDescriptor } from '../../../../platform/windows/common/windowProtocol.js';
import type { ResolvedWorkbenchItem } from '../../../common/workbenchItem.js';
import type { WorkbenchPane } from '../../../browser/workbenchPane.js';
import { accountMessages as m } from './accountMessages.js';
import './account.css';

export interface AccountModel extends ResolvedWorkbenchItem {
	readonly section: AccountSection;
}

/** Owns presentation only. Every read and mutation goes through the bound account capability. */
export class AccountPane extends Disposable implements WorkbenchPane {
	readonly element: HTMLElement;
	readonly #page: HTMLElement;
	readonly #body: HTMLElement;
	readonly #heading: HTMLHeadingElement;
	readonly #status: HTMLElement;
	readonly #statusText: HTMLElement;
	readonly #statusIcon;
	readonly #refresh: ButtonControl;
	readonly #content = this._register(new DisposableStore());
	readonly #scroll: DomScrollableElement;
	#section: AccountSection = 'profile';
	#epoch = 0;
	#disposed = false;
	#busy = false;
	#buttons: { control: ButtonControl; label: string }[] = [];
	constructor(
		document: Document,
		private readonly client: AccountClient,
		private readonly localization: LocalizationContext,
		private readonly binding: AuthenticatedWindowDescriptor,
		private readonly onPhoto?: (dataUrl: string) => void
	) {
		super();
		this.element = document.createElement('section');
		this.element.className = 'prctr-account';
		this.#page = document.createElement('div');
		this.#page.className = 'prctr-account__viewport';
		this.#page.tabIndex = -1;
		const content = document.createElement('div');
		content.className = 'prctr-account__content';
		const header = document.createElement('header');
		header.className = 'prctr-account__header';
		this.#heading = document.createElement('h1');
		this.#heading.tabIndex = -1;
		header.append(this.#heading);
		this.#refresh = this._register(
			new ButtonControl(header, { variant: 'secondary', label: this.text('refresh') })
		);
		this._register(
			this.#refresh.onDidRequest(() => {
				void this.load();
			})
		);
		this.#body = document.createElement('div');
		this.#body.className = 'prctr-account__body';
		this.#status = document.createElement('div');
		this.#status.className = 'prctr-account__status';
		this.#status.role = 'status';
		this.#statusIcon = this._register(createSemanticIcon(document, { id: 'state.info' }));
		this.#statusText = document.createElement('span');
		this.#status.append(this.#statusIcon.element, this.#statusText);
		content.append(header, this.#body, this.#status);
		this.#page.append(content);
		this.#scroll = this._register(
			new DomScrollableElement(this.#page, {
				className: 'prctr-account__scroll',
				horizontal: ScrollbarVisibility.Hidden,
				vertical: ScrollbarVisibility.Auto,
				verticalScrollbarSize: 8,
				useShadows: false
			})
		);
		this.element.append(this.#scroll.getDomNode());
		const observer = new ResizeObserver(() => this.#scroll.scanDomNode());
		this._register({ dispose: () => observer.disconnect() });
		observer.observe(content);
		observer.observe(this.#page);
		this._register(
			addDisposableListener(this.#page, 'scroll', () => this.#scroll.scanDomNode())
		);
		this._register(
			addDisposableListener(this.#page, 'keydown', (event) => {
				if (
					event.defaultPrevented ||
					event.altKey ||
					event.ctrlKey ||
					event.metaKey ||
					event.shiftKey
				)
					return;
				const positions: Record<string, number> = {
					PageDown: this.#page.scrollTop + this.#page.clientHeight,
					PageUp: this.#page.scrollTop - this.#page.clientHeight,
					Home: 0,
					End: this.#page.scrollHeight
				};
				const position = positions[event.key];
				if (position === undefined) return;
				this.#scroll.setScrollPosition({ scrollTop: position });
				event.preventDefault();
			})
		);
	}
	private text(key: keyof typeof m): string {
		return this.localization.format(m[key]);
	}
	setItem(model: ResolvedWorkbenchItem, token: CancellationToken): void {
		this.#section = (model as AccountModel).section;
		this.#heading.textContent = this.text(
			this.#section === 'sessions' ? 'sessionsDevices' : this.#section
		);
		if (!token.isCancellationRequested) void this.load();
	}
	clear(): void {
		this.#epoch++;
		this.#buttons = [];
		this.#content.clear();
		this.#body.replaceChildren();
		this.#statusText.textContent = '';
		this.#busy = false;
	}
	setVisible(visible: boolean): void {
		this.element.hidden = !visible;
	}
	layout(): void {
		this.#scroll.scanDomNode();
	}
	focus(): void {
		this.#heading.focus();
	}
	getViewState(): Readonly<Record<string, unknown>> | undefined {
		return undefined;
	}
	override dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.clear();
		super.dispose();
		this.element.remove();
	}
	private status(key: keyof typeof m, kind: 'info' | 'error' | 'loading' = 'info'): void {
		this.#status.hidden = false;
		this.#status.dataset.kind = kind;
		this.#statusText.textContent = this.text(key);
		this.#statusIcon.setState({
			id:
				kind === 'loading'
					? 'state.loading'
					: kind === 'error'
						? 'state.error'
						: 'state.info',
			...(kind === 'loading' ? { modifier: 'spin' as const } : {})
		});
	}
	private async request(intent: AccountIntent): Promise<AccountResponse> {
		try {
			return await this.client.request(intent);
		} catch {
			return {
				kind: 'error',
				reason:
					intent.kind === 'read' ||
					intent.kind === 'readPhoto' ||
					intent.kind === 'openSecurity'
						? 'unavailable'
						: 'unconfirmed'
			};
		}
	}
	private async load(): Promise<void> {
		if (this.#busy || this.#disposed) return;
		const epoch = ++this.#epoch;
		const section = this.#section;
		this.#page.firstElementChild?.append(this.#status);
		this.#buttons = [];
		this.#content.clear();
		this.#body.replaceChildren();
		this.#refresh.setState({ label: this.text('refresh'), disabled: true });
		this.#body.setAttribute('aria-busy', 'true');
		this.status('loading', 'loading');
		const [result, companion] = await Promise.all([
			this.request({ kind: 'read', section }),
			this.request({
				kind: 'read',
				section:
					section === 'profile'
						? 'security'
						: section === 'sessions'
							? 'desktops'
							: section
			})
		]);
		if (this.#disposed || epoch !== this.#epoch) return;
		this.#body.setAttribute('aria-busy', 'false');
		this.#refresh.setState({ label: this.text('refresh') });
		if (result.kind !== 'data' || result.data.section !== section) {
			this.status(result.kind === 'error' ? result.reason : 'unavailable', 'error');
			return;
		}
		this.render(result.data);
		if (section === 'profile' || section === 'sessions') {
			if (companion.kind === 'data') this.render(companion.data);
			else {
				const message = this.paragraph(this.text('unavailable'));
				message.setAttribute('role', 'status');
			}
		}
		this.#statusText.textContent = '';
		this.#status.hidden = true;
		this.#scroll.scanDomNode();
	}
	private paragraph(text: string, host = this.#body): HTMLElement {
		const p = host.ownerDocument.createElement('p');
		p.textContent = text;
		host.append(p);
		return p;
	}
	private row(label: string, value: string, host = this.#body): void {
		const row = host.ownerDocument.createElement('div');
		row.className = 'prctr-account__row';
		const term = host.ownerDocument.createElement('dt');
		term.textContent = label;
		const detail = host.ownerDocument.createElement('dd');
		detail.textContent = value || this.text('notAvailable');
		row.append(term, detail);
		host.append(row);
	}
	private fields(host = this.#body): HTMLElement {
		const list = host.ownerDocument.createElement('dl');
		list.className = 'prctr-account__fields';
		host.append(list);
		return list;
	}
	private date(time: number): string {
		return time === 0
			? this.text('notAvailable')
			: new Intl.DateTimeFormat(
					this.localization.locale === 'pseudo' ? 'en' : this.localization.locale,
					{ dateStyle: 'medium', timeStyle: 'short' }
				).format(time);
	}
	private action(
		host: HTMLElement,
		label: string,
		run: (button: ButtonControl) => void,
		store = this.#content
	): ButtonControl {
		const button = store.add(new ButtonControl(host, { label, variant: 'secondary' }));
		this.#buttons.push({ control: button, label });
		store.add(button.onDidRequest(() => run(button)));
		store.add({
			dispose: () => {
				this.#buttons = this.#buttons.filter((entry) => entry.control !== button);
			}
		});
		return button;
	}
	private heading(key: keyof typeof m, host = this.#body): void {
		const heading = host.ownerDocument.createElement('h2');
		heading.textContent = this.text(key);
		host.append(heading);
	}
	private icon(
		host: HTMLElement,
		id: Parameters<typeof createSemanticIcon>[1]['id'],
		size: 16 | 24 = 24
	): void {
		host.append(
			this.#content.add(createSemanticIcon(host.ownerDocument, { id, size })).element
		);
	}
	private render(data: AccountData): void {
		this.#status.hidden = false;
		if (data.section === 'profile') {
			this.paragraph(this.text('profileSubtitle')).className = 'prctr-account__subtitle';
			const profile = data.profile;
			const hero = this.#body.ownerDocument.createElement('div');
			hero.className = 'prctr-account__identity';
			const avatar = hero.ownerDocument.createElement('div');
			avatar.className = 'prctr-account__avatar';
			avatar.ariaHidden = 'true';
			avatar.textContent = (profile.displayName || profile.username)
				.split(/\s+/u)
				.slice(0, 2)
				.map((p) => [...p][0] ?? '')
				.join('')
				.toUpperCase();
			const details = hero.ownerDocument.createElement('div');
			const name = hero.ownerDocument.createElement('h2');
			name.textContent = profile.displayName || profile.username;
			details.append(name);
			this.paragraph(this.binding.identity?.institutionName ?? '', details);
			const photoActions = hero.ownerDocument.createElement('div');
			photoActions.className = 'prctr-account__photo-actions';
			hero.append(avatar, details, photoActions);
			this.#body.append(hero);
			void this.loadPhoto(avatar, photoActions, this.#epoch);
			const detailsSection = this.#body.ownerDocument.createElement('section');
			detailsSection.className = 'prctr-account__profile-section';
			this.#body.append(detailsSection);
			this.heading('accountDetails', detailsSection);
			this.paragraph(this.text('profileNote'), detailsSection).className =
				'prctr-account__section-note';
			const fields = this.fields(detailsSection);
			this.row(
				this.text('fullName'),
				[profile.firstName, profile.lastName].filter(Boolean).join(' '),
				fields
			);
			this.row(this.text('username'), profile.username, fields);
			this.row(this.text('email'), profile.email ?? '', fields);
			if (profile.emailVerified) {
				const value = fields.lastElementChild!.lastElementChild as HTMLElement;
				const verified = value.ownerDocument.createElement('span');
				verified.className = 'prctr-account__verified';
				this.icon(verified, 'state.success', 16);
				verified.append(value.ownerDocument.createTextNode(this.text('verified')));
				value.append(verified);
			}
			this.row(this.text('locale'), profile.locale ?? '', fields);
			this.row(this.text('timezone'), profile.timezone ?? '', fields);
			if (this.binding.identity?.noCurrentAffiliation)
				this.paragraph(this.text('noAffiliation'), detailsSection);
			if (this.binding.identity?.noAssignedAccess)
				this.paragraph(this.text('noAccess'), detailsSection);
			return;
		}
		if (data.section === 'security') {
			const section = this.#body.ownerDocument.createElement('section');
			section.className = 'prctr-account__profile-section';
			this.#body.append(section);
			this.heading('security', section);
			this.paragraph(this.text('browserNote'), section).className =
				'prctr-account__section-note';
			const fields = this.fields(section);
			const security = data.security;
			this.row(
				this.text('password'),
				this.text(security.password ? 'enabled' : 'disabled'),
				fields
			);
			this.row(
				this.text('providers'),
				security.providers.map((p) => p.name).join(', ') || this.text('none'),
				fields
			);
			const mfa = security.mfa;
			this.row(
				this.text('mfa'),
				this.text(
					!mfa
						? 'notAvailable'
						: !mfa.available
							? 'serviceUnavailable'
							: mfa.recoveryRequired
								? 'recoveryRequired'
								: mfa.enabled
									? 'enabled'
									: mfa.pending
										? 'pending'
										: 'disabled'
				),
				fields
			);
			const securityAction = section.ownerDocument.createElement('div');
			securityAction.className = 'prctr-account__security-action';
			section.append(securityAction);
			this.action(securityAction, this.text('manageSecurity'), (button) => {
				void this.perform({ kind: 'openSecurity' }, button);
			});
			return;
		}
		const desktops = data.section === 'desktops';
		if (!desktops) {
			this.paragraph(this.text('sessionsDevicesNote')).className = 'prctr-account__subtitle';
			const current = data.sessions.find((s) => s.current);
			if (current) {
				this.heading('currentSession');
				const panel = this.#body.ownerDocument.createElement('section');
				panel.className = 'prctr-account__current';
				this.icon(panel, current.client === 'web' ? 'workbench.browser' : 'device.desktop');
				const details = panel.ownerDocument.createElement('div');
				const name = panel.ownerDocument.createElement('h3');
				name.textContent = current.name || this.text('desktop');
				details.append(name);
				this.paragraph(
					this.text(
						current.client === 'web'
							? 'web'
							: current.client === 'cli'
								? 'cli'
								: 'desktop'
					),
					details
				);
				this.paragraph(
					this.text('lastActive') + ': ' + this.date(current.lastActivityAt),
					details
				);
				panel.append(details);
				const badge = panel.ownerDocument.createElement('span');
				badge.className = 'prctr-account__badge';
				badge.textContent = this.text('thisSession');
				panel.append(badge);
				this.#body.append(panel);
			}
			this.heading('otherSessions');
		} else this.heading('desktops');
		const table = this.#body.ownerDocument.createElement('table');
		table.className = 'prctr-account__table';
		const head = table.createTHead().insertRow();
		for (const label of [
			this.text(desktops ? 'device' : 'client'),
			this.text('lastActive'),
			this.text('actions')
		]) {
			const th = table.ownerDocument.createElement('th');
			th.scope = 'col';
			th.textContent = label;
			head.append(th);
		}
		const body = table.createTBody();
		const items = desktops ? data.desktops : data.sessions.filter((s) => !s.current);
		for (const item of items) {
			const row = body.insertRow();
			const name = row.insertCell();
			const identity = name.ownerDocument.createElement('div');
			identity.className = 'prctr-account__table-identity';
			this.icon(
				identity,
				'client' in item && item.client === 'web' ? 'workbench.browser' : 'device.desktop'
			);
			const label = name.ownerDocument.createElement('span');
			label.textContent = item.name || this.text(desktops ? 'desktop' : 'otherClient');
			identity.append(label);
			if (item.current) {
				const badge = name.ownerDocument.createElement('span');
				badge.className = 'prctr-account__badge';
				badge.textContent = this.text('thisDesktop');
				identity.append(badge);
			}
			name.append(identity);
			row.insertCell().textContent = this.date(
				'lastUsedAt' in item ? item.lastUsedAt : item.lastActivityAt
			);
			const actions = row.insertCell();
			if ('revoked' in item && item.revoked) actions.textContent = this.text('revoked');
			else
				this.action(
					actions,
					this.text(desktops ? 'revokeDesktop' : 'endSession'),
					(button) =>
						this.confirm(
							actions,
							button,
							{ kind: desktops ? 'revokeDesktop' : 'revokeSession', id: item.id },
							item.current
						)
				);
		}
		if (items.length === 0) {
			const cell = body.insertRow().insertCell();
			cell.colSpan = 3;
			cell.textContent = this.text(desktops ? 'emptyDesktops' : 'emptySessions');
		}
		this.#body.append(table);
		if (desktops) {
			const note = this.paragraph(this.text('desktopsNote'));
			note.className = 'prctr-account__explanation';
		}
	}
	private async loadPhoto(avatar: HTMLElement, host: HTMLElement, epoch: number): Promise<void> {
		const result = await this.request({ kind: 'readPhoto' });
		if (this.#disposed || this.#epoch !== epoch) return;
		if (result.kind !== 'photo') {
			this.paragraph(this.text('photoUnavailable'), host);
			return;
		}
		const image = avatar.ownerDocument.createElement('img');
		image.alt = '';
		image.src = result.dataUrl;
		this.onPhoto?.(result.dataUrl);
		avatar.replaceChildren(image);
		const input = host.ownerDocument.createElement('input');
		input.type = 'file';
		input.accept = 'image/png,image/jpeg,image/webp';
		input.hidden = true;
		host.append(input);
		const choose = this.action(host, this.text('changePhoto'), () => input.click());
		this.action(host, this.text('removePhoto'), (button) =>
			this.confirm(host, button, { kind: 'removePhoto', etag: result.etag }, false)
		);
		this.#content.add(
			addDisposableListener(input, 'change', () => {
				void (async () => {
					const file = input.files?.[0];
					input.value = '';
					if (!file) return;
					if (
						file.size < 1 ||
						file.size > 5 * 1024 * 1024 ||
						!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
					) {
						host.append(this.#status);
						this.status('photoInvalid', 'error');
						return;
					}
					try {
						const bytes = new Uint8Array(await file.arrayBuffer());
						if (this.#disposed || this.#epoch !== epoch) return;
						await this.perform(
							{
								kind: 'uploadPhoto',
								bytes,
								mediaType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
								etag: result.etag
							},
							choose
						);
					} catch {
						if (!this.#disposed && this.#epoch === epoch) {
							host.append(this.#status);
							this.status('photoInvalid', 'error');
						}
					}
				})();
			})
		);
	}

	private confirm(
		host: HTMLElement,
		trigger: ButtonControl,
		intent: AccountIntent,
		current: boolean
	): void {
		if (this.#busy || host.querySelector('[data-confirmation]')) return;
		const owned = this.#content.add(new DisposableStore());
		const confirmation = host.ownerDocument.createElement('div');
		owned.add({ dispose: () => confirmation.remove() });
		confirmation.className = 'prctr-account__confirmation';
		confirmation.dataset.confirmation = 'true';
		confirmation.role = 'group';
		const desktop = intent.kind === 'revokeDesktop';
		const photo = intent.kind === 'removePhoto';
		confirmation.ariaLabel = this.text(
			photo ? 'removePhoto' : desktop ? 'confirmDesktop' : 'confirmSession'
		);
		this.paragraph(
			this.text(
				photo
					? 'photoRemoveDetail'
					: desktop
						? 'confirmDesktopDetail'
						: 'confirmSessionDetail'
			),
			confirmation
		);
		if (current) this.paragraph(this.text('confirmCurrent'), confirmation);
		const actions = host.ownerDocument.createElement('div');
		actions.className = 'prctr-account__actions';
		confirmation.append(actions);
		const cancel = this.action(
			actions,
			this.text('cancel'),
			() => {
				this.#page.firstElementChild?.append(this.#status);
				this.#status.hidden = true;
				this.#content.delete(owned);
				trigger.element.hidden = false;
				trigger.focus();
			},
			owned
		);
		this.action(
			actions,
			this.text(photo ? 'removePhoto' : desktop ? 'revokeDesktop' : 'endSession'),
			(button) => {
				void this.perform(intent, button);
			},
			owned
		);
		host.append(confirmation);
		trigger.element.hidden = true;
		cancel.focus();
	}
	private async perform(intent: AccountIntent, button: ButtonControl): Promise<void> {
		if (this.#busy || this.#disposed) return;
		const epoch = this.#epoch;
		this.#busy = true;
		for (const { control, label } of this.#buttons) control.setState({ label, disabled: true });
		const feedbackHost =
			button.element.closest<HTMLElement>('[data-confirmation]') ??
			button.element.parentElement;
		feedbackHost?.append(this.#status);
		this.#refresh.setState({ label: this.text('refresh'), disabled: true });
		this.#status.hidden = false;
		this.status('working', 'loading');
		const result = await this.request(intent);
		if (this.#disposed || epoch !== this.#epoch) return;
		this.#busy = false;
		for (const { control, label } of this.#buttons) control.setState({ label });
		this.#refresh.setState({ label: this.text('refresh') });
		if (result.kind === 'error') {
			this.status(result.reason, 'error');
			if (result.reason === 'unconfirmed' || result.reason === 'conflict') {
				for (const { control, label } of this.#buttons)
					control.setState({ label, disabled: true });
				this.#refresh.focus();
			} else button.focus();
			return;
		}
		if (intent.kind === 'openSecurity') this.status('browserOpened');
		else {
			await this.load();
			if (!this.#disposed && this.#epoch === epoch + 1) {
				if (this.#status.hidden) this.status('completed');
				this.#heading.focus();
			}
		}
	}
}
