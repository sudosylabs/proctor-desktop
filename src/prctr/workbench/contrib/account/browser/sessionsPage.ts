/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import type {
	AccountDesktop,
	AccountIntent,
	AccountResponse,
	AccountSession
} from '../../../../platform/account/common/accountProtocol.js';
import {
	clientKind,
	desktopShape,
	failureNeedsRead,
	groupSessions,
	orderDesktops,
	platformKind
} from '../common/accountPresentation.js';
import { AccountConfirmation } from './accountConfirmation.js';
import type { AccountMessage } from './accountMessages.js';
import type { AccountPageServices, AccountPageView } from './accountPageServices.js';
import { AccountRead } from './accountRead.js';
import { AccountSection, type AccountRowModel } from './accountSection.js';

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
	private readonly current: AccountSection;
	private readonly others: AccountSection;
	private readonly registered: AccountSection;
	private readonly confirmation = this._register(new MutableDisposable());
	/** Items whose last change has an unknown outcome; they wait for a fresh read. */
	private readonly unconfirmed = new Set<string>();

	constructor(
		body: HTMLElement,
		private readonly services: AccountPageServices
	) {
		super();
		this.sessions = this._register(new AccountRead(services, 'sessions'));
		this.desktops = this._register(new AccountRead(services, 'desktops'));
		this.current = this._register(
			new AccountSection(body, services, { title: services.text('thisComputer') })
		);
		this.others = this._register(
			new AccountSection(body, services, {
				title: services.text('otherSessions'),
				description: services.text('otherSessionsDescription')
			})
		);
		this.registered = this._register(
			new AccountSection(body, services, {
				title: services.text('registeredDesktops'),
				description: services.text('registeredDesktopsDescription')
			})
		);
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
			ready && groups.current === undefined ? this.services.text('noCurrentSession') : false,
			retry
		);
		this.others.setState(
			state,
			ready && groups.others.length === 0 ? this.services.text('noOtherSessions') : false,
			retry
		);
		this.current.setRows(groups.current === undefined ? [] : [this.currentRow(groups.current)]);
		this.others.setRows(groups.others.map((session) => this.sessionRow(session)));
	}

	private renderDesktops(): void {
		const desktops = orderDesktops(this.desktops.data?.desktops ?? []);
		this.registered.setState(
			this.desktops.state,
			this.desktops.data !== undefined && desktops.length === 0
				? this.services.text('noDesktops')
				: false,
			() => void this.desktops.refresh()
		);
		this.registered.setRows(desktops.map((desktop) => this.desktopRow(desktop)));
	}

	private clientName(session: AccountSession): string {
		return this.services.text(clientKind(session.client));
	}

	private sessionName(session: AccountSession): string {
		return session.name || this.clientName(session);
	}

	private sessionDetail(session: AccountSession): string {
		return this.services.text('sessionSummary', {
			client: this.clientName(session),
			signedIn: this.services.relative(session.createdAt),
			active: this.services.relative(session.lastActivityAt)
		});
	}

	private currentRow(session: AccountSession): AccountRowModel {
		return {
			id: session.id,
			title: this.sessionName(session),
			detail: this.sessionDetail(session),
			shape: 'active',
			tag: this.services.text('thisSession'),
			actions: [
				{ label: this.services.text('signOut'), run: () => this.services.hooks.signOut() }
			]
		};
	}

	private sessionRow(session: AccountSession): AccountRowModel {
		const name = this.sessionName(session);
		const key = `session:${session.id}`;
		return {
			id: session.id,
			title: name,
			detail: this.sessionDetail(session),
			shape: 'idle',
			actions: [
				{
					label: this.services.text('endSession'),
					destructive: true,
					enabled: !this.unconfirmed.has(key),
					run: () =>
						this.confirm({
							title: this.services.text('confirmEndSessionTitle', { name }),
							message: this.services.text('confirmEndSessionBody', { name }),
							confirmLabel: this.services.text('endSession'),
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

	private desktopRow(desktop: AccountDesktop): AccountRowModel {
		const name = desktop.name || this.services.text('unnamedDesktop');
		const platform = this.services.text(platformKind(desktop.platform));
		const key = `desktop:${desktop.id}`;
		const detail = desktop.revoked
			? this.services.text('desktopRemovedSummary', {
					platform,
					registered: this.services.date(desktop.createdAt)
				})
			: this.services.text('desktopSummary', {
					platform,
					release: desktop.release,
					registered: this.services.date(desktop.createdAt),
					used: this.services.relative(desktop.lastUsedAt)
				});
		const removable = !desktop.current && !desktop.revoked;
		return {
			id: desktop.id,
			title: name,
			detail,
			shape: desktopShape(desktop),
			...(desktop.current ? { tag: this.services.text('thisComputer') } : {}),
			actions: removable
				? [
						{
							label: this.services.text('removeDesktop'),
							destructive: true,
							enabled: !this.unconfirmed.has(key),
							run: () =>
								this.confirm({
									title: this.services.text('confirmRemoveDesktopTitle', {
										name
									}),
									message: this.services.text('confirmRemoveDesktopBody', {
										name
									}),
									confirmLabel: this.services.text('removeDesktop'),
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
		readonly intent: AccountIntent;
		readonly key: string;
		readonly section: AccountSection;
		readonly read: AccountRead<'sessions'> | AccountRead<'desktops'>;
		readonly success: AccountMessage;
	}): void {
		this.confirmation.value = new AccountConfirmation(
			this.services,
			{
				title: options.title,
				message: options.message,
				confirmLabel: options.confirmLabel,
				run: () => this.services.change(options.intent),
				onDidComplete: (result) => this.onChangeComplete(result, options)
			},
			() => undefined
		);
	}

	private onChangeComplete(
		result: AccountResponse,
		options: {
			readonly key: string;
			readonly section: AccountSection;
			readonly read: AccountRead<'sessions'> | AccountRead<'desktops'>;
			readonly success: AccountMessage;
		}
	): void {
		if (result.kind === 'error' && failureNeedsRead(result.reason)) {
			this.unconfirmed.add(options.key);
			// Redraw so the row's action is locked while the list is read again.
			if (options.key.startsWith('session:')) this.renderSessions();
			else this.renderDesktops();
			options.section.feedback.set(this.services.failure(result.reason), 'error');
		} else options.section.feedback.set(this.services.text(options.success), 'success');
		options.section.focusHeading();
		void options.read.refresh();
	}
}
