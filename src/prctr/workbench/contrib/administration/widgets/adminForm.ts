/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import './media/adminForm.css';

let fieldSequence = 0;

/** One labelled form field in an Administration dialog, with an optional hint below it. */
export function adminField(
	host: HTMLElement,
	label: string,
	hint?: string
): { readonly element: HTMLElement; readonly id: string; readonly hint: HTMLElement } {
	const $ = createElementFactory(host.ownerDocument);
	const id = `prctr-admin-field-${++fieldSequence}`;
	const hintElement = $('p.prctr-admin-form__hint', {
		id: `${id}-hint`,
		textContent: hint ?? '',
		hidden: hint === undefined
	});
	const element = $(
		'div.prctr-admin-form',
		{},
		$('label.prctr-admin-form__label', { textContent: label, attrs: { for: id } })
	);
	host.append(element);
	return { element, id, hint: hintElement };
}

/** A multi-line text box for a form field. */
export function adminTextArea(
	field: { readonly element: HTMLElement; readonly id: string; readonly hint: HTMLElement },
	rows: number
): HTMLTextAreaElement {
	const $ = createElementFactory(field.element.ownerDocument);
	const area = $('textarea.prctr-admin-form__textarea', {
		id: field.id,
		attrs: { rows: String(rows), 'aria-describedby': field.hint.id }
	});
	field.element.append(area, field.hint);
	return area;
}
