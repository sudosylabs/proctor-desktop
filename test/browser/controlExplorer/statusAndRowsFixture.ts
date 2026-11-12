import { Event as Events } from '../../../src/prctr/base/common/event.ts';
import { DisposableStore } from '../../../src/prctr/base/common/lifecycle.ts';
import {
	createStatusBadge,
	type StatusBadgeTone
} from '../../../src/prctr/base/browser/ui/badge/statusBadge.ts';
import { MenuControl } from '../../../src/prctr/base/browser/ui/menu/menuControl.ts';
import { createRowMenuButton } from '../../../src/prctr/workbench/browser/authenticated/pages/rowMenuButton.ts';
import type { ControlFixtureResult } from './manifest.ts';

const tones: readonly [StatusBadgeTone, string][] = [
	['neutral', 'Pending'],
	['neutral', 'Current'],
	['attention', 'Expires in 6 days'],
	['failure', 'Bounced'],
	['safeguard', 'Verified'],
	['neutral', 'Transferring out of Computer Science']
];

/**
 * Status words in every meaning, the longest word kept whole, and the row "⋯" that opens its
 * actions with the destructive one last.
 */
export function statusAndRowsFixture(host: HTMLElement): ControlFixtureResult {
	const store = new DisposableStore();
	const document = host.ownerDocument;
	const badges = document.createElement('div');
	badges.dataset.stateGroup = 'status-badges';
	badges.style.display = 'flex';
	badges.style.flexWrap = 'wrap';
	badges.style.gap = '8px';
	for (const [tone, text] of tones) badges.append(createStatusBadge(document, { text, tone }));
	const row = document.createElement('div');
	row.dataset.stateGroup = 'row-menu';
	row.style.position = 'relative';
	host.append(badges, row);
	const menu = store.add(
		new MenuControl(row, {
			canInteract: () => true,
			onDidChangeInteraction: Events.None,
			restoreFocus: () => undefined,
			onActionError: () => undefined
		})
	);
	const ran: string[] = [];
	const button = createRowMenuButton(store, menu, document, {
		label: 'Actions for Hannah Lee',
		className: 'prctr-fixture-row__more',
		actions: [
			{
				label: 'Disable account…',
				icon: 'action.end',
				destructive: true,
				run: () => ran.push('disable')
			},
			{ label: 'Open profile', icon: 'action.openExternal', run: () => ran.push('open') }
		]
	});
	row.append(button);
	return {
		states: tones.length + 1,
		disposable: {
			dispose: () => {
				store.dispose();
				host.replaceChildren();
			}
		},
		verify(): number {
			const rendered = [...badges.querySelectorAll<HTMLElement>('.prctr-status-badge')];
			if (rendered.length !== tones.length) throw new Error('Every status meaning renders');
			const ink = (element: HTMLElement) => getComputedStyle(element).color;
			const neutral = ink(rendered[0]!);
			for (const [index, [tone]] of tones.entries()) {
				const badge = rendered[index]!;
				if (badge.dataset.tone !== tone) throw new Error(`Badge ${index} lost its meaning`);
				if (badge.querySelector('svg, img'))
					throw new Error('A status badge is a word, never an icon');
				if (tone !== 'neutral' && ink(badge) === neutral)
					throw new Error(`A ${tone} badge must not look neutral`);
				if (badge.scrollWidth > badge.clientWidth + 1)
					throw new Error('A status word is never cut');
			}
			if (
				button.getAttribute('aria-haspopup') !== 'menu' ||
				button.getAttribute('aria-label') !== 'Actions for Hannah Lee' ||
				getComputedStyle(button).visibility !== 'visible'
			)
				throw new Error('The row menu button is always visible and named');
			button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
			if (!menu.visible || button.getAttribute('aria-expanded') !== 'true')
				throw new Error('Arrow Down opens the row menu');
			const items = [...row.ownerDocument.querySelectorAll<HTMLElement>('[role="menuitem"]')];
			if (items.at(-1)?.textContent?.includes('Disable') !== true)
				throw new Error('A destructive action comes last');
			menu.hide();
			if (button.getAttribute('aria-expanded') !== 'false')
				throw new Error('Closing the menu collapses the button');
			return tones.length + 1;
		}
	};
}
