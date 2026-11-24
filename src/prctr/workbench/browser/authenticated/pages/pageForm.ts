/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import './media/pageForm.css';

let fieldSequence = 0;

/** One labelled form field in a page dialog, with an optional hint below it. */
export function pageField(
	host: HTMLElement,
	label: string,
	hint?: string
): { readonly element: HTMLElement; readonly id: string; readonly hint: HTMLElement } {
	const $ = createElementFactory(host.ownerDocument);
	const id = `prctr-page-field-${++fieldSequence}`;
	const hintElement = $('p.prctr-page-form__hint', {
		id: `${id}-hint`,
		textContent: hint ?? '',
		hidden: hint === undefined
	});
	const element = $(
		'div.prctr-page-form',
		{},
		$('label.prctr-page-form__label', { textContent: label, attrs: { for: id } })
	);
	host.append(element);
	return { element, id, hint: hintElement };
}

/** A multi-line text box for a form field. */
export function pageTextArea(
	field: { readonly element: HTMLElement; readonly id: string; readonly hint: HTMLElement },
	rows: number
): HTMLTextAreaElement {
	const $ = createElementFactory(field.element.ownerDocument);
	const area = $('textarea.prctr-page-form__textarea', {
		id: field.id,
		attrs: { rows: String(rows), 'aria-describedby': field.hint.id }
	});
	field.element.append(area, field.hint);
	return area;
}
