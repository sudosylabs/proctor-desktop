import { DisposableStore } from '../../../src/prctr/base/common/lifecycle.ts';
import {
	BrandLockup,
	type BrandLockupAppearance
} from '../../../src/prctr/workbench/browser/brandLockup.ts';
import type { ControlFixtureResult } from './manifest.ts';

export function brandLockupFixture(host: HTMLElement): ControlFixtureResult {
	const store = new DisposableStore();
	const appearances: readonly BrandLockupAppearance[] = ['light', 'dark', 'monochrome'];
	const lockups = appearances.map((appearance) =>
		store.add(new BrandLockup(host.ownerDocument, appearance))
	);
	for (const lockup of lockups) host.append(lockup.element);
	return {
		states: appearances.length,
		disposable: store,
		verify(): number {
			const lockups = host.querySelectorAll<HTMLElement>('.prctr-brand-lockup');
			if (lockups.length !== appearances.length)
				throw new Error('Brand lockup fixture did not render every appearance');
			for (const [index, appearance] of appearances.entries()) {
				const lockup = lockups[index];
				if (
					lockup?.dataset.appearance !== appearance ||
					lockup.getAttribute('aria-hidden') !== 'true' ||
					lockup.querySelector('img')?.alt !== ''
				)
					throw new Error(`Brand lockup ${appearance} lost its decorative contract`);
			}
			return appearances.length;
		}
	};
}
