import { DisposableStore } from '../../../src/prctr/base/common/lifecycle.ts';
import { ButtonControl } from '../../../src/prctr/base/browser/ui/button/buttonControl.ts';
import { TextFieldControl } from '../../../src/prctr/base/browser/ui/field/textField.ts';
import { ToggleControl } from '../../../src/prctr/base/browser/ui/toggle/toggleControl.ts';
import { ProgressControl } from '../../../src/prctr/base/browser/ui/progress/progress.ts';
import { createSemanticIcon } from '../../../src/prctr/platform/theme/browser/semanticIcon.ts';
import type { ControlFixtureResult } from './manifest.ts';

export function controlsFixture(host: HTMLElement): ControlFixtureResult {
	const store = new DisposableStore();
	const document = host.ownerDocument;
	const group = (name: string): HTMLElement => {
		const section = document.createElement('div');
		section.dataset.stateGroup = name;
		host.append(section);
		return section;
	};
	const buttons = group('buttons');
	const primary = store.add(
		new ButtonControl(buttons, {
			variant: 'primary',
			label: 'Continue',
			icon: (document) => createSemanticIcon(document, { id: 'action.save' })
		})
	);
	store.add(new ButtonControl(buttons, { variant: 'secondary', label: 'Change server' }));
	for (const variant of ['primary', 'secondary'] as const) {
		store.add(
			new ButtonControl(buttons, {
				variant,
				size: 'large',
				label: variant === 'primary' ? 'Sign in' : 'Change server'
			})
		);
	}
	const disabled = store.add(
		new ButtonControl(buttons, {
			variant: 'secondary',
			label: 'Unavailable action',
			disabled: true
		})
	);
	store.add(new ButtonControl(buttons, { variant: 'danger', label: 'End participation' }));
	store.add(
		new ButtonControl(buttons, { variant: 'primary', label: 'Checking readiness', busy: true })
	);
	const fields = group('fields');
	store.add(
		new TextFieldControl(fields, {
			label: 'Proctor Server',
			description: 'Enter the address supplied by your Institution.',
			value: 'https://exam.example.edu'
		})
	);
	store.add(
		new TextFieldControl(fields, {
			label: 'Proctor Server',
			value: 'invalid',
			error: 'Enter a valid secure Proctor Server address.'
		})
	);
	store.add(
		new TextFieldControl(fields, {
			label: 'Assigned Institution',
			value: 'Example University',
			readOnly: true
		})
	);
	store.add(
		new TextFieldControl(fields, {
			label: 'Proctor Server',
			value: '',
			unavailable: true,
			unavailableMessage: 'Server selection is unavailable while checking compatibility.'
		})
	);
	const toggles = group('toggles');
	const toggle = store.add(
		new ToggleControl(toggles, {
			label: 'Reduce motion',
			description: 'Reduce nonessential interface animation.',
			checked: false
		})
	);
	store.add(
		new ToggleControl(toggles, { label: 'High contrast', checked: true, disabled: true })
	);
	store.add(
		new ToggleControl(toggles, {
			label: 'Screen reader mode',
			checked: true,
			readOnly: true,
			readOnlyMessage: 'Read only during an Exam Attempt.'
		})
	);
	const progress = group('progress');
	store.add(
		new ProgressControl(progress, {
			kind: 'determinate',
			label: 'Workspace synchronized',
			value: 7,
			maximum: 10
		})
	);
	store.add(
		new ProgressControl(progress, {
			kind: 'indeterminate',
			label: 'Checking secure exam readiness'
		})
	);
	let primaryRequests = 0;
	let disabledRequests = 0;
	let toggleRequests = 0;
	store.add(primary.onDidRequest(() => primaryRequests++));
	store.add(disabled.onDidRequest(() => disabledRequests++));
	store.add(toggle.onDidRequestChange(() => toggleRequests++));
	return {
		states: 15,
		disposable: {
			dispose: () => {
				store.dispose();
				for (const section of host.querySelectorAll('[data-state-group]')) section.remove();
			}
		},
		verify(): number {
			primary.element.click();
			disabled.element.click();
			toggle.input.click();
			if (primaryRequests !== 1 || disabledRequests !== 0 || toggleRequests !== 1)
				throw new Error('Shared control intent contract failed');
			if (toggle.input.checked !== false)
				throw new Error('Toggle intent mutated authoritative checked state');
			if (host.querySelector('input[aria-invalid="true"]') === null)
				throw new Error('Invalid field lacks accessible state');
			if (
				host.querySelector('progress:not([value])') === null ||
				host.querySelector('progress[value]') === null
			)
				throw new Error('Progress states are incomplete');
			return 5;
		}
	};
}
