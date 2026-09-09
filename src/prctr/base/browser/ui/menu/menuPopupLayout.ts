import {
	AnchorAlignment,
	AnchorPosition,
	LayoutAnchorMode,
	LayoutAnchorPosition,
	layout,
	layout2d
} from '../../../common/layout.js';

/** Translate window rectangles into the popup owner's CSS coordinates, including zoom. */
export function layoutMenuPopup(
	host: HTMLElement,
	popup: HTMLElement,
	target: HTMLElement,
	above: boolean,
	avoid: HTMLElement = target
): void {
	const bounds = host.getBoundingClientRect();
	const scaleX = bounds.width / host.clientWidth || 1;
	const scaleY = bounds.height / host.clientHeight || 1;
	const margin = 8;
	const gap = 4;
	const viewport = {
		top: 0,
		left: 0,
		width: Math.max(0, host.clientWidth - margin * 2),
		height: Math.max(0, host.clientHeight - margin * 2)
	};
	const rect = avoid.getBoundingClientRect();
	const anchor = {
		top: (rect.top - bounds.top) / scaleY - margin - gap,
		left: (rect.left - bounds.left) / scaleX - margin,
		width: rect.width / scaleX,
		height: rect.height / scaleY + gap * 2
	};
	const view = { width: popup.offsetWidth, height: popup.offsetHeight };
	const position = layout2d(viewport, view, anchor, {
		anchorPosition: above ? AnchorPosition.ABOVE : AnchorPosition.BELOW,
		anchorAlignment:
			host.ownerDocument.documentElement.dir === 'rtl'
				? AnchorAlignment.RIGHT
				: AnchorAlignment.LEFT
	});
	// Hovers avoid covering the anchor surface, while staying horizontally
	// aligned with the actual control. Keep the upstream side fallback when neither
	// vertical side fits, instead of clamping the popup back over the surface.
	if (position.top + view.height <= anchor.top || position.top >= anchor.top + anchor.height) {
		const control = target.getBoundingClientRect();
		position.left = layout(viewport.width, view.width, {
			offset: (control.left - bounds.left) / scaleX - margin,
			size: control.width / scaleX,
			mode: LayoutAnchorMode.ALIGN,
			position:
				host.ownerDocument.documentElement.dir === 'rtl'
					? LayoutAnchorPosition.After
					: LayoutAnchorPosition.Before
		}).position;
	}
	popup.style.left = `${position.left + margin}px`;
	popup.style.top = `${position.top + margin}px`;
}
