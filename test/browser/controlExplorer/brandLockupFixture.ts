import { DisposableStore } from '../../../src/prctr/base/common/lifecycle.ts';
import {
	BrandLockup,
	brandLockupAppearance
} from '../../../src/prctr/workbench/browser/brandLockup.ts';
import { getThemes } from '../../../src/prctr/platform/theme/common/themes.ts';
import type { ControlFixtureResult } from './manifest.ts';

export function brandLockupFixture(host: HTMLElement): ControlFixtureResult {
	const store = new DisposableStore();
	const appearances = getThemes().map(brandLockupAppearance);
	const lockups = appearances.map((appearance) =>
		store.add(new BrandLockup(host.ownerDocument, appearance))
	);
	for (const lockup of lockups) host.append(lockup.element);
	return {
		states: appearances.length,
		disposable: store,
		async verify(): Promise<number> {
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
				const image = lockup.querySelector('img')!;
				await image.decode();
				if (
					!image.src.includes(`proctor-lockup-vertical-25d-${appearance}`) ||
					image.naturalWidth / image.naturalHeight !== 4 / 3
				)
					throw new Error(
						`Brand lockup ${appearance} must preserve the supplied vertical artwork`
					);
			}
			return appearances.length;
		}
	};
}
