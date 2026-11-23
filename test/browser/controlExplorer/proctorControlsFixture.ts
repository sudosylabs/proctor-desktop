import { DisposableStore } from '../../../src/prctr/base/common/lifecycle.ts';
import {
	ButtonControl,
	type ButtonVariant
} from '../../../src/prctr/base/browser/ui/button/buttonControl.ts';
import { SegmentedControl } from '../../../src/prctr/base/browser/ui/segmented/segmentedControl.ts';
import { SwitchControl } from '../../../src/prctr/base/browser/ui/switch/switchControl.ts';
import { StepperControl } from '../../../src/prctr/base/browser/ui/stepper/stepperControl.ts';
import { SelectControl } from '../../../src/prctr/base/browser/ui/select/selectControl.ts';
import { BannerControl } from '../../../src/prctr/base/browser/ui/banner/bannerControl.ts';
import { ToastHost } from '../../../src/prctr/base/browser/ui/toast/toastHost.ts';
import { proctorIconFactory } from '../../../src/prctr/platform/theme/browser/proctorIcon.ts';
import type { ControlFixtureResult } from './manifest.ts';

/** Proctor's own controls for LaunchWindow and AuthenticatedWindow, in every kind and state. */
export function proctorControlsFixture(host: HTMLElement): ControlFixtureResult {
	const store = new DisposableStore();
	const document = host.ownerDocument;
	const group = (name: string): HTMLElement => {
		const section = document.createElement('div');
		section.dataset.stateGroup = name;
		section.style.position = 'relative';
		section.style.display = 'flex';
		section.style.flexWrap = 'wrap';
		section.style.gap = '8px';
		host.append(section);
		return section;
	};
	const buttons = group('proctor-buttons');
	const kinds: readonly [ButtonVariant, string][] = [
		['brand', 'New token'],
		['secondary', 'Change photo'],
		['ghost', 'Remove'],
		['danger', 'Revoke token'],
		['dangerGhost', 'End all other sessions']
	];
	for (const [variant, label] of kinds) {
		store.add(
			new ButtonControl(buttons, { variant, label, icon: proctorIconFactory('action.add') })
		);
		store.add(
			new ButtonControl(buttons, {
				variant,
				size: 'small',
				label,
				icon: proctorIconFactory('action.add', 14)
			})
		);
	}
	const busy = store.add(
		new ButtonControl(buttons, {
			variant: 'danger',
			label: 'Ending session…',
			busy: true,
			icon: proctorIconFactory('action.end')
		})
	);
	// An action the account can't take yet keeps its label and adds a decorative lock; its
	// accessible name says why.
	const locked = store.add(
		new ButtonControl(buttons, {
			variant: 'secondary',
			label: 'Reset two-step',
			icon: proctorIconFactory('account.security'),
			trailingIcon: proctorIconFactory('status.locked', 14),
			accessibleLabel: 'Reset two-step, needs two-step verification on your account'
		})
	);
	const choices = group('proctor-choices');
	const segmented = store.add(
		new SegmentedControl(choices, {
			label: 'Window theme',
			value: 'light',
			options: [
				{ value: 'system', label: 'System', icon: proctorIconFactory('theme.system', 14) },
				{ value: 'light', label: 'Light', icon: proctorIconFactory('theme.light', 14) },
				{ value: 'dark', label: 'Dark', icon: proctorIconFactory('theme.dark', 14) }
			]
		})
	);
	const toggle = store.add(new SwitchControl(choices, { label: 'Minimap', on: true }));
	store.add(new SwitchControl(choices, { label: 'High contrast', on: false, disabled: true }));
	const stepper = store.add(
		new StepperControl(choices, {
			label: 'Font size',
			value: 14,
			minimum: 12,
			maximum: 24,
			format: (value) => `${value} px`,
			decreaseLabel: 'Smaller',
			increaseLabel: 'Larger',
			decreaseIcon: proctorIconFactory('action.decrease', 12),
			increaseIcon: proctorIconFactory('action.increase', 12)
		})
	);
	store.add(
		new SelectControl(choices, {
			label: 'Limit to',
			value: 'all',
			choices: [
				{ value: 'all', label: 'Whole institution' },
				{ value: 'cs', label: 'Computer Science' }
			],
			icon: proctorIconFactory('object.institution', 14),
			caret: proctorIconFactory('action.expand', 14)
		})
	);
	const feedback = group('proctor-feedback');
	const banner = store.add(new BannerControl(feedback));
	banner.show({
		tone: 'neutral',
		icon: proctorIconFactory('status.offline', 18),
		text: 'You’re offline. Changes wait until Proctor reconnects.'
	});
	const toasts = store.add(
		new ToastHost(feedback, {
			dismissLabel: 'Dismiss',
			dismissIcon: proctorIconFactory('action.close', 14)
		})
	);
	toasts.show({
		tone: 'failure',
		icon: proctorIconFactory('status.attention', 18),
		title: 'Couldn’t end the session',
		body: 'Northbridge University didn’t answer.',
		action: { label: 'Try again', icon: proctorIconFactory('action.retry', 14), run: () => {} }
	});
	feedback.style.minBlockSize = '120px';
	const changes: string[] = [];
	store.add(segmented.onDidChange((value) => changes.push(`theme:${value}`)));
	store.add(toggle.onDidChange((on) => changes.push(`minimap:${on}`)));
	store.add(stepper.onDidChange((value) => changes.push(`font:${value}`)));
	return {
		states: 19,
		disposable: {
			dispose: () => {
				store.dispose();
				for (const section of host.querySelectorAll('[data-state-group^="proctor-"]'))
					section.remove();
			}
		},
		verify(): number {
			if (!busy.element.disabled || busy.element.getAttribute('aria-busy') !== 'true')
				throw new Error('A busy button must be unavailable and say so');
			segmented.focus();
			segmented.element.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
			);
			toggle.element.click();
			const value = host.querySelector<HTMLElement>('[role="spinbutton"]')!;
			value.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
			value.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
			if (changes.join() !== 'theme:dark,minimap:false,font:15,font:24')
				throw new Error(`Control changes were ${changes.join()}`);
			if (segmented.element.querySelectorAll('[tabindex="0"]').length !== 1)
				throw new Error('Exactly one segment is in the tab order');
			if (toggle.element.getAttribute('aria-checked') !== 'false')
				throw new Error('The switch reports its state');
			if (!host.querySelector('[role="alert"].prctr-toast'))
				throw new Error('A failure toast is announced');
			if (host.querySelector('.prctr-icon svg path[d]') === null)
				throw new Error('Proctor icons render as inline SVG');
			const lock = locked.element.querySelector('.prctr-button__trailing');
			if (
				lock?.getAttribute('aria-hidden') !== 'true' ||
				locked.element.getAttribute('aria-label')?.includes('two-step verification') !==
					true
			)
				throw new Error('A locked action hides its lock and names why');
			return 7;
		}
	};
}
