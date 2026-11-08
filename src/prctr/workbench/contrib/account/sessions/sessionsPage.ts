/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IAccountService } from '../../../services/account/common/account.js';
import { IAccountFormatService } from '../accountFormat.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAuthenticatedNavigationService } from '../../../services/authenticatedNavigation/common/authenticatedNavigation.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import type {
	AccountDesktop,
	AccountIntent,
	AccountResponse,
	AccountSession
} from '../../../../platform/account/common/accountProtocol.js';
import {
	clientKind,
	failureNeedsRead,
	groupSessions,
	orderDesktops,
	platformKind
} from '../common/accountPresentation.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import { AccountConfirmation } from '../widgets/accountConfirmation.js';
import type { AccountMessage } from '../accountMessages.js';
import type { AccountPageView } from '../accountPages.js';
import { AccountRead } from '../widgets/accountRead.js';
import {
	PageSection,
	type PageRowModel
} from '../../../browser/authenticated/pages/pageSection.js';

/** Lock key for ending every other session; it settles with the next sessions read. */
const OTHERS = 'session:*';

/**
 * Sessions and devices: this computer's session, the other places the account
 * is signed in, and the computers registered for exams. Ending this computer's
 * session is signing out; ending another session or removing another desktop is
 * confirmed first. After an unknown outcome a row stays locked until its list is
 * read again.
 */
export class SessionsPage extends Disposable implements AccountPageView {
	private readonly sessions: AccountRead<'sessions'>;
	private readonly desktops: AccountRead<'desktops'>;
	private readonly current: PageSection;
	private readonly others: PageSection;
	private readonly registered: PageSection;
	private readonly confirmation = this._register(new MutableDisposable());
	/** Items whose last change has an unknown outcome; they wait for a fresh read. */
	private readonly unconfirmed = new Set<string>();

	constructor(
		body: HTMLElement,
		_headerActions: HTMLElement,
		@IAccountService private readonly account: IAccountService,
		@IAccountFormatService private readonly format: IAccountFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext,
		@IAuthenticatedNavigationService
		private readonly navigation: IAuthenticatedNavigationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
		this.sessions = this._register(
			this.instantiationService.createInstance(AccountRead<'sessions'>, 'sessions')
		);
		this.desktops = this._register(
			this.instantiationService.createInstance(AccountRead<'desktops'>, 'desktops')
		);
		this.current = this._register(
			this.instantiationService.createInstance(PageSection, body, {
				title: this.format.text('thisComputer')
			})
		);
		this.others = this._register(
			this.instantiationService.createInstance(PageSection, body, {
				title: this.format.text('otherSessions'),
				action: {
					label: this.format.text('endOtherSessions'),
					icon: 'action.end',
					destructive: true
				}
			})
		);
		this.registered = this._register(
			this.instantiationService.createInstance(PageSection, body, {
				title: this.format.text('registeredDesktops'),
				description: this.format.text('registeredDesktopsDescription')
			})
		);
		this._register(this.others.onDidRequestAction(() => this.confirmEndOthers()));
		this._register(this.sessions.onDidChange(() => this.renderSessions()));
		this._register(this.desktops.onDidChange(() => this.renderDesktops()));
		this._register(this.sessions.onDidRead(() => this.onRead('session:')));
		this._register(this.desktops.onDidRead(() => this.onRead('desktop:')));
		this.renderSessions();
		this.renderDesktops();
	}

	setVisible(visible: boolean): void {
		this.sessions.setActive(visible);
		this.desktops.setActive(visible);
	}

	/** A fresh read settles every unknown outcome in its list, so their actions return. */
	private onRead(prefix: 'session:' | 'desktop:'): void {
		const settled = [...this.unconfirmed].filter((key) => key.startsWith(prefix));
		if (settled.length === 0) return;
		for (const key of settled) this.unconfirmed.delete(key);
		if (prefix === 'session:') this.renderSessions();
		else this.renderDesktops();
	}

	private renderSessions(): void {
		const state = this.sessions.state;
		const retry = (): void => void this.sessions.refresh();
		const groups = groupSessions(this.sessions.data?.sessions ?? []);
		const ready = this.sessions.data !== undefined;
		this.current.setState(
			state,
			ready && groups.current === undefined ? this.format.text('noCurrentSession') : false,
			retry
		);
		this.others.setState(
			state,
			ready && groups.others.length === 0 ? this.format.text('noOtherSessions') : false,
			retry
		);
		this.others.setAction(groups.others.length > 0, !this.unconfirmed.has(OTHERS));
		this.current.setRows(groups.current === undefined ? [] : [this.currentRow(groups.current)]);
		this.others.setRows(groups.others.map((session) => this.sessionRow(session)));
	}

	private renderDesktops(): void {
		const desktops = orderDesktops(this.desktops.data?.desktops ?? []);
		this.registered.setState(
			this.desktops.state,
			this.desktops.data !== undefined && desktops.length === 0
				? this.format.text('noDesktops')
				: false,
			() => void this.desktops.refresh()
		);
		this.registered.setRows(desktops.map((desktop) => this.desktopRow(desktop)));
	}

	private confirmEndOthers(): void {
		this.confirm({
			title: this.format.text('confirmEndOtherSessionsTitle'),
			message: this.format.text('confirmEndOtherSessionsBody'),
			confirmLabel: this.format.text('endOtherSessions'),
			intent: { kind: 'revokeOtherSessions' },
			key: OTHERS,
			section: this.others,
			read: this.sessions,
			success: 'otherSessionsEnded'
		});
	}

	private clientName(session: AccountSession): string {
		return this.format.text(clientKind(session.client));
	}

	private sessionName(session: AccountSession): string {
		return session.name || this.clientName(session);
	}

	/**
	 * "macOS · signed in today, 08:41" for this computer; for another session, what the title
	 * does not already say, then when it was last used: "Proctor Desktop · Windows · active 5 Nov",
	 * or "Signed in yesterday, 17:20 · active today, 09:12" when nothing else is known.
	 */
	private sessionDetail(session: AccountSession): string {
		const parts: string[] = [];
		if (!session.current && session.name && session.name !== this.clientName(session))
			parts.push(this.clientName(session));
		if (session.platform) parts.push(this.format.text(platformKind(session.platform)));
		const signedIn = { when: this.format.relative(session.createdAt) };
		if (session.current || parts.length === 0)
			parts.push(
				this.format.text(
					parts.length === 0 ? 'sessionSignedInFirst' : 'sessionSignedIn',
					signedIn
				)
			);
		if (!session.current)
			parts.push(
				this.format.text('sessionActive', {
					when: this.format.relative(session.lastActivityAt)
				})
			);
		return parts.reduce((detail, part) => this.format.join(detail, part));
	}

	private sessionGlyph(session: AccountSession): ProctorIconId {
		const kind = clientKind(session.client);
		return kind === 'clientWeb'
			? 'device.browser'
			: kind === 'clientCli'
				? 'device.cli'
				: 'device.laptop';
	}

	private currentRow(session: AccountSession): PageRowModel {
		return {
			id: session.id,
			glyph: this.sessionGlyph(session),
			title: this.sessionName(session),
			detail: this.sessionDetail(session),
			status: {
				text: this.format.text('thisSession'),
				icon: 'status.success',
				tone: 'quiet'
			},
			// Signing out asks first, in the window's own confirmation.
			button: {
				label: this.format.text('signOut'),
				icon: 'action.signOut',
				run: () => this.navigation.signOut()
			}
		};
	}

	private sessionRow(session: AccountSession): PageRowModel {
		const name = this.sessionName(session);
		const key = `session:${session.id}`;
		return {
			id: session.id,
			glyph: this.sessionGlyph(session),
			title: name,
			detail: this.sessionDetail(session),
			actions: [
				{
					label: this.format.text('endSessionEllipsis'),
					icon: 'action.end',
					destructive: true,
					enabled: !this.unconfirmed.has(key),
					run: () =>
						this.confirm({
							title: this.format.text('confirmEndSessionTitle', { name }),
							message: this.format.text('confirmEndSessionBody', { name }),
							confirmLabel: this.format.text('endSession'),
							confirmIcon: 'action.end',
							intent: { kind: 'revokeSession', id: session.id },
							key,
							section: this.others,
							read: this.sessions,
							success: 'sessionEnded'
						})
				}
			]
		};
	}

	private desktopRow(desktop: AccountDesktop): PageRowModel {
		const name = desktop.name || this.format.text('unnamedDesktop');
		const platform = this.format.text(platformKind(desktop.platform));
		const key = `desktop:${desktop.id}`;
		const detail = desktop.revoked
			? this.format.text('desktopRemovedSummary', {
					platform,
					registered: this.format.date(desktop.createdAt)
				})
			: this.format.text('desktopSummary', {
					platform,
					release: desktop.release,
					registered: this.format.date(desktop.createdAt),
					used: this.format.relative(desktop.lastUsedAt)
				});
		const removable = !desktop.current && !desktop.revoked;
		return {
			id: desktop.id,
			glyph: desktop.platform === 'darwin' ? 'device.laptop' : 'device.desktop',
			title: name,
			detail,
			...(desktop.current
				? {
						status: {
							text: this.format.text('thisComputer'),
							icon: 'status.success' as const,
							tone: 'quiet' as const
						}
					}
				: desktop.revoked
					? {
							status: {
								text: this.format.text('desktopRemovedStatus'),
								icon: 'action.close' as const,
								tone: 'quiet' as const
							}
						}
					: {}),
			actions: removable
				? [
						{
							label: this.format.text('removeDesktopEllipsis'),
							icon: 'action.delete',
							destructive: true,
							enabled: !this.unconfirmed.has(key),
							run: () =>
								this.confirm({
									title: this.format.text('confirmRemoveDesktopTitle', {
										name
									}),
									message: this.format.text('confirmRemoveDesktopBody', {
										name
									}),
									confirmLabel: this.format.text('removeDesktop'),
									confirmIcon: 'action.delete',
									intent: { kind: 'revokeDesktop', id: desktop.id },
									key,
									section: this.registered,
									read: this.desktops,
									success: 'desktopRemoved'
								})
						}
					]
				: []
		};
	}

	private confirm(options: {
		readonly title: string;
		readonly message: string;
		readonly confirmLabel: string;
		readonly confirmIcon?: ProctorIconId;
		readonly intent: AccountIntent;
		readonly key: string;
		readonly section: PageSection;
		readonly read: AccountRead<'sessions'> | AccountRead<'desktops'>;
		readonly success: AccountMessage;
	}): void {
		this.confirmation.value = this.instantiationService.createInstance(
			AccountConfirmation,
			{
				title: options.title,
				message: options.message,
				confirmLabel: options.confirmLabel,
				...(options.confirmIcon === undefined ? {} : { confirmIcon: options.confirmIcon }),
				run: () => this.account.change(options.intent),
				onDidComplete: (result) => this.onChangeComplete(result, options)
			},
			() => undefined
		);
	}

	private onChangeComplete(
		result: AccountResponse,
		options: {
			readonly key: string;
			readonly section: PageSection;
			readonly read: AccountRead<'sessions'> | AccountRead<'desktops'>;
			readonly success: AccountMessage;
		}
	): void {
		if (result.kind === 'error' && failureNeedsRead(result.reason)) {
			this.unconfirmed.add(options.key);
			// Redraw so the row's action is locked while the list is read again.
			if (options.key.startsWith('session:')) this.renderSessions();
			else this.renderDesktops();
			options.section.feedback.set(this.format.failure(result.reason), 'error');
		} else
			this.pane.toast(
				this.format.text(
					result.kind === 'sessionsEnded' && result.count === 0
						? 'noOtherSessionsEnded'
						: options.success
				)
			);
		options.section.focusHeading();
		void options.read.refresh();
	}
}
