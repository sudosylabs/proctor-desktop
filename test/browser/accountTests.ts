import {
	AccountPane,
	type AccountModel
} from '../../src/prctr/workbench/contrib/account/browser/accountPane.ts';
import { accountMessages } from '../../src/prctr/workbench/contrib/account/browser/accountMessages.ts';
import { createLocalization } from '../../src/prctr/base/common/localization.ts';
import { CancellationToken } from '../../src/prctr/base/common/cancellation.ts';
import { Event } from '../../src/prctr/base/common/event.ts';
import type {
	AccountIntent,
	AccountResponse,
	AccountSection
} from '../../src/prctr/platform/account/common/accountProtocol.ts';

export async function runAccountTests(document: Document): Promise<void> {
	const requests: AccountIntent[] = [];
	let delayed: ((value: AccountResponse) => void) | undefined;
	const pane = new AccountPane(
		document,
		{
			async request(intent) {
				requests.push(intent);
				if (intent.kind === 'read' && intent.section === 'profile')
					return new Promise<AccountResponse>((resolve) => {
						delayed = resolve;
					});
				if (intent.kind === 'read' && intent.section === 'sessions')
					return {
						kind: 'data',
						data: {
							section: 'sessions',
							sessions: [
								{
									id: 'y'.repeat(26),
									current: false,
									name: 'Browser on another computer',
									client: 'web',
									method: 'password',
									createdAt: 1,
									lastActivityAt: 1,
									expiresAt: 2
								}
							]
						}
					};
				if (intent.kind === 'read' && intent.section === 'security')
					return {
						kind: 'data',
						data: {
							section: 'security',
							security: { password: true, providers: [], mfa: undefined }
						}
					};
				return { kind: 'error', reason: 'strongAuthenticationRequired' };
			}
		},
		createLocalization({ requestedLocale: 'en', messages: Object.values(accountMessages) }),
		{
			protocolVersion: 1,
			kind: 'authenticated',
			windowId: 'test:account',
			institutionOrigin: 'https://example.test',
			principalId: 'y'.repeat(26),
			sessionId: 'b'.repeat(26),
			initialDestination: 'account'
		}
	);
	document.body.append(pane.element);
	const assign = (section: AccountSection): void => {
		pane.clear();
		const model: AccountModel = {
			section,
			item: {
				typeId: 'prctr.authenticated.account',
				logicalIdentity: section,
				presentation: { title: section, accessibleLabel: section },
				closable: false,
				restorable: false,
				onDidChangePresentation: Event.None,
				matches() {
					return false;
				}
			},
			dispose() {}
		};
		pane.setItem(model, CancellationToken.None);
		pane.setVisible(true);
	};
	const button = (text: string): HTMLButtonElement => {
		const button = [...pane.element.querySelectorAll('button')].find(
			(button) => button.textContent === text
		);
		if (!button) throw new Error(`Missing account action: ${text}`);
		return button;
	};
	const wait = async (predicate: () => boolean): Promise<void> => {
		for (let i = 0; i < 40; i++) {
			if (predicate()) return;
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		}
		throw new Error('Account view did not settle');
	};
	try {
		assign('profile');
		if (!pane.element.querySelector('[data-prctr-icon-modifier="spin"]'))
			throw new Error('Account loading has no animated Codicon');
		assign('sessions');
		await wait(() => pane.element.textContent!.includes('Browser on another computer'));
		delayed?.({
			kind: 'data',
			data: {
				section: 'profile',
				profile: {
					username: 'stale',
					displayName: 'Stale response',
					firstName: '',
					lastName: ''
				}
			}
		});
		await Promise.resolve();
		if (pane.element.textContent!.includes('Stale response'))
			throw new Error('Old account response replaced the selected section');
		button('End session').click();
		if (requests.some((intent) => intent.kind === 'revokeSession'))
			throw new Error('Session ended without confirmation');
		if (document.activeElement !== button('Cancel'))
			throw new Error('Confirmation must focus the safe action');
		button('Cancel').click();
		if (document.activeElement !== button('End session'))
			throw new Error('Cancel did not restore focus');
		button('End session').click();
		const confirm = pane.element.querySelector<HTMLButtonElement>(
			'[data-confirmation] button:last-child'
		);
		confirm?.click();
		await wait(() => pane.element.textContent!.includes('multi-factor authentication before'));
		if (requests.filter((intent) => intent.kind === 'revokeSession').length !== 1)
			throw new Error('Revocation should run exactly once');
		assign('security');
		await wait(() => pane.element.textContent!.includes('Password sign-in'));
		if (!pane.element.textContent!.includes('Not available'))
			throw new Error('Unavailable MFA was misrepresented as disabled');
		if (pane.element.querySelector('input'))
			throw new Error('Security credentials must stay in the browser');
		pane.element.style.width = '370px';
		pane.element.style.height = '400px';
		assign('profile');
		delayed?.({
			kind: 'data',
			data: {
				section: 'profile',
				profile: {
					username: 'a.long.user.name',
					displayName: 'Alexandra Montgomery',
					firstName: 'Alexandra',
					lastName: 'Montgomery',
					email: 'alexandra.montgomery@institution.example',
					emailVerified: true,
					locale: 'English',
					timezone: 'Europe/Paris'
				}
			}
		});
		await wait(() => pane.element.textContent!.includes('Alexandra Montgomery'));
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		const viewport = pane.element.querySelector<HTMLElement>('.prctr-account__viewport')!;
		if (viewport.scrollWidth > viewport.clientWidth + 1)
			throw new Error('Narrow account content overflows horizontally');
		if (!pane.element.textContent!.includes('Email verified'))
			throw new Error('Email verification must stay next to account details');
		assign('profile');
		pane.dispose();
		delayed?.({ kind: 'error', reason: 'unavailable' });
		await Promise.resolve();
		if (pane.element.isConnected) throw new Error('Disposed account pane remains attached');
	} finally {
		pane.dispose();
	}
}
