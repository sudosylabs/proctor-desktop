import { addDisposableListener } from '../../../../base/browser/dom.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import {
	Disposable,
	DisposableStore,
	MutableDisposable,
	type IDisposable
} from '../../../../base/common/lifecycle.js';
import type { CancellationToken } from '../../../../base/common/cancellation.js';
import type { LocalizationContext } from '../../../../base/common/localization.js';
import type {
	AccountClient,
	AccountData,
	AccountDesktop,
	AccountIntent,
	AccountSection,
	AccountResponse,
	AccountSession
} from '../../../../platform/account/common/accountProtocol.js';
import { createSemanticIcon } from '../../../../platform/theme/browser/semanticIcon.js';
import type { AuthenticatedWindowDescriptor } from '../../../../platform/windows/common/windowProtocol.js';
import type { ResolvedWorkbenchItem } from '../../../common/workbenchItem.js';
import type { WorkbenchPane } from '../../../browser/workbenchPane.js';
import type { WorkbenchOverlayHost } from '../../../browser/overlayHost.js';
import { AccountPhotoEditor } from './accountPhotoEditor.js';
import { AccountFeedback } from './accountFeedback.js';
import { accountMessages as m } from './accountMessages.js';
import './account.css';

type Message = keyof typeof m;
type AccountItem = AccountSession | AccountDesktop;
interface SectionView {
	readonly host: HTMLElement;
	readonly content: HTMLElement;
	readonly store: DisposableStore;
	readonly feedback: AccountFeedback;
	sequence: number;
	data?: AccountData;
	photoFeedback?: AccountFeedback;
}
export interface AccountModel extends ResolvedWorkbenchItem {
	readonly section: AccountSection;
}
export interface AccountPaneServices {
	readonly overlays: WorkbenchOverlayHost;
	readonly customPhotos: Set<string>;
	readonly hover: (target: HTMLElement, label: string) => IDisposable;
}

/** Owns transient page state. The bound account capability owns all server mutations. */
export class AccountPane extends Disposable implements WorkbenchPane {
	readonly element: HTMLElement;
	readonly #page: HTMLElement;
	readonly #body: HTMLElement;
	readonly #heading: HTMLHeadingElement;
	readonly #subtitle: HTMLElement;
	readonly #refresh: ButtonControl;
	readonly #observations = this._register(new DisposableStore());
	readonly #content = this._register(new DisposableStore());
	readonly #editor = this._register(new MutableDisposable<AccountPhotoEditor>());
	readonly #scroll: DomScrollableElement;
	readonly #sections = new Map<AccountSection, SectionView>();
	readonly #pending = new Set<string>();
	readonly #unconfirmed = new Set<string>();
	#section: AccountSection = 'profile';
	#epoch = 0;
	#disposed = false;
	#refreshing = false;
	readonly #failedSections = new Set<AccountSection>();
	#detail: { item: AccountItem; trigger: HTMLElement } | undefined;
	/** The page's own detail panel beside the list; a row's Details action opens it. */
	readonly #details: HTMLElement;
	#detailHost: HTMLElement | undefined;
	#detailStore = this._register(new DisposableStore());
	constructor(
		document: Document,
		private readonly client: AccountClient,
		private readonly localization: LocalizationContext,
		private readonly binding: AuthenticatedWindowDescriptor,
		private readonly onPhoto?: (dataUrl: string) => void,
		private readonly services?: AccountPaneServices
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
			new ButtonControl(header, {
				variant: 'secondary',
				label: this.text('retry'),
				icon: (doc) => createSemanticIcon(doc, { id: 'action.refresh' })
			})
		);
		if (services) this._register(services.hover(this.#refresh.element, this.text('retry')));
		this._register(this.#refresh.onDidRequest(() => void this.refresh()));
		this.#refresh.element.hidden = true;
		this.#subtitle = document.createElement('p');
		this.#subtitle.className = 'prctr-account__subtitle';
		this.#body = document.createElement('div');
		this.#body.className = 'prctr-account__body';
		content.append(header, this.#subtitle, this.#body);
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
		this.#details = document.createElement('aside');
		this.#details.className = 'prctr-account__details';
		this.#details.hidden = true;
		this.element.append(this.#details);
		this._register(
			addDisposableListener(this.#details, 'keydown', (event) => {
				if (event.key !== 'Escape' || event.defaultPrevented) return;
				event.preventDefault();
				this.closeDetail();
			})
		);
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
					event.shiftKey ||
					(event.target instanceof HTMLElement &&
						event.target.closest('input,textarea,select,button'))
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
	private text(key: Message): string {
		return this.localization.format(m[key]);
	}
	setItem(model: ResolvedWorkbenchItem, token: CancellationToken): void {
		this.clear();
		if (token.isCancellationRequested) return;
		this.#section = (model as AccountModel).section;
		this.#heading.textContent = this.text(this.#section);
		this.#subtitle.textContent =
			this.#section === 'sessions' ? this.text('sessionsDevicesNote') : '';
		this.#subtitle.hidden = !this.#subtitle.textContent;
		// Sign-in and security has its own Account page, so Profile shows the profile alone.
		const sections: AccountSection[] =
			this.#section === 'sessions' ? ['sessions', 'desktops'] : [this.#section];
		for (const section of sections) {
			const host = this.node('section', 'section', this.#body);
			host.dataset.section = section;
			const content = this.node('div', 'section-content', host);
			const store = this.#content.add(new DisposableStore());
			const feedback = this.#content.add(new AccountFeedback(host, this.localization));
			this.#sections.set(section, { host, content, store, feedback, sequence: 0 });
		}
		if (this.#section === 'sessions' && this.services) {
			this.#detailHost = this.#details;
			this.#content.add({
				dispose: () => {
					this.#detailStore.clear();
					this.#detailHost = undefined;
					this.#details.hidden = true;
					this.#details.replaceChildren();
				}
			});
		}
		this.#content.add(token.onCancellationRequested(() => this.clear()));
		if (this.client.observe) this.observeSections();
		else void this.refresh();
	}
	clear(): void {
		this.#observations.clear();
		this.#epoch++;
		this.#editor.clear();
		this.#content.clear();
		this.#detailStore.clear();
		this.#sections.clear();
		this.#failedSections.clear();
		this.updateRefresh();
		this.#pending.clear();
		this.#unconfirmed.clear();
		this.#body.replaceChildren();
		this.#detail = undefined;
		this.#refreshing = false;
	}
	private observeSections(): void {
		this.#observations.clear();
		if (!this.client.observe) return;
		const epoch = this.#epoch;
		for (const section of this.#sections.keys()) {
			if (!this.#sections.get(section)?.data)
				this.#sections.get(section)?.feedback.set('loading', 'loading');
			this.#observations.add(
				this.client.observe({ kind: 'read', section }, (result) => {
					if (!this.#disposed && epoch === this.#epoch && !this.#pending.size)
						this.applySection(section, result);
				})
			);
		}
	}
	setVisible(visible: boolean): void {
		this.element.hidden = !visible;
		if (visible) this.observeSections();
		else this.#observations.clear();
	}
	layout(): void {
		this.#scroll.scanDomNode();
	}
	focus(): void {
		this.#heading.focus();
	}
	getViewState(): undefined {
		return undefined;
	}
	override dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.clear();
		super.dispose();
		this.element.remove();
	}
	private node<K extends keyof HTMLElementTagNameMap>(
		tag: K,
		name: string,
		host: HTMLElement
	): HTMLElementTagNameMap[K] {
		const node = host.ownerDocument.createElement(tag);
		if (name) node.className = `prctr-account__${name}`;
		host.append(node);
		return node;
	}
	private paragraph(text: string, host: HTMLElement, name = ''): HTMLElement {
		const p = this.node('p', name, host);
		p.textContent = text;
		return p;
	}
	private heading(key: Message, host: HTMLElement): HTMLHeadingElement {
		const h = this.node('h2', '', host);
		h.textContent = this.text(key);
		h.tabIndex = -1;
		return h;
	}
	private row(label: string, value: string, host: HTMLElement): void {
		const row = this.node('div', 'row', host);
		this.node('dt', '', row).textContent = label;
		this.node('dd', '', row).textContent = value || this.text('notProvided');
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
		store: DisposableStore,
		variant: 'primary' | 'secondary' = 'secondary'
	): ButtonControl {
		const button = store.add(new ButtonControl(host, { label, variant }));
		store.add(button.onDidRequest(() => run(button)));
		return button;
	}
	private icon(
		host: HTMLElement,
		id: Parameters<typeof createSemanticIcon>[1]['id'],
		store: DisposableStore,
		size: 16 | 24 = 16
	): void {
		host.append(store.add(createSemanticIcon(host.ownerDocument, { id, size })).element);
	}
	private async request(intent: AccountIntent): Promise<AccountResponse> {
		try {
			return await this.client.request(intent);
		} catch {
			return {
				kind: 'error',
				reason: ['read', 'readPhoto', 'openSecurity'].includes(intent.kind)
					? 'unavailable'
					: 'unconfirmed'
			};
		}
	}
	private updateRefresh(): void {
		this.#refresh.element.hidden = this.#failedSections.size === 0;
		this.#refresh.setState({
			label: this.text('retry'),
			disabled: this.#refreshing || this.#pending.size > 0,
			icon: (doc) => createSemanticIcon(doc, { id: 'action.refresh' })
		});
	}
	private async refresh(): Promise<void> {
		if (this.#refreshing || this.#pending.size || this.#disposed) return;
		const epoch = this.#epoch;
		this.#refreshing = true;
		this.updateRefresh();
		await Promise.all([...this.#sections.keys()].map((section) => this.loadSection(section)));
		if (this.#disposed || epoch !== this.#epoch) return;
		this.#refreshing = false;
		this.updateRefresh();
	}
	private async loadSection(section: AccountSection): Promise<boolean> {
		const view = this.#sections.get(section);
		if (!view) return false;
		const epoch = this.#epoch,
			sequence = ++view.sequence;
		if (!view.data) view.feedback.set('loading', 'loading');
		view.host.setAttribute('aria-busy', 'true');
		const result = await this.request({ kind: 'read', section });
		if (this.#disposed || epoch !== this.#epoch || sequence !== view.sequence) return false;
		return this.applySection(section, result);
	}
	private applySection(section: AccountSection, result: AccountResponse): boolean {
		const view = this.#sections.get(section);
		if (!view) return false;
		view.host.setAttribute('aria-busy', 'false');
		if (result.kind !== 'data' || result.data.section !== section) {
			this.#failedSections.add(section);
			this.updateRefresh();
			if (
				result.kind === 'error' &&
				['sessionEnded', 'denied', 'notFound'].includes(result.reason)
			) {
				view.data = undefined;
				view.store.clear();
				view.content.replaceChildren();
			}
			if (!view.data && !view.content.childElementCount)
				this.heading(section === 'profile' ? 'accountDetails' : section, view.content);
			view.feedback.set(
				result.kind === 'error' ? result.reason : 'sectionUnavailable',
				'error'
			);
			return false;
		}
		for (const key of this.#unconfirmed) {
			if (
				(section === 'sessions' && key.startsWith('revokeSession')) ||
				(section === 'desktops' && key.startsWith('revokeDesktop'))
			)
				this.#unconfirmed.delete(key);
		}
		this.#failedSections.delete(section);
		this.updateRefresh();
		if (JSON.stringify(view.data) === JSON.stringify(result.data)) {
			view.feedback.set();
			return true;
		}
		view.data = result.data;
		view.store.clear();
		view.content.replaceChildren();
		view.feedback.set();
		this.render(result.data, view);
		this.#scroll.scanDomNode();
		if (this.#detail && (section === 'sessions' || section === 'desktops')) {
			const items =
				result.data.section === 'sessions'
					? result.data.sessions
					: result.data.section === 'desktops'
						? result.data.desktops
						: [];
			const matchingType =
				section === 'desktops'
					? 'platform' in this.#detail.item
					: 'client' in this.#detail.item;
			if (matchingType) {
				const item = items.find((item) => item.id === this.#detail?.item.id);
				this.#detail = item
					? {
							item,
							trigger:
								view.content.querySelector<HTMLElement>(
									`[data-item-id="${item.id}"] button`
								) ?? this.#heading
						}
					: undefined;
				this.renderDetail();
			}
		}
		return true;
	}
	private render(data: AccountData, view: SectionView): void {
		const host = view.content,
			store = view.store;
		if (data.section === 'profile') {
			const profile = data.profile;
			const hero = this.node('div', 'identity', host);
			const avatar = this.node('div', 'avatar', hero);
			avatar.ariaHidden = 'true';
			avatar.textContent = (profile.displayName || profile.username)
				.split(/\s+/u)
				.slice(0, 2)
				.map((part) => [...part][0] ?? '')
				.join('')
				.toUpperCase();
			const identity = this.node('div', 'identity-text', hero);
			this.node('h2', '', identity).textContent = profile.displayName || profile.username;
			this.paragraph(profile.email || profile.username, identity);
			if (this.binding.identity?.institutionName)
				this.paragraph(this.binding.identity.institutionName, identity);
			const photo = this.node('div', 'photo', host);
			void this.loadPhoto(avatar, photo, view);
			this.heading('accountDetails', host);
			this.paragraph(this.text('profileNote'), host, 'section-note');
			const fields = this.node('dl', 'fields', host);
			this.row(
				this.text('fullName'),
				[profile.firstName, profile.lastName].filter(Boolean).join(' '),
				fields
			);
			this.row(this.text('username'), profile.username, fields);
			this.row(this.text('email'), profile.email ?? '', fields);
			if (profile.email && profile.emailVerified !== undefined) {
				const value = fields.lastElementChild!.lastElementChild as HTMLElement;
				value.classList.add('prctr-account__email');
				const email = this.node('span', '', value);
				email.textContent = profile.email;
				value.replaceChildren(email);
				const verified = this.node('span', 'verified', value);
				this.icon(
					verified,
					profile.emailVerified ? 'state.success' : 'state.info',
					store,
					16
				);
				verified.append(
					host.ownerDocument.createTextNode(
						this.text(profile.emailVerified ? 'verified' : 'unverified')
					)
				);
			}
			if (profile.locale) this.row(this.text('locale'), profile.locale, fields);
			if (profile.timezone) this.row(this.text('timezone'), profile.timezone, fields);
			if (this.binding.identity?.noCurrentAffiliation)
				this.paragraph(this.text('noAffiliation'), host);
			if (this.binding.identity?.noAssignedAccess)
				this.paragraph(this.text('noAccess'), host);
			return;
		}
		if (data.section === 'security') {
			this.heading('security', host);
			this.paragraph(this.text('browserNote'), host, 'section-note');
			const fields = this.node('dl', 'fields', host),
				security = data.security;
			this.row(
				this.text('password'),
				this.text(security.password ? 'enabled' : 'disabled'),
				fields
			);
			this.row(
				this.text('providers'),
				security.providers.map((provider) => provider.name).join(', ') || this.text('none'),
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
			const actions = this.node('div', 'security-action', host);
			const feedback = store.add(new AccountFeedback(host, this.localization));
			this.action(
				actions,
				this.text('manageSecurity'),
				(button) => {
					const epoch = this.#epoch;
					button.setState({ label: this.text('manageSecurity'), disabled: true });
					void this.request({ kind: 'openSecurity' }).then((result) => {
						if (this.#disposed || epoch !== this.#epoch || !button.element.isConnected)
							return;
						button.setState({ label: this.text('manageSecurity') });
						feedback.set(
							result.kind === 'error' ? result.reason : 'browserOpened',
							result.kind === 'error' ? 'error' : 'info'
						);
					});
				},
				store
			);
			return;
		}
		const desktops = data.section === 'desktops';
		if (data.section === 'sessions') {
			const current = data.sessions.find((session) => session.current);
			if (current) {
				this.heading('currentSession', host);
				const summary = this.node('div', 'current', host);
				this.icon(
					summary,
					current.client === 'web' ? 'session.web' : 'session.desktop',
					store
				);
				const identity = this.node('div', 'item-text', summary);
				this.node('h3', '', identity).textContent = current.name || this.text('desktop');
				this.paragraph(
					this.text('lastActive') + ': ' + this.date(current.lastActivityAt),
					identity
				);
				this.node('span', 'badge', summary).textContent = this.text('thisSession');
				this.detailsAction(summary, current, store);
			}
			this.heading('otherSessions', host);
		} else {
			this.heading('desktops', host);
			this.paragraph(this.text('desktopsNote'), host, 'section-note');
		}
		const items =
			data.section === 'desktops'
				? data.desktops
				: data.section === 'sessions'
					? data.sessions.filter((session) => !session.current)
					: [];
		if (!items.length) {
			this.paragraph(this.text(desktops ? 'emptyDesktops' : 'emptySessions'), host, 'empty');
			return;
		}
		const list = this.node('ul', 'items', host);
		list.ariaLabel = this.text(desktops ? 'desktops' : 'otherSessions');
		for (const item of items) {
			const row = this.node('li', 'item', list);
			row.dataset.itemId = item.id;
			const summary = this.node('div', 'item-summary', row);
			this.icon(
				summary,
				'client' in item && item.client === 'web' ? 'session.web' : 'session.desktop',
				store
			);
			const identity = this.node('div', 'item-text', summary);
			const title = this.node('div', 'item-title', identity);
			this.node('span', '', title).textContent =
				item.name || this.text(desktops ? 'desktop' : 'otherClient');
			if (item.current)
				this.node('span', 'badge', title).textContent = this.text('thisDesktop');
			const type =
				'platform' in item ? this.platform(item.platform) : this.clientName(item.client);
			this.paragraph(
				type +
					' · ' +
					this.text(desktops ? 'lastUsed' : 'lastActive') +
					': ' +
					this.date('lastUsedAt' in item ? item.lastUsedAt : item.lastActivityAt),
				identity
			);
			const actions = this.node('div', 'actions', summary);
			this.detailsAction(actions, item, store);
			if ('revoked' in item && item.revoked)
				this.node('span', 'inactive', actions).textContent = this.text('revoked');
			else
				this.action(
					actions,
					this.text(desktops ? 'revokeDesktop' : 'endSession'),
					(button) =>
						this.confirm(
							row,
							button,
							{ kind: desktops ? 'revokeDesktop' : 'revokeSession', id: item.id },
							item.current,
							item.name,
							view
						),
					store
				);
		}
	}
	private clientName(client: string): string {
		return this.text(client === 'web' ? 'web' : client === 'cli' ? 'cli' : 'desktop');
	}
	private platform(platform: string): string {
		return this.text(
			platform === 'darwin' || platform === 'macos'
				? 'mac'
				: platform === 'win32' || platform === 'windows'
					? 'windows'
					: platform === 'linux'
						? 'linux'
						: 'otherPlatform'
		);
	}
	private detailsAction(host: HTMLElement, item: AccountItem, store: DisposableStore): void {
		if (!this.services) return;
		this.action(
			host,
			this.text('details'),
			(button) => {
				this.#detail = { item, trigger: button.element };
				if (this.#detailHost) this.#detailHost.hidden = false;
				this.renderDetail();
				this.#detailHost?.querySelector<HTMLElement>('h2')?.focus();
			},
			store
		);
	}
	private renderDetail(): void {
		const host = this.#detailHost;
		if (!host) return;
		this.#detailStore.clear();
		if (!this.#detail) {
			this.closeDetail();
			return;
		}
		host.replaceChildren();
		const heading = this.heading('details', host);
		const { item } = this.#detail;
		heading.textContent = item.name || this.text('details');
		const fields = this.node('dl', 'fields', host);
		if ('platform' in item) {
			this.row(this.text('platform'), this.platform(item.platform), fields);
			this.row(this.text('version'), item.release, fields);
			this.row(this.text('registered'), this.date(item.createdAt), fields);
			this.row(this.text('lastUsed'), this.date(item.lastUsedAt), fields);
			if (item.revoked) this.paragraph(this.text('revoked'), host);
		} else {
			this.row(this.text('client'), this.clientName(item.client), fields);
			this.row(
				this.text('method'),
				this.text(
					item.method === 'password'
						? 'passwordMethod'
						: item.method === 'oidc'
							? 'oidcMethod'
							: item.method === 'cas'
								? 'casMethod'
								: 'otherMethod'
				),
				fields
			);
			this.row(this.text('created'), this.date(item.createdAt), fields);
			this.row(this.text('lastActive'), this.date(item.lastActivityAt), fields);
			this.row(this.text('expires'), this.date(item.expiresAt), fields);
		}
		this.action(host, this.text('backToList'), () => this.closeDetail(), this.#detailStore);
	}
	/** Close the detail panel, returning focus to the row that opened it. */
	private closeDetail(): void {
		const trigger = this.#detail?.trigger;
		const hadFocus = this.#details.contains(this.#details.ownerDocument.activeElement);
		this.#detail = undefined;
		this.#detailStore.clear();
		this.#details.hidden = true;
		this.#details.replaceChildren();
		if (hadFocus) (trigger?.isConnected ? trigger : this.#heading).focus();
	}
	private async loadPhoto(
		avatar: HTMLElement,
		host: HTMLElement,
		view: SectionView
	): Promise<void> {
		const epoch = this.#epoch,
			sequence = view.sequence;
		const actions = this.node('div', 'actions', host);
		const feedback = view.store.add(new AccountFeedback(host, this.localization));
		view.photoFeedback = feedback;
		const input = this.node('input', '', host);
		input.type = 'file';
		input.accept = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';
		input.hidden = true;
		let photo: Extract<AccountResponse, { kind: 'photo' }> | undefined;
		const choose = this.action(
			actions,
			this.text('changePhoto'),
			() => input.click(),
			view.store
		);
		choose.setState({ label: this.text('changePhoto'), disabled: true });
		const remove = this.action(
			actions,
			this.text('removePhoto'),
			(button) => {
				if (photo)
					this.confirm(
						host,
						button,
						{ kind: 'removePhoto', etag: photo.etag },
						false,
						'',
						view
					);
			},
			view.store
		);
		remove.element.hidden = true;
		const apply = (next: Extract<AccountResponse, { kind: 'photo' }>): void => {
			photo = next;
			this.#unconfirmed.delete('photo');
			const image = avatar.ownerDocument.createElement('img');
			image.alt = '';
			image.src = next.dataUrl;
			avatar.replaceChildren(image);
			this.onPhoto?.(next.dataUrl);
			choose.setState({ label: this.text('changePhoto'), disabled: !this.services });
			remove.element.hidden = !this.services?.customPhotos.has(next.etag);
		};
		view.store.add(addDisposableListener(input, 'cancel', () => choose.focus()));
		view.store.add(
			addDisposableListener(input, 'change', () => {
				const file = input.files?.[0];
				input.value = '';
				if (!file || !photo || !this.services) return;
				feedback.set();
				this.#editor.value = new AccountPhotoEditor(
					host.ownerDocument,
					this.services.overlays,
					this.client,
					this.localization,
					photo.etag,
					file,
					(next) => {
						if (this.#disposed || epoch !== this.#epoch || sequence !== view.sequence)
							return;
						this.services!.customPhotos.add(next.etag);
						apply(next);
						feedback.set('photoUpdated');
					},
					(reconcile) => {
						if (choose.element.isConnected) {
							choose.focus();
							if (reconcile) {
								choose.setState({
									label: this.text('changePhoto'),
									disabled: true
								});
								void this.refresh();
							}
						}
					}
				);
			})
		);
		const result = await this.request({ kind: 'readPhoto' });
		if (this.#disposed || epoch !== this.#epoch || sequence !== view.sequence) return;
		if (result.kind === 'photo') apply(result);
		else feedback.set('photoUnavailable', 'error');
	}
	private confirm(
		host: HTMLElement,
		trigger: ButtonControl,
		intent: AccountIntent,
		current: boolean,
		name: string,
		view: SectionView
	): void {
		if (host.querySelector('[data-confirmation]')) return;
		const owned = view.store.add(new DisposableStore());
		const box = this.node('div', 'confirmation', host);
		box.dataset.confirmation = 'true';
		box.role = 'group';
		owned.add({ dispose: () => box.remove() });
		const desktop = intent.kind === 'revokeDesktop',
			photo = intent.kind === 'removePhoto';
		box.ariaLabel = this.text(
			photo ? 'removePhoto' : desktop ? 'confirmDesktop' : 'confirmSession'
		);
		if (name) this.paragraph(name, box, 'confirmation-name');
		this.paragraph(
			this.text(
				photo
					? 'photoRemoveDetail'
					: desktop
						? 'confirmDesktopDetail'
						: 'confirmSessionDetail'
			),
			box
		);
		if (current) this.paragraph(this.text('confirmCurrent'), box);
		const actions = this.node('div', 'actions', box);
		const feedback = owned.add(new AccountFeedback(box, this.localization));
		const key = photo ? 'photo' : intent.kind + ('id' in intent ? intent.id : '');
		let working = false,
			needsRead = this.#unconfirmed.has(key);
		const close = (): void => {
			if (working) return;
			view.store.delete(owned);
			trigger.element.hidden = false;
			trigger.focus();
		};
		const cancel = this.action(actions, this.text('cancel'), close, owned);
		const label = this.text(photo ? 'removePhoto' : desktop ? 'revokeDesktop' : 'endSession');
		const confirm = this.action(
			actions,
			label,
			() => {
				if (working || needsRead) return;
				if (this.#pending.size) {
					feedback.set('mutationWaiting');
					return;
				}
				working = true;
				const epoch = this.#epoch;
				this.#pending.add(key);
				this.updateRefresh();
				cancel.setState({ label: this.text('cancel'), disabled: true });
				confirm.setState({ label, disabled: true });
				feedback.set('working', 'loading');
				void (async () => {
					const result = await this.request(intent);
					if (this.#disposed || epoch !== this.#epoch) return;
					if (result.kind === 'success') {
						if (photo && intent.kind === 'removePhoto')
							this.services?.customPhotos.delete(intent.etag);
						const loaded = await this.loadSection(
							photo ? 'profile' : desktop ? 'desktops' : 'sessions'
						);
						if (this.#disposed || epoch !== this.#epoch) return;
						this.#pending.delete(key);
						this.updateRefresh();
						working = false;
						if (loaded) {
							(photo ? view.photoFeedback : view.feedback)?.set(
								photo
									? 'photoRemoved'
									: desktop
										? 'desktopRevokedSuccess'
										: 'sessionEndedSuccess'
							);
							(
								view.content.querySelector<HTMLElement>('h2') ?? this.#heading
							).focus();
						} else {
							needsRead = true;
							this.#unconfirmed.add(key);
							feedback.set('unconfirmed', 'error');
							recheck.element.hidden = false;
							cancel.setState({ label: this.text('cancel') });
							recheck.focus();
						}
						return;
					}
					this.#pending.delete(key);
					this.updateRefresh();
					working = false;
					const reason = result.kind === 'error' ? result.reason : 'unconfirmed';
					needsRead = ['unconfirmed', 'conflict', 'notFound'].includes(reason);
					if (needsRead) this.#unconfirmed.add(key);
					feedback.set(reason, 'error');
					cancel.setState({ label: this.text('cancel') });
					confirm.setState({ label, disabled: needsRead });
					recheck.element.hidden = !needsRead;
					(needsRead ? recheck : confirm).focus();
				})();
			},
			owned
		);
		const recheck = this.action(
			actions,
			this.text('retry'),
			() => {
				if (this.#pending.size) {
					feedback.set('mutationWaiting');
					return;
				}
				const epoch = this.#epoch;
				working = true;
				recheck.setState({ label: this.text('retry'), disabled: true });
				cancel.setState({ label: this.text('cancel'), disabled: true });
				void this.loadSection(photo ? 'profile' : desktop ? 'desktops' : 'sessions').then(
					(loaded) => {
						if (this.#disposed || epoch !== this.#epoch) return;
						if (loaded)
							(
								view.content.querySelector<HTMLElement>('h2') ?? this.#heading
							).focus();
						else {
							working = false;
							recheck.setState({ label: this.text('retry') });
							cancel.setState({ label: this.text('cancel') });
						}
					}
				);
			},
			owned
		);
		recheck.element.hidden = !needsRead;
		if (needsRead) {
			confirm.setState({ label, disabled: true });
			feedback.set('unconfirmed', 'error');
		}
		owned.add(
			addDisposableListener(box, 'keydown', (event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					close();
				}
			})
		);
		trigger.element.hidden = true;
		cancel.focus();
	}
}
