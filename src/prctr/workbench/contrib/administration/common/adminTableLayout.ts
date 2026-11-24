/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * What an Administration status means, as the status badge shows it: red when something went
 * wrong, amber when it waits on you or lapses soon, the accent while Proctor is still working on
 * it (checking or importing), grey for everything else. Administration never shows green: a
 * safeguard is green only on your own account.
 */
export type AdminTone = 'failure' | 'attention' | 'progress' | 'neutral';

/** How one Administration table column behaves as the table narrows. */
export interface AdminColumnLayout {
	readonly label: string;
	/** A share of the table, as in "30%", or a fixed width, as in "120px". */
	readonly width?: string;
	readonly align?: 'start' | 'end' | 'center';
	/**
	 * 1 never folds; 2 folds into the first column's second line below 680 pixels, 3 below
	 * 820 pixels and 4 below 960 pixels.
	 */
	readonly priority?: 1 | 2 | 3 | 4;
	/** The narrowest the column may be before the table scrolls sideways. */
	readonly min?: number;
	/** Long text wraps instead of ending in "…". */
	readonly wrap?: boolean;
	/** A folded value is labelled, as in "Expires 12 Nov"; dates and counts always are. */
	readonly foldLabel?: boolean;
}

/** Below these widths a column of that priority folds. */
export const ADMIN_FOLD_BELOW: Readonly<Record<1 | 2 | 3 | 4, number>> = {
	1: 0,
	2: 680,
	3: 820,
	4: 960
};
/** The narrowest a column of each kind may be when it names no minimum. */
export const ADMIN_CELL_MIN: Readonly<Record<string, number>> = {
	person: 240,
	text: 140,
	mono: 120,
	status: 120,
	check: 80,
	button: 104,
	empty: 44
};
/** The checkbox and "⋯" columns. */
export const ADMIN_EDGE_COLUMN = 44;

export interface AdminTablePlan {
	/** Columns folded into {@link foldInto}, by index. */
	readonly hidden: readonly number[];
	/** Each column's width, when it keeps one. */
	readonly widths: readonly (string | undefined)[];
	/** The narrowest the table may be; wider than the space, it scrolls sideways. */
	readonly minimum: number;
	/** The first column shown; it opens the row and stays pinned while the table scrolls. */
	readonly first: number;
	/** The column whose second line takes the folded values. */
	readonly foldInto: number;
}

/**
 * Which columns a table of `width` pixels shows. Lesser columns fold first; the others keep
 * their widths, and a column without one takes the space freed. When the minimum
 * widths of what is left still exceed the table, the first column keeps its minimum and the
 * table scrolls.
 */
export function foldColumns(
	columns: readonly AdminColumnLayout[],
	kinds: readonly string[],
	width: number,
	edges: { readonly select?: boolean; readonly more?: boolean } = {}
): AdminTablePlan {
	const hidden: number[] = [];
	const mins = columns.map((column, index) => {
		if (column.min !== undefined) return column.min;
		const fixed = column.width?.endsWith('px') ? Number.parseInt(column.width, 10) : 0;
		return fixed || (ADMIN_CELL_MIN[kinds[index] ?? 'text'] ?? ADMIN_CELL_MIN.text!);
	});
	columns.forEach((column, index) => {
		if (width < ADMIN_FOLD_BELOW[column.priority ?? 1]) hidden.push(index);
	});
	const shown = columns.map((_, index) => index).filter((index) => !hidden.includes(index));
	const first = shown[0] ?? 0;
	const foldInto =
		shown.find((index) => kinds[index] === 'person' || kinds[index] === 'text') ?? first;
	const minimum =
		shown.reduce((sum, index) => sum + mins[index]!, 0) +
		(edges.select === true ? ADMIN_EDGE_COLUMN : 0) +
		(edges.more === true ? ADMIN_EDGE_COLUMN : 0);
	const overflows = minimum > width;
	// Shown columns keep their widths; the column without one takes what folding frees.
	const widths = columns.map((column, index) =>
		overflows && index === first ? `${mins[index]}px` : column.width
	);
	return { hidden, widths, minimum, first, foldInto };
}
