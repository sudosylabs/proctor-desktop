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
	platformKind,
	sessionUnidentified,
	signInMessage,
	type SignedInEntry
} from '../common/accountPresentation.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import { AccountConfirmation } from '../widgets/accountConfirmation.js';
import type { AccountMessage } from '../accountMessages.js';
import type { PageView } from '../../../browser/authenticated/pages/pagePane.js';
import { AccountRead } from '../widgets/accountRead.js';
import {
	PageSection,
	type PageRowAction,
	type PageRowModel
} from '../../../browser/authenticated/pages/pageSection.js';
import { RenameDialog, SessionDetailsDialog, type RenameTarget } from './sessionDialogs.js';

/** Lock key for ending every other session; it settles with the next sessions read. */
const OTHERS = 'session:*';

/**
 * Sessions and devices: every place the account is signed in, each computer once, and the
 * computers registered for exams that are not signed in. A Desktop Session is joined to the
 * registration it signed in with, so its row says it is registered and its menu can remove
 * that registration. Ending this computer's session is signing out; every other ending or
 * removal is confirmed first. After an unknown outcome a row stays locked until its list is
 * read again.
 */
export class SessionsPage extends Disposable implements PageView {
	private readonly sessions: AccountRead<'sessions'>;
	private readonly desktops: AccountRead<'desktops'>;
	private readonly signedIn: PageSection;
	private readonly registered: PageSection;
	private readonly dialog = this._register(new MutableDisposable());
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
		this.signedIn = this._register(
			this.instantiationService.createInstance(PageSection, body, {
				title: this.format.text('signedInSection'),
				action: {
					label: this.format.text('endOtherSessions'),
					icon: 'action.end',
					destructive: true
				},
				failure: (reason) =>
					reason === 'unavailable'
						? {
								title: this.format.text('sessionsLoadFailedTitle'),
								text: this.format.institutionText(
									'sessionsLoadFailedTimeout',
									'sessionsLoadFailedTimeoutGeneric'
								)
							}
						: undefined
			})
		);
		this.registered = this._register(
			this.instantiationService.createInstance(PageSection, body, {
				title: this.format.text('registeredOnlySection'),
				description: this.format.text('registeredOnlyDescription')
			})
		);
		this._register(this.signedIn.onDidRequestAction(() => this.confirmEndOthers()));
		this._register(this.sessions.onDidChange(() => this.render()));
		this._register(this.desktops.onDidChange(() => this.render()));
		this._register(this.sessions.onDidRead(() => this.onRead('session:')));
		this._register(this.desktops.onDidRead(() => this.onRead('desktop:')));
		this.render();
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
		this.render();
	}

	private render(): void {
		const groups = groupSessions(
			this.sessions.data?.sessions ?? [],
			this.desktops.data?.desktops ?? []
		);
		const ready = this.sessions.data !== undefined;
		this.signedIn.setState(
			this.sessions.state,
			ready && groups.signedIn.length === 0 ? this.format.text('noCurrentSession') : false,
			() => void this.sessions.refresh()
		);
		const others = groups.signedIn.filter((entry) => !entry.session.current).length;
		this.signedIn.setAction(others > 0, !this.unconfirmed.has(OTHERS));
		this.signedIn.setRows(groups.signedIn.map((entry) => this.sessionRow(entry)));
		// Only computers that are registered and not signed in; with none the section is left out.
		const desktopsReady = this.desktops.data !== undefined;
		this.registered.hidden =
			this.desktops.state.kind !== 'failed' &&
			(!desktopsReady || groups.registeredOnly.length === 0);
		this.registered.setState(this.desktops.state, false, () => void this.desktops.refresh());
		this.registered.setRows(groups.registeredOnly.map((desktop) => this.desktopRow(desktop)));
	}

	private confirmEndOthers(): void {
		this.confirm({
			title: this.format.text('confirmEndOtherSessionsTitle'),
			message: this.format.text('confirmEndOtherSessionsBody'),
			confirmLabel: this.format.text('endOtherSessions'),
			intent: { kind: 'revokeOtherSessions' },
			key: OTHERS,
			id: undefined,
			success: 'otherSessionsEnded'
		});
	}

	/** A computer by its registered name, a browser or tool by the name the server gave it. */
	private sessionName(entry: SignedInEntry): string {
		const { session, desktop } = entry;
		const name = session.desktopRegistrationName || desktop?.name || session.name;
		if (name) return name;
		return sessionUnidentified(session)
			? this.format.text('unknownDevice')
			: this.format.text(clientKind(session.client));
	}

	private kind(session: AccountSession): string {
		return sessionUnidentified(session)
			? this.format.text('notIdentified')
			: this.format.text(clientKind(session.client));
	}

	/**
	 * One pattern for every row: kind · system · registered · how it signed in, when the row is
	 * one to judge · signed in · active. "Proctor Desktop · macOS · Registered for exams · Signed
	 * in today, 08:41", "Not identified · Password, no two-step · Signed in 1 Nov · Active 3 Nov".
	 */
	private sessionDetail(entry: SignedInEntry): string {
		const { session, desktop } = entry;
		const parts = [this.kind(session)];
		if (session.platform) parts.push(this.format.text(platformKind(session.platform)));
		if (desktop !== undefined) parts.push(this.format.text('registeredForExams'));
		if (sessionUnidentified(session)) parts.push(this.format.text(signInMessage(session)));
		parts.push(
			this.format.text('sessionSignedIn', { when: this.format.relative(session.createdAt) })
		);
		if (!session.current)
			parts.push(
				this.format.text('sessionActive', {
					when: this.format.relative(session.lastActivityAt)
				})
			);
		return parts.reduce((detail, part) => this.format.join(detail, part));
	}

	private sessionRow(entry: SignedInEntry): PageRowModel {
		const { session, desktop } = entry;
		const name = this.sessionName(entry);
		const key = `session:${session.id}`;
		const locked = this.unconfirmed.has(key);
		const actions: PageRowAction[] = [
			{
				label: this.format.text('sessionDetailsMenu'),
				icon: 'status.info',
				run: () => this.showSessionDetails(entry, name)
			},
			{
				label: this.format.text('renameMenu'),
				icon: 'action.edit',
				enabled: !locked,
				run: () =>
					this.rename(
						desktop === undefined && session.desktopRegistrationId === undefined
							? { kind: 'session', id: session.id, name }
							: {
									kind: 'desktop',
									id: desktop?.id ?? session.desktopRegistrationId!,
									name
								},
						session.id
					)
			}
		];
		if (!session.current)
			actions.push({
				label: this.format.text('endSessionMenu'),
				icon: 'action.end',
				destructive: true,
				enabled: !locked,
				run: () =>
					this.confirm({
						title: this.format.text('confirmEndSessionTitle', { name }),
						message: this.format.text('confirmEndSessionBody', { name }),
						confirmLabel: this.format.text('endSession'),
						confirmIcon: 'action.end',
						intent: { kind: 'revokeSession', id: session.id },
						key,
						id: session.id,
						success: 'sessionEnded'
					})
			});
		if (desktop !== undefined && !desktop.current)
			actions.push(this.removeAction(desktop, name, session.id, true));
		return {
			id: session.id,
			glyph: this.sessionGlyph(session),
			title: name,
			detail: this.sessionDetail(entry),
			...(session.current ? { here: this.format.text('currentBadge') } : {}),
			...(sessionUnidentified(session)
				? {
						titleBadge: {
							text: this.format.text('unidentifiedBadge'),
							tone: 'attention' as const
						}
					}
				: {}),
			// Signing out asks first, in the window's own confirmation.
			...(session.current
				? {
						button: {
							label: this.format.text('signOut'),
							icon: 'action.signOut' as const,
							run: () => this.navigation.signOut()
						}
					}
				: {}),
			actions
		};
	}

	private desktopName(desktop: AccountDesktop): string {
		return desktop.name || this.format.text('unnamedDesktop');
	}

	/** "Proctor Desktop · Windows · Registered 1 Oct · Last used 20 Oct". */
	private desktopRow(desktop: AccountDesktop): PageRowModel {
		const name = this.desktopName(desktop);
		const detail = [
			this.format.text('clientDesktop'),
			this.format.text(platformKind(desktop.platform)),
			this.format.text('desktopRegistered', { date: this.format.date(desktop.createdAt) }),
			this.format.text('desktopLastUsed', {
				when: this.format.relative(desktop.lastUsedAt)
			})
		].reduce((first, second) => this.format.join(first, second));
		const locked = this.unconfirmed.has(`desktop:${desktop.id}`);
		const actions: PageRowAction[] = [
			{
				label: this.format.text('sessionDetailsMenu'),
				icon: 'status.info',
				run: () => this.showDesktopDetails(desktop, name)
			},
			{
				label: this.format.text('renameMenu'),
				icon: 'action.edit',
				enabled: !locked,
				run: () => this.rename({ kind: 'desktop', id: desktop.id, name }, desktop.id)
			}
		];
		if (!desktop.current) actions.push(this.removeAction(desktop, name, desktop.id, false));
		return {
			id: desktop.id,
			glyph: platformGlyph(desktop.platform),
			title: name,
			detail,
			...(desktop.current ? { here: this.format.text('currentBadge') } : {}),
			actions
		};
	}

	private removeAction(
		desktop: AccountDesktop,
		name: string,
		rowId: string,
		signedIn: boolean
	): PageRowAction {
		const key = `desktop:${desktop.id}`;
		return {
			label: this.format.text('removeRegistrationMenu'),
			icon: 'action.delete',
			destructive: true,
			enabled: !this.unconfirmed.has(key),
			run: () =>
				this.confirm({
					title: this.format.text('confirmRemoveRegistrationTitle', { name }),
					message: this.format.text(
						signedIn
							? 'confirmRemoveRegistrationSignedInBody'
							: 'confirmRemoveRegistrationBody',
						{ name }
					),
					confirmLabel: this.format.text('removeRegistration'),
					confirmIcon: 'action.delete',
					intent: { kind: 'revokeDesktop', id: desktop.id },
					key,
					id: rowId,
					success: 'registrationRemoved'
				})
		};
	}

	/** A browser's globe, the command line's terminal, or the Desktop's operating system logo. */
	private sessionGlyph(session: AccountSession): ProctorIconId {
		const kind = clientKind(session.client);
		return kind === 'clientWeb'
			? 'device.browser'
			: kind === 'clientCli'
				? 'device.cli'
				: platformGlyph(session.platform);
	}

	// #region Dialogs

	private showSessionDetails(entry: SignedInEntry, name: string): void {
		const { session, desktop } = entry;
		const details: { label: string; value: string }[] = [
			{ label: this.format.text('detailKind'), value: this.kind(session) }
		];
		if (session.platform)
			details.push({
				label: this.format.text('detailSystem'),
				value: this.format.text(platformKind(session.platform))
			});
		details.push(
			{
				label: this.format.text('detailHow'),
				value: this.format.text(signInMessage(session))
			},
			{
				label: this.format.text('detailSignedIn'),
				value: this.format.dateTime(session.createdAt)
			}
		);
		if (session.mfaCompletedAt !== undefined)
			details.push({
				label: this.format.text('detailTwoStep'),
				value: this.format.dateTime(session.mfaCompletedAt)
			});
		details.push(
			{
				label: this.format.text('detailLastActive'),
				value: this.format.dateTime(session.lastActivityAt)
			},
			{
				label: this.format.text('detailExpires'),
				value: this.format.dateTime(session.expiresAt)
			}
		);
		if (desktop !== undefined) details.push(...this.registrationDetails(desktop));
		this.dialog.value = this.instantiationService.createInstance(
			SessionDetailsDialog,
			name,
			details
		);
	}

	private showDesktopDetails(desktop: AccountDesktop, name: string): void {
		this.dialog.value = this.instantiationService.createInstance(SessionDetailsDialog, name, [
			{ label: this.format.text('detailKind'), value: this.format.text('clientDesktop') },
			{
				label: this.format.text('detailSystem'),
				value: this.format.text(platformKind(desktop.platform))
			},
			{
				label: this.format.text('detailSignedIn'),
				value: this.format.text('detailNotSignedIn')
			},
			...this.registrationDetails(desktop),
			{
				label: this.format.text('detailLastUsed'),
				value: this.format.dateTime(desktop.lastUsedAt)
			}
		]);
	}

	private registrationDetails(desktop: AccountDesktop): { label: string; value: string }[] {
		const details = [
			{
				label: this.format.text('detailRegistered'),
				value: this.format.date(desktop.createdAt)
			}
		];
		// A development build's placeholder version means nothing to the person.
		if (desktop.release && !/^0\.0\.0(?:$|-)/u.test(desktop.release))
			details.push({ label: this.format.text('detailRelease'), value: desktop.release });
		return details;
	}

	private rename(target: RenameTarget, rowId: string): void {
		this.dialog.value = this.instantiationService.createInstance(
			RenameDialog,
			target,
			(result) => {
				if (this._store.isDisposed) return;
				if (result.kind === 'error') {
					this.unconfirmed.add(
						target.kind === 'desktop' ? `desktop:${target.id}` : `session:${target.id}`
					);
					this.render();
					this.signedIn.feedback.set(this.format.failure(result.reason), 'error');
				} else this.pane.toast(this.format.text('renamed'));
				void this.sessions.refresh();
				void this.desktops.refresh();
				if (!this.signedIn.focusRow(rowId) && !this.registered.focusRow(rowId))
					this.signedIn.focusHeading();
			}
		);
	}

	private confirm(options: {
		readonly title: string;
		readonly message: string;
		readonly confirmLabel: string;
		readonly confirmIcon?: ProctorIconId;
		readonly intent: AccountIntent;
		readonly key: string;
		/** The row the change is about, which takes focus back if it is still there. */
		readonly id: string | undefined;
		readonly success: AccountMessage;
	}): void {
		this.dialog.value = this.instantiationService.createInstance(
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
		options: { readonly key: string; readonly success: AccountMessage }
	): void {
		// A computer that is signed in is listed under Signed in, so its failure is told there.
		const section =
			options.key.startsWith('desktop:') && !this.registered.element.hidden
				? this.registered
				: this.signedIn;
		if (result.kind === 'error' && failureNeedsRead(result.reason)) {
			this.unconfirmed.add(options.key);
			// Redraw so the row's action is locked while the list is read again.
			this.render();
			section.feedback.set(this.format.failure(result.reason), 'error');
		} else
			this.pane.toast(
				this.format.text(
					result.kind === 'sessionsEnded' && result.count === 0
						? 'noOtherSessionsEnded'
						: options.success
				)
			);
		this.signedIn.focusHeading();
		void this.sessions.refresh();
		void this.desktops.refresh();
	}

	// #endregion
}

/** The operating system's logo, or a plain desktop when it is not known. */
function platformGlyph(platform: string): ProctorIconId {
	const kind = platformKind(platform);
	return kind === 'platformMac'
		? 'device.apple'
		: kind === 'platformWindows'
			? 'device.windows'
			: kind === 'platformLinux'
				? 'device.linux'
				: 'device.desktop';
}
