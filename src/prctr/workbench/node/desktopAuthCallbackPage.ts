/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See docs/upstream/licenses/vscode-MIT.txt.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port desktop-authorization

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineMessage, type LocalizationContext } from '../../base/common/localization.js';
import { getTheme, type ThemeId } from '../../platform/theme/common/themes.js';
import { asCssVariableName, type DesignTokenId } from '../../platform/theme/common/tokens.js';
import type { LoopbackCallbackPages } from '../../platform/identity/node/loopbackAuthServer.js';
import stylesheet from './desktopAuthCallbackPage.css';

export const callbackPageMessages = {
	receivedTitle: defineMessage({
		id: 'identity.callback.received.title',
		defaultMessage: 'Continue in Proctor',
		description: 'Callback received; Desktop still verifies the Session.'
	}),
	receivedSubtitle: defineMessage({
		id: 'identity.callback.received.subtitle',
		defaultMessage: 'Your browser step is complete.',
		description: 'The browser has delivered the one-use callback to Desktop.'
	}),
	receivedDetail: defineMessage({
		id: 'identity.callback.received.detail',
		defaultMessage: 'You can close this tab.',
		description: 'No more browser interaction is needed.'
	}),
	invalidTitle: defineMessage({
		id: 'identity.callback.invalid.title',
		defaultMessage: 'Unable to continue',
		description: 'Invalid sign-in callback heading.'
	}),
	invalidSubtitle: defineMessage({
		id: 'identity.callback.invalid.subtitle',
		defaultMessage: 'This sign-in link could not be verified.',
		description: 'Safe callback failure, without echoing input.'
	}),
	retryDetail: defineMessage({
		id: 'identity.callback.retry.detail',
		defaultMessage: 'Return to Proctor and sign in again.',
		description: 'Fresh interactive sign-in is required.'
	}),
	expiredTitle: defineMessage({
		id: 'identity.callback.expired.title',
		defaultMessage: 'This sign-in link is no longer active',
		description: 'An already consumed callback cannot be used again.'
	}),
	expiredSubtitle: defineMessage({
		id: 'identity.callback.expired.subtitle',
		defaultMessage: 'Return to Proctor to check your sign-in.',
		description: 'The app owns the final Session outcome, including a completed sign-in.'
	})
};

/** A self-contained page: no requests can race the short-lived callback listener's shutdown. */
export function createDesktopAuthCallbackPages(
	localization: LocalizationContext,
	brandingDirectory: string,
	themeId: ThemeId = 'dark'
): LoopbackCallbackPages {
	const theme = getTheme(themeId);
	const tokens = Object.entries(theme.values)
		.map(([id, value]) => `${asCssVariableName(id as DesignTokenId)}:${value};`)
		.join('');
	const css = `@layer theme { .prctr-auth-callback {${tokens}color-scheme:${theme.isDark ? 'dark' : 'light'};} }\n${stylesheet}`;
	const styleHash = createHash('sha256').update(css).digest('base64');
	const asset = readFileSync(
		join(
			brandingDirectory,
			`proctor-lockup-vertical-25d-${theme.isDark ? 'dark' : 'light'}.svg`
		)
	);
	const image = `data:image/svg+xml;base64,${asset.toString('base64')}`;
	const render = (title: string, subtitle: string, detail: string): string => `<!DOCTYPE html>
<html lang="${escapeHtml(localization.locale)}" dir="${localization.direction}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)} — Proctor</title><style>${css}</style></head>
<body class="prctr-auth-callback" data-prctr-theme="${themeId}">
<main class="prctr-auth-callback__container"><div class="prctr-auth-callback__content">
<div class="prctr-auth-callback__icon-container"><img src="${image}" class="prctr-auth-callback__icon" width="768" height="576" alt="" aria-hidden="true"></div>
<h1 class="prctr-auth-callback__title">${escapeHtml(title)}</h1>
<div class="prctr-auth-callback__message"><p class="prctr-auth-callback__subtitle">${escapeHtml(subtitle)}</p><p class="prctr-auth-callback__detail">${escapeHtml(detail)}</p></div>
</div></main></body></html>`;
	const text = (key: keyof typeof callbackPageMessages): string =>
		localization.format(callbackPageMessages[key]);
	return Object.freeze({
		styleHash,
		received: render(text('receivedTitle'), text('receivedSubtitle'), text('receivedDetail')),
		invalid: render(text('invalidTitle'), text('invalidSubtitle'), text('retryDetail')),
		expired: render(text('expiredTitle'), text('expiredSubtitle'), text('receivedDetail'))
	});
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
