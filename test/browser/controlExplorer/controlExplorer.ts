import { DisposableStore } from '../../../src/prctr/base/common/lifecycle.ts';
import { BrowserThemeService } from '../../../src/prctr/platform/theme/browser/themeService.ts';
import type { ThemeId } from '../../../src/prctr/platform/theme/common/themes.ts';
import { controlExplorerFixtures } from './manifest.ts';

export interface ControlExplorerResult {
	readonly fixtures: number;
	readonly states: number;
	readonly interactions: number;
	readonly themes: number;
}

export async function runControlExplorer(parent: HTMLElement): Promise<ControlExplorerResult> {
	const iframe = parent.ownerDocument.createElement('iframe');
	iframe.className = 'prctr-control-explorer-frame';
	iframe.title = 'Control Explorer fixtures';
	iframe.width = '640';
	iframe.height = '720';
	iframe.src = 'controlExplorerFrame.html';
	parent.append(iframe);
	await new Promise<void>((resolve, reject) => {
		iframe.addEventListener('load', () => resolve(), { once: true });
		iframe.addEventListener(
			'error',
			() => reject(new Error('Control Explorer frame failed to load')),
			{ once: true }
		);
	});
	const document = iframe.contentDocument;
	if (document === null) throw new Error('Control Explorer requires a same-origin frame');
	const store = new DisposableStore();
	let states = 0;
	let interactions = 0;
	for (const fixture of controlExplorerFixtures) {
		const section = document.createElement('section');
		section.dataset.fixture = fixture.id;
		const heading = document.createElement('h2');
		heading.textContent = fixture.title;
		section.append(heading);
		document.body.append(section);
		const result = fixture.mount(section);
		store.add(result.disposable);
		states += result.states;
		interactions += await result.verify();
	}
	const themes: readonly ThemeId[] = ['light', 'dark', 'highContrastLight', 'highContrastDark'];
	const themeService = store.add(
		new BrowserThemeService(document, 'light', {
			density: 'default',
			motion: 'reduced',
			transparency: 'reduced'
		})
	);
	for (const theme of themes) {
		themeService.setTheme(theme);
		if (document.documentElement.dataset.prctrTheme !== theme)
			throw new Error(`Control Explorer failed to apply ${theme}`);
	}
	document.documentElement.dir = 'rtl';
	document.documentElement.lang = 'ar';
	document.documentElement.style.fontSize = '200%';
	document.body.style.inlineSize = '20rem';
	if (document.body.scrollWidth > document.body.clientWidth)
		throw new Error('Control Explorer controls overflow at 200% text scaling');
	document.documentElement.style.fontSize = '';
	document.body.style.inlineSize = '';
	document.documentElement.dir = 'ltr';
	document.documentElement.lang = 'en';
	const result = Object.freeze({
		fixtures: controlExplorerFixtures.length,
		states,
		interactions,
		themes: themes.length
	});
	store.dispose();
	if (
		document.querySelector(
			'.prctr-brand-lockup,.prctr-button,.prctr-text-field,.prctr-toggle,.prctr-progress'
		) !== null
	)
		throw new Error('Control fixture disposal left owned DOM behind');
	iframe.remove();
	return result;
}
