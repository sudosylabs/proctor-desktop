/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/** A tag name optionally followed by `#id` and `.class` parts, for example `button#save.primary`. */
export interface ElementDescription {
	readonly tag: string;
	readonly id?: string;
	readonly classes: readonly string[];
}

const DESCRIPTION = /^([\w-]+)?(?:#([\w-]+))?((?:\.[\w-]+)*)$/;

export function parseElementDescription(description: string): ElementDescription {
	const match = DESCRIPTION.exec(description);
	if (!match) throw new Error(`Malformed element description: ${description}`);
	const [, tag, id, classes] = match;
	return {
		tag: tag || 'div',
		...(id ? { id } : {}),
		classes: classes ? classes.slice(1).split('.') : []
	};
}
