import { ActionBar } from '../../../src/prctr/base/browser/ui/actionbar/actionbar.js';
import { createInstantHoverDelegate, getDefaultHoverDelegate, setHoverDelegateFactory } from '../../../src/prctr/base/browser/ui/hover/hoverDelegateFactory.js';
import { getBaseLayerHoverDelegate, setBaseLayerHoverDelegate } from '../../../src/prctr/base/browser/ui/hover/hoverDelegate2.js';
import { setDisposableTracker } from '../../../src/prctr/base/common/lifecycle.js';
import { WorkbenchHoverDelegate } from '../../../src/prctr/platform/hover/browser/hover.js';

function check(value: boolean, message: string): void { if (!value) throw new Error(message); }

export function exerciseHoverBindingLifetime(): void {
	const originalBase = getBaseLayerHoverDelegate();
	const originalDefault = getDefaultHoverDelegate('element');
	for (const olderFirst of [false, true]) {
		const a = { ...originalBase };
		const b = { ...originalBase };
		const first = setBaseLayerHoverDelegate(a);
		const second = setBaseLayerHoverDelegate(b);
		try {
			check(getBaseLayerHoverDelegate() === b, 'The newest hover service was not selected.');
			(olderFirst ? first : second).dispose();
			check(getBaseLayerHoverDelegate() === (olderFirst ? b : a), 'Hover teardown changed the wrong live service.');
		} finally { first.dispose(); second.dispose(); }
		check(getBaseLayerHoverDelegate() === originalBase, 'Hover teardown resurrected a disposed service.');

		const delegate = (delay: number) => ({ delay, showHover: () => undefined, dispose() {} });
		const mouseA = delegate(10), mouseB = delegate(20);
		const bindingA = setHoverDelegateFactory(() => mouseA);
		const bindingB = setHoverDelegateFactory(() => mouseB);
		try {
			check(getDefaultHoverDelegate('mouse') === mouseB, 'The newest default hover was not selected.');
			(olderFirst ? bindingA : bindingB).dispose();
			check(createInstantHoverDelegate() === (olderFirst ? mouseB : mouseA), 'Instant hover retained a disposed binding.');
		} finally { bindingA.dispose(); bindingB.dispose(); }
		check(getDefaultHoverDelegate('element') === originalDefault, 'Hover teardown resurrected a disposed factory.');
	}
}

/** Repeated source control lifecycles must not leave delegates owned by the window. */
export function exerciseInstantHoverOwnership(host: HTMLElement): void {
	const parents = new Map<WorkbenchHoverDelegate, number>();
	const disposed = new Set<WorkbenchHoverDelegate>();
	setDisposableTracker({
		trackDisposable() {}, markAsSingleton() {},
		setParent(child, parent) {
			if (child instanceof WorkbenchHoverDelegate && parent) parents.set(child, (parents.get(child) ?? 0) + 1);
		},
		markAsDisposed(value) { if (value instanceof WorkbenchHoverDelegate) disposed.add(value); }
	});
	try {
		for (let index = 0; index < 3; index++) {
			const container = host.appendChild(host.ownerDocument.createElement('div'));
			try { new ActionBar(container).dispose(); } finally { container.remove(); }
		}
		check(parents.size === 3 && [...parents.values()].every(count => count === 1), 'An instant hover delegate was retained by both the window and its control.');
		check([...parents.keys()].every(value => disposed.has(value)), 'A disposed control retained its instant hover delegate.');
	} finally { setDisposableTracker(null); }
}
