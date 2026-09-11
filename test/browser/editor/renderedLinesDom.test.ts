import { createRenderedLinesFragment } from '../../../src/prctr/editor/browser/view/renderedLinesDom.js';
import {
	RenderLineInput,
	renderViewLine2
} from '../../../src/prctr/editor/common/viewLayout/viewLineRenderer.js';
import { LineTokens } from '../../../src/prctr/editor/common/tokens/lineTokens.js';
import { LanguageIdCodec } from '../../../src/prctr/editor/common/services/languagesRegistry.js';
import { LineDecoration } from '../../../src/prctr/editor/common/viewLayout/lineDecorations.js';
import { InlineDecorationType } from '../../../src/prctr/editor/common/viewModel/inlineDecorations.js';
import { TextDirection } from '../../../src/prctr/editor/common/model.js';

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

/** Compare the transferred parser with unmodified Chromium parsing of real pinned renderer output.
 * The isolated reference document alone permits style attributes. The application document keeps
 * its production style CSP, and the caller records every application CSP violation.
 */
export async function exerciseRenderedLinesDom(): Promise<void> {
	const frame = document.createElement('iframe');
	frame.style.width = '600px';
	frame.style.height = '360px';
	const loaded = new Promise<void>((resolve, reject) => {
		frame.onload = () => resolve();
		frame.onerror = () => reject(new Error('Renderer reference failed to load.'));
	});
	frame.src = './render-reference.html';
	document.body.appendChild(frame);
	const actual = document.body.appendChild(document.createElement('div'));
	try {
		await loaded;
		const referenceDocument = frame.contentDocument;
		assert(referenceDocument, 'Renderer reference is inaccessible.');
		const reference = referenceDocument.body.appendChild(
			referenceDocument.createElement('div')
		);
		for (const node of [actual, reference]) {
			node.style.cssText =
				'position:relative;width:520px;font:14px/20px monospace;white-space:pre;';
		}
		const codec = new LanguageIdCodec();
		const samples = [
			{ text: '<tag style="literal"> & \'quoted\'', rtl: false },
			{ text: 'left שלום مرحبا right', rtl: true },
			{ text: '\t  middle　界\t ', rtl: false },
			{ text: 'a\u0001b\u202ec', rtl: true },
			{ text: '  wrapped\tcontinuation  ', rtl: false, wrapped: true },
			{ text: '', rtl: false }
		];
		for (const [index, sample] of samples.entries()) {
			const input = new RenderLineInput(
				false,
				true,
				sample.text,
				sample.wrapped ?? false,
				!sample.rtl && /^[\x00-\x7f]*$/.test(sample.text),
				sample.rtl,
				sample.wrapped ? 2 : 0,
				LineTokens.createEmpty(sample.text, codec),
				sample.text.length
					? [
							new LineDecoration(
								1,
								2,
								'injected-before',
								InlineDecorationType.Before
							),
							new LineDecoration(
								2,
								sample.text.length + 1,
								'highlight',
								InlineDecorationType.Regular
							)
						]
					: [],
				4,
				sample.wrapped ? 4 : 0,
				8,
				7,
				8,
				-1,
				'all',
				true,
				false,
				null,
				sample.rtl ? TextDirection.RTL : null,
				14,
				true,
				true
			);
			const output = renderViewLine2(input);
			const html =
				'<div class="view-line" style="position:absolute;top:' +
				index * 24 +
				'px;height:24px;line-height:24px">' +
				output.html +
				'</div>';
			// These are the original replacement, sibling insertion and append sink operations.
			if (index === 0) {
				reference.innerHTML = html;
				actual.replaceChildren(createRenderedLinesFragment(document, html));
			} else if (index % 2) {
				reference.lastElementChild!.insertAdjacentHTML('afterend', html);
				actual.lastElementChild!.after(createRenderedLinesFragment(document, html));
			} else {
				reference.insertAdjacentHTML('beforeend', html);
				actual.appendChild(createRenderedLinesFragment(document, html));
			}
			const expectedLine = reference.lastElementChild!;
			const actualLine = actual.lastElementChild!;
			const snapshot = (root: Element): string => {
				const rect = root.getBoundingClientRect();
				const visit = (node: Node): unknown => {
					if (node.nodeType === Node.TEXT_NODE) return ['text', node.textContent];
					assert(node.nodeType === Node.ELEMENT_NODE, 'Unexpected renderer node type.');
					const element = node as HTMLElement;
					const style = element.ownerDocument.defaultView!.getComputedStyle(element);
					const bounds = element.getBoundingClientRect();
					return [
						element.tagName,
						Array.from(element.attributes, (a) => [
							a.name,
							a.name === 'style' ? element.style.cssText : a.value
						]).sort(),
						[style.direction, style.unicodeBidi, style.display, style.whiteSpace],
						[bounds.x - rect.x, bounds.y - rect.y, bounds.width, bounds.height],
						Array.from(element.childNodes, visit)
					];
				};
				return JSON.stringify(visit(root));
			};
			assert(
				snapshot(actualLine) === snapshot(expectedLine),
				'Rendered line structure, bidi or geometry changed for sample ' + index
			);
			// Screen readers use these text nodes and offsets; verify every source character mapping.
			for (let offset = 0; offset < sample.text.length; offset++) {
				const position = output.characterMapping.getDomPosition(offset);
				const read = (line: Element): string | undefined =>
					line.firstElementChild?.childNodes[position.partIndex]?.textContent?.slice(
						position.charIndex
					);
				assert(
					read(actualLine) === read(expectedLine),
					'Rendered text-node offset changed for sample ' + index + ':' + offset
				);
			}
		}
		assert(
			!actual.querySelector('[data-prctr-rendered-style]'),
			'Temporary rendered styles remain in live DOM.'
		);
	} finally {
		frame.remove();
		actual.remove();
	}
}
