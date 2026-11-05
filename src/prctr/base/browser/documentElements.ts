/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { parseElementDescription } from '../common/elementDescription.js';

type TagOf<TDescription extends string> = TDescription extends `${infer TTag}#${string}`
	? TTag
	: TDescription extends `${infer TTag}.${string}`
		? TTag
		: TDescription;

type ElementOf<TDescription extends string> =
	TagOf<TDescription> extends keyof HTMLElementTagNameMap
		? HTMLElementTagNameMap[TagOf<TDescription>]
		: HTMLElement;

/** Properties assigned directly, plus `data` for `dataset` entries and `attrs` for named attributes. */
export type ElementProperties<TElement extends HTMLElement> = {
	readonly [TKey in Exclude<keyof TElement, 'dataset' | 'attributes'>]?: TElement[TKey];
} & {
	readonly data?: Readonly<Record<string, string>>;
	readonly attrs?: Readonly<Record<string, string>>;
};

export type ElementChild = Node | string;

/** Creates elements owned by one document, which may belong to a different window than the caller. */
export interface ElementFactory {
	<const TDescription extends string>(
		description: TDescription,
		properties?: ElementProperties<ElementOf<TDescription>>,
		...children: readonly ElementChild[]
	): ElementOf<TDescription>;
}

/**
 * Binds element creation to `document`. Contributions receive the document of the window they
 * render into, so the global document must not be used to build their DOM.
 */
export function createElementFactory(document: Document): ElementFactory {
	return (description, properties, ...children) => {
		const parsed = parseElementDescription(description);
		const element = document.createElement(parsed.tag);
		if (parsed.id) element.id = parsed.id;
		if (parsed.classes.length > 0) element.className = parsed.classes.join(' ');
		if (properties) {
			const { data, attrs, ...assignable } = properties;
			Object.assign(element, assignable);
			if (data) Object.assign(element.dataset, data);
			if (attrs)
				for (const [name, value] of Object.entries(attrs))
					element.setAttribute(name, value);
		}
		element.append(...children);
		return element as ElementOf<typeof description>;
	};
}
