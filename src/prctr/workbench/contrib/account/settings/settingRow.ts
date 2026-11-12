/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { createStatusBadge } from '../../../../base/browser/ui/badge/statusBadge.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { SegmentedControl } from '../../../../base/browser/ui/segmented/segmentedControl.js';
import {
	SelectControl,
	type SelectChoice
} from '../../../../base/browser/ui/select/selectControl.js';
import { StepperControl } from '../../../../base/browser/ui/stepper/stepperControl.js';
import { SwitchControl } from '../../../../base/browser/ui/switch/switchControl.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { proctorIconFactory } from '../../../../platform/theme/browser/proctorIcon.js';
import { shownValue, type SettingRow } from './common/settingsPresentation.js';
import { editorThemeName, ThemeSwatch } from './settingsPreview.js';

export type SettingValue = string | number | boolean;

/** A choice as the row shows it: the stored value and its label in the page's language. */
export interface SettingRowChoice {
	readonly value: SettingValue;
	readonly label: string;
}

/** The row's text, all in the page's language. */
export interface SettingRowText {
	readonly title: string;
	readonly description: string;
	/** Where the row lives, as in “Appearance · Size”, shown above the title in search results. */
	readonly place: string;
	/** “Reset to 14 px”. */
	readonly reset: string;
	/** “Reset Font size to 14 px”. */
	readonly resetAccessible: string;
	readonly notSaved: string;
	readonly choices: readonly SettingRowChoice[];
	readonly smaller: string;
	readonly larger: string;
	readonly pixels: (value: number) => string;
}

/** What the row shows now. */
export interface SettingRowState {
	readonly value: SettingValue;
	/** The person set this one, so Reset is offered. */
	readonly changed: boolean;
	readonly disabled: boolean;
	/** A change to this setting is not saved to the account yet. */
	readonly failed: boolean;
}

/** The one control a row carries, whichever kind it is. */
interface RowControl {
	readonly focusTarget: HTMLElement;
	show(value: SettingValue): void;
	setDisabled(disabled: boolean): void;
	focus(): void;
}

/**
 * One setting: its title and description, its control, a Not saved badge and Reset. The row is
 * built once and `update` writes each later state into it, so focus never leaves the control
 * the person is using.
 */
export class SettingRowView extends Disposable {
	readonly element: HTMLElement;
	private readonly badge: HTMLElement;
	private readonly reset: ButtonControl;
	private readonly control: RowControl;
	private readonly changeEmitter = this._register(new Emitter<SettingValue | undefined>());
	/** The person chose a value, or `undefined` to go back to the default. */
	readonly onDidChange: Event<SettingValue | undefined> = this.changeEmitter.event;

	constructor(
		host: HTMLElement,
		readonly row: SettingRow,
		text: SettingRowText,
		value: SettingValue
	) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		const descriptionId = `prctr-setting-${row.id.replaceAll('.', '-')}-description`;
		this.badge = createStatusBadge(host.ownerDocument, {
			text: text.notSaved,
			tone: 'failure'
		});
		this.badge.hidden = true;
		this.element = $(
			'div.prctr-settings-page__row',
			{ data: { setting: row.id } },
			$(
				'div.prctr-settings-page__text',
				{},
				$('span.prctr-settings-page__place', { textContent: text.place }),
				$(
					'span.prctr-settings-page__title-line',
					{},
					$('span.prctr-settings-page__title', { textContent: text.title }),
					this.badge
				),
				$('span.prctr-settings-page__description', {
					id: descriptionId,
					textContent: text.description
				})
			)
		);
		this.reset = this._register(
			new ButtonControl(this.element, {
				variant: 'ghost',
				size: 'small',
				label: text.reset,
				accessibleLabel: text.resetAccessible,
				icon: proctorIconFactory('action.reset', 14)
			})
		);
		this.reset.element.hidden = true;
		this.control = this.createControl(text, value);
		this.control.focusTarget.setAttribute('aria-describedby', descriptionId);
		this._register(this.reset.onDidRequest(() => this.requestReset()));
		host.append(this.element);
	}

	update(state: SettingRowState): void {
		this.control.show(state.value);
		this.control.setDisabled(state.disabled);
		this.reset.element.hidden = !state.changed || state.disabled;
		this.badge.hidden = !state.failed;
	}

	focus(): void {
		this.control.focus();
	}

	/** Reset hides once the default applies, so focus moves to the control first. */
	private requestReset(): void {
		this.control.focus();
		this.changeEmitter.fire(undefined);
	}

	private createControl(text: SettingRowText, value: SettingValue): RowControl {
		const control = this.row.control;
		switch (control.kind) {
			case 'switch':
				return this.createSwitch(text, value);
			case 'stepper':
				return this.createStepper(text, value, control.minimum, control.maximum);
			case 'segmented':
				return this.createSegmented(text, value);
			case 'select':
				return this.row.id === 'workbench.colorTheme'
					? this.createThemeSelect(text, value)
					: this.createSelect(text, value);
		}
	}

	private createSwitch(text: SettingRowText, value: SettingValue): RowControl {
		const toggle = this._register(
			new SwitchControl(this.element, { label: text.title, on: value === true })
		);
		this._register(toggle.onDidChange((on) => this.changeEmitter.fire(on)));
		return {
			focusTarget: toggle.element,
			show: (next) => toggle.setOn(next === true),
			setDisabled: (disabled) => toggle.setDisabled(disabled),
			focus: () => toggle.element.focus()
		};
	}

	private createStepper(
		text: SettingRowText,
		value: SettingValue,
		minimum: number,
		maximum: number
	): RowControl {
		const stepper = this._register(
			new StepperControl(this.element, {
				label: text.title,
				value: Number(value),
				minimum,
				maximum,
				format: text.pixels,
				decreaseLabel: text.smaller,
				increaseLabel: text.larger,
				decreaseIcon: proctorIconFactory('action.decrease', 12),
				increaseIcon: proctorIconFactory('action.increase', 12)
			})
		);
		this._register(stepper.onDidChange((next) => this.changeEmitter.fire(next)));
		const spinbutton =
			stepper.element.querySelector<HTMLElement>('[role="spinbutton"]') ?? stepper.element;
		return {
			focusTarget: spinbutton,
			show: (next) => stepper.setValue(Number(next)),
			setDisabled: (disabled) => stepper.setDisabled(disabled),
			focus: () => stepper.focus()
		};
	}

	private createSegmented(text: SettingRowText, value: SettingValue): RowControl {
		const icons = this.row.control.kind === 'segmented' ? this.row.control.choices : [];
		const segmented = this._register(
			new SegmentedControl(this.element, {
				label: text.title,
				value: shownValue(this.row.id, value),
				options: text.choices.map((choice) => {
					const icon = icons.find((entry) => entry.value === choice.value)?.icon;
					return {
						value: String(choice.value),
						label: choice.label,
						...(icon === undefined ? {} : { icon: proctorIconFactory(icon, 14) })
					};
				})
			})
		);
		this._register(segmented.onDidChange((next) => this.chooseStored(text.choices, next)));
		return {
			focusTarget: segmented.element,
			show: (next) => segmented.setValue(shownValue(this.row.id, next)),
			setDisabled: (disabled) => segmented.setDisabled(disabled),
			focus: () => segmented.focus()
		};
	}

	private createSelect(text: SettingRowText, value: SettingValue): RowControl {
		const choices = text.choices.map((choice) => ({
			value: String(choice.value),
			label: choice.label
		}));
		const select = this._register(
			new SelectControl(this.element, {
				label: text.title,
				value: String(value),
				choices: withCurrent(choices, String(value)),
				caret: proctorIconFactory('action.expand', 14)
			})
		);
		this._register(select.onDidChange((next) => this.chooseStored(text.choices, next)));
		const listed = new ListedChoices(select, choices);
		return {
			focusTarget: select.select,
			show: (next) => listed.show(String(next)),
			setDisabled: (disabled) => select.setDisabled(disabled),
			focus: () => select.focus()
		};
	}

	/** The editor theme: theme names as choices, with a chip of the chosen theme's colours. */
	private createThemeSelect(text: SettingRowText, value: SettingValue): RowControl {
		const swatch = new ThemeSwatch(this.element.ownerDocument);
		const choices = text.choices.map((choice) => ({
			value: String(choice.value),
			label: choice.label
		}));
		const current = editorThemeName(value);
		swatch.update(current);
		const select = this._register(
			new SelectControl(this.element, {
				label: text.title,
				value: current,
				choices: withCurrent(choices, current),
				caret: proctorIconFactory('action.expand', 14),
				icon: () => ({ element: swatch.element, dispose: () => swatch.element.remove() })
			})
		);
		this._register(select.onDidChange((next) => this.changeEmitter.fire(next)));
		const listed = new ListedChoices(select, choices);
		return {
			focusTarget: select.select,
			show: (next) => {
				const name = editorThemeName(next);
				swatch.update(name);
				listed.show(name);
			},
			setDisabled: (disabled) => select.setDisabled(disabled),
			focus: () => select.focus()
		};
	}

	/** Controls report choices as text; the stored value may be a number or a boolean. */
	private chooseStored(choices: readonly SettingRowChoice[], shown: string): void {
		const choice = choices.find((entry) => String(entry.value) === shown);
		this.changeEmitter.fire(choice === undefined ? shown : choice.value);
	}
}

/** A select's choices, rewritten only when a value it does not offer comes or goes. */
class ListedChoices {
	private shown: readonly SelectChoice<string>[];

	constructor(
		private readonly select: SelectControl<string>,
		private readonly choices: readonly SelectChoice<string>[]
	) {
		this.shown = withCurrent(choices, select.value);
	}

	show(value: string): void {
		const next = withCurrent(this.choices, value);
		if (next === this.shown) {
			this.select.setValue(value);
			return;
		}
		this.shown = next;
		this.select.setChoices(next, value);
	}
}

/** A stored value the row does not offer is still shown, as the first choice. */
function withCurrent<T extends string>(
	choices: readonly SelectChoice<T>[],
	current: T
): readonly SelectChoice<T>[] {
	return choices.some((choice) => choice.value === current)
		? choices
		: [{ value: current, label: current }, ...choices];
}
