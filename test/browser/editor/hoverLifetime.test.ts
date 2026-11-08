import {
	createInstantHoverDelegate,
	getDefaultHoverDelegate,
	setHoverDelegateFactory
} from '../../../src/prctr/base/browser/ui/hover/hoverDelegateFactory.js';
import {
	getBaseLayerHoverDelegate,
	setBaseLayerHoverDelegate
} from '../../../src/prctr/base/browser/ui/hover/hoverDelegate2.js';

function check(value: boolean, message: string): void {
	if (!value) throw new Error(message);
}

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
			check(
				getBaseLayerHoverDelegate() === (olderFirst ? b : a),
				'Hover teardown changed the wrong live service.'
			);
		} finally {
			first.dispose();
			second.dispose();
		}
		check(
			getBaseLayerHoverDelegate() === originalBase,
			'Hover teardown resurrected a disposed service.'
		);

		const delegate = (delay: number) => ({ delay, showHover: () => undefined, dispose() {} });
		const mouseA = delegate(10),
			mouseB = delegate(20);
		const bindingA = setHoverDelegateFactory(() => mouseA);
		const bindingB = setHoverDelegateFactory(() => mouseB);
		try {
			check(
				getDefaultHoverDelegate('mouse') === mouseB,
				'The newest default hover was not selected.'
			);
			(olderFirst ? bindingA : bindingB).dispose();
			check(
				createInstantHoverDelegate() === (olderFirst ? mouseB : mouseA),
				'Instant hover retained a disposed binding.'
			);
		} finally {
			bindingA.dispose();
			bindingB.dispose();
		}
		check(
			getDefaultHoverDelegate('element') === originalDefault,
			'Hover teardown resurrected a disposed factory.'
		);
	}
}
