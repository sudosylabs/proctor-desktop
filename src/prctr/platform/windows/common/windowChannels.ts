import type { ChromeCapableProductWindowKind } from './windowChrome.js';
import type { ProductWindowKind } from './windowProtocol.js';

export const WINDOW_CHANNELS = Object.freeze({
	launch: Object.freeze({ bootstrap: 'prctr:launch:bootstrap', intent: 'prctr:launch:intent' }),
	authenticated: Object.freeze({
		bootstrap: 'prctr:authenticated:bootstrap',
		intent: 'prctr:authenticated:intent'
	}),
	candidate: Object.freeze({
		bootstrap: 'prctr:candidate:bootstrap',
		intent: 'prctr:candidate:intent'
	})
} satisfies Record<ProductWindowKind, { readonly bootstrap: string; readonly intent: string }>);

export const WINDOW_CHROME_CHANNELS = Object.freeze({
	launch: Object.freeze({
		configuration: 'prctr:launch:window-chrome:configuration',
		update: 'prctr:launch:window-chrome:update',
		fullscreenChanged: 'prctr:launch:window-chrome:fullscreen-changed'
	}),
	authenticated: Object.freeze({
		configuration: 'prctr:authenticated:window-chrome:configuration',
		update: 'prctr:authenticated:window-chrome:update',
		fullscreenChanged: 'prctr:authenticated:window-chrome:fullscreen-changed'
	})
} satisfies Record<
	ChromeCapableProductWindowKind,
	{
		readonly configuration: string;
		readonly update: string;
		readonly fullscreenChanged: string;
	}
>);

export const LAUNCH_IDENTITY_CHANNELS = Object.freeze({
	projection: 'prctr:launch:identity:projection',
	intent: 'prctr:launch:identity:intent',
	changed: 'prctr:launch:identity:changed'
});

export const CANDIDATE_BROWSER_CHANNELS = Object.freeze({
	projection: 'prctr:candidate:browser:projection',
	intent: 'prctr:candidate:browser:intent',
	surface: 'prctr:candidate:browser:surface',
	surfaceFocus: 'prctr:candidate:browser:surface-focus',
	changed: 'prctr:candidate:browser:changed',
	surfaceFocusChanged: 'prctr:candidate:browser:surface-focus-changed'
});
export const CANDIDATE_TERMINAL_CHANNELS = Object.freeze({
	projection: 'prctr:candidate:terminal:projection',
	intent: 'prctr:candidate:terminal:intent',
	changed: 'prctr:candidate:terminal:changed',
	output: 'prctr:candidate:terminal:output'
});
export const CANDIDATE_SECURITY_CHANNELS = Object.freeze({
	projection: 'prctr:candidate:security:projection',
	intent: 'prctr:candidate:security:intent',
	changed: 'prctr:candidate:security:changed'
});
export const AUTHENTICATED_SETTINGS_CHANNELS = Object.freeze({
	projection: 'prctr:authenticated:settings:projection',
	preview: 'prctr:authenticated:settings:preview',
	cancelPreview: 'prctr:authenticated:settings:cancel-preview',
	commit: 'prctr:authenticated:settings:commit',
	changed: 'prctr:authenticated:settings:changed'
});
