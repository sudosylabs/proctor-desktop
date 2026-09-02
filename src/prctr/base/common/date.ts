/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port editor-core

import { Lazy } from './lazy.js';
import { LANGUAGE_DEFAULT } from './platform.js';

/** The complete exception-safe Intl constructor seam used by the admitted editor word classifier. */
export const safeIntl = {
	DateTimeFormat(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions): Lazy<Intl.DateTimeFormat> { return new Lazy(() => { try { return new Intl.DateTimeFormat(locales, options); } catch { return new Intl.DateTimeFormat(undefined, options); } }); },
	Collator(locales?: Intl.LocalesArgument, options?: Intl.CollatorOptions): Lazy<Intl.Collator> { return new Lazy(() => { try { return new Intl.Collator(locales, options); } catch { return new Intl.Collator(undefined, options); } }); },
	Segmenter(locales?: Intl.LocalesArgument, options?: Intl.SegmenterOptions): Lazy<Intl.Segmenter> { return new Lazy(() => { try { return new Intl.Segmenter(locales, options); } catch { return new Intl.Segmenter(undefined, options); } }); },
	Locale(tag: Intl.Locale | string, options?: Intl.LocaleOptions): Lazy<Intl.Locale> { return new Lazy(() => { try { return new Intl.Locale(tag, options); } catch { return new Intl.Locale(LANGUAGE_DEFAULT, options); } }); },
	NumberFormat(locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions): Lazy<Intl.NumberFormat> { return new Lazy(() => { try { return new Intl.NumberFormat(locales, options); } catch { return new Intl.NumberFormat(undefined, options); } }); }
};
