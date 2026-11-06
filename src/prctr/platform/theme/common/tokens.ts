/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export type DesignTokenKind =
	'color' | 'dimension' | 'duration' | 'font-family' | 'font-weight' | 'shadow';

export interface DesignTokenDefinition<Id extends string = string> {
	readonly id: Id;
	readonly kind: DesignTokenKind;
	readonly description: string;
}

const tokenDefinitions = [
	{
		id: 'spacing.workbench.gutter',
		kind: 'dimension',
		description: 'Floating workbench perimeter gutter in both densities.'
	},
	{
		id: 'spacing.workbench.gap',
		kind: 'dimension',
		description: 'Gap between floating workbench parts.'
	},
	{
		id: 'spacing.workbench.rowInset',
		kind: 'dimension',
		description: 'Inset of workbench row boxes from the pane edge.'
	},
	{ id: 'color.background.canvas', kind: 'color', description: 'Window canvas.' },
	{ id: 'color.background.surface', kind: 'color', description: 'Primary contained surface.' },
	{ id: 'color.background.raised', kind: 'color', description: 'Raised contained surface.' },
	{ id: 'color.text.primary', kind: 'color', description: 'Primary text.' },
	{ id: 'color.text.secondary', kind: 'color', description: 'Secondary text.' },
	{
		id: 'color.text.disabled',
		kind: 'color',
		description: 'Unavailable text with a non-color cue.'
	},
	{ id: 'color.text.inverse', kind: 'color', description: 'Text on an accent surface.' },
	{ id: 'color.text.link', kind: 'color', description: 'Link text.' },
	{ id: 'color.brand.accent', kind: 'color', description: 'Proctor primary action surface.' },
	{
		id: 'color.brand.accentHover',
		kind: 'color',
		description: 'Hovered Proctor primary action surface.'
	},
	{ id: 'color.brand.onAccent', kind: 'color', description: 'Text on the brand accent.' },
	{ id: 'color.brand.link', kind: 'color', description: 'Proctor link text.' },
	{ id: 'color.brand.mark', kind: 'color', description: 'Product mark and progress.' },
	{ id: 'color.border.default', kind: 'color', description: 'Ordinary component boundary.' },
	{ id: 'color.border.strong', kind: 'color', description: 'Emphasized component boundary.' },
	{ id: 'color.border.focus', kind: 'color', description: 'Keyboard focus indicator.' },
	{ id: 'color.interaction.accent', kind: 'color', description: 'Primary action surface.' },
	{
		id: 'color.interaction.accentHover',
		kind: 'color',
		description: 'Hovered primary action surface.'
	},
	{
		id: 'color.interaction.accentActive',
		kind: 'color',
		description: 'Pressed primary action surface.'
	},
	{ id: 'color.interaction.hover', kind: 'color', description: 'Hover feedback surface.' },
	{ id: 'color.interaction.active', kind: 'color', description: 'Pressed feedback surface.' },
	{ id: 'color.interaction.selected', kind: 'color', description: 'Selected item surface.' },
	{ id: 'color.selection.background', kind: 'color', description: 'Text selection surface.' },
	{ id: 'color.selection.foreground', kind: 'color', description: 'Text selection foreground.' },
	{
		id: 'color.feedback.success',
		kind: 'color',
		description: 'Success foreground paired with text.'
	},
	{
		id: 'color.feedback.successBackground',
		kind: 'color',
		description: 'Success message surface.'
	},
	{
		id: 'color.feedback.warning',
		kind: 'color',
		description: 'Warning foreground paired with text.'
	},
	{
		id: 'color.feedback.warningBackground',
		kind: 'color',
		description: 'Warning message surface.'
	},
	{
		id: 'color.feedback.error',
		kind: 'color',
		description: 'Error foreground paired with text.'
	},
	{ id: 'color.feedback.errorBackground', kind: 'color', description: 'Error message surface.' },
	{
		id: 'color.feedback.info',
		kind: 'color',
		description: 'Information foreground paired with text.'
	},
	{
		id: 'color.feedback.infoBackground',
		kind: 'color',
		description: 'Information message surface.'
	},
	{ id: 'color.editor.background', kind: 'color', description: 'Editor canvas.' },
	{ id: 'color.editor.foreground', kind: 'color', description: 'Editor text.' },
	{ id: 'color.terminal.background', kind: 'color', description: 'Terminal canvas.' },
	{ id: 'color.terminal.foreground', kind: 'color', description: 'Terminal text.' },
	{ id: 'color.overlay.backdrop', kind: 'color', description: 'Modal backdrop.' },
	{ id: 'color.scrollbar.thumb', kind: 'color', description: 'Scrollbar thumb.' },
	{ id: 'color.scrollbar.thumbHover', kind: 'color', description: 'Hovered scrollbar thumb.' },
	{ id: 'color.scrollbar.thumbActive', kind: 'color', description: 'Dragged scrollbar thumb.' },
	{
		id: 'typography.font.application',
		kind: 'font-family',
		description: 'Application font stack, led by the bundled IBM Plex Sans.'
	},
	{
		id: 'typography.font.monospace',
		kind: 'font-family',
		description: 'Code and aligned-data font stack.'
	},
	{ id: 'typography.label.small.size', kind: 'dimension', description: 'Small label font size.' },
	{
		id: 'typography.label.small.lineHeight',
		kind: 'dimension',
		description: 'Small label line height.'
	},
	{ id: 'typography.label.size', kind: 'dimension', description: 'Label font size.' },
	{ id: 'typography.label.lineHeight', kind: 'dimension', description: 'Label line height.' },
	{ id: 'typography.body.size', kind: 'dimension', description: 'Body font size.' },
	{ id: 'typography.body.lineHeight', kind: 'dimension', description: 'Body line height.' },
	{
		id: 'typography.content.body.size',
		kind: 'dimension',
		description: 'Examination-content body font size.'
	},
	{
		id: 'typography.content.body.lineHeight',
		kind: 'dimension',
		description: 'Examination-content body line height.'
	},
	{
		id: 'typography.heading.small.size',
		kind: 'dimension',
		description: 'Small heading font size.'
	},
	{
		id: 'typography.heading.small.lineHeight',
		kind: 'dimension',
		description: 'Small heading line height.'
	},
	{
		id: 'typography.heading.medium.size',
		kind: 'dimension',
		description: 'Medium heading font size.'
	},
	{
		id: 'typography.heading.medium.lineHeight',
		kind: 'dimension',
		description: 'Medium heading line height.'
	},
	{
		id: 'typography.heading.large.size',
		kind: 'dimension',
		description: 'Large heading font size.'
	},
	{
		id: 'typography.heading.large.lineHeight',
		kind: 'dimension',
		description: 'Large heading line height.'
	},
	{ id: 'typography.weight.regular', kind: 'font-weight', description: 'Regular text weight.' },
	{
		id: 'typography.weight.medium',
		kind: 'font-weight',
		description: 'Labels and names that need quiet emphasis.'
	},
	{
		id: 'typography.weight.semibold',
		kind: 'font-weight',
		description: 'Emphasized text weight.'
	},
	{ id: 'spacing.control.inline', kind: 'dimension', description: 'Inline control padding.' },
	{ id: 'spacing.control.block', kind: 'dimension', description: 'Block control padding.' },
	{ id: 'spacing.content.small', kind: 'dimension', description: 'Small content gap.' },
	{ id: 'spacing.content.medium', kind: 'dimension', description: 'Medium content gap.' },
	{ id: 'spacing.content.large', kind: 'dimension', description: 'Large content gap.' },
	{ id: 'spacing.region', kind: 'dimension', description: 'Workbench region inset.' },
	{ id: 'shape.radius.small', kind: 'dimension', description: 'Small corner radius.' },
	{ id: 'shape.radius.medium', kind: 'dimension', description: 'Medium corner radius.' },
	{ id: 'shape.radius.large', kind: 'dimension', description: 'Large corner radius.' },
	{ id: 'shape.radius.circle', kind: 'dimension', description: 'Circular radius.' },
	{ id: 'shape.stroke.default', kind: 'dimension', description: 'Default boundary stroke.' },
	{ id: 'shape.stroke.strong', kind: 'dimension', description: 'Strong boundary stroke.' },
	{ id: 'icon.size.small', kind: 'dimension', description: 'Small icon size.' },
	{ id: 'icon.size.medium', kind: 'dimension', description: 'Normal control icon size.' },
	{ id: 'icon.size.large', kind: 'dimension', description: 'Large icon size.' },
	{ id: 'icon.size.xlarge', kind: 'dimension', description: 'Extra-large icon size.' },
	{ id: 'elevation.raised', kind: 'shadow', description: 'Raised surface elevation.' },
	{ id: 'elevation.overlay', kind: 'shadow', description: 'Overlay elevation.' },
	{ id: 'elevation.modal', kind: 'shadow', description: 'Modal elevation.' },
	{ id: 'motion.duration.instant', kind: 'duration', description: 'No transition.' },
	{ id: 'motion.duration.fast', kind: 'duration', description: 'Fast acknowledgement.' },
	{ id: 'motion.duration.normal', kind: 'duration', description: 'Normal transition.' },
	{ id: 'motion.duration.slow', kind: 'duration', description: 'Slow orientation transition.' }
] as const satisfies readonly DesignTokenDefinition[];

export type DesignTokenId = (typeof tokenDefinitions)[number]['id'];

export function getDesignTokenDefinitions(): readonly DesignTokenDefinition<DesignTokenId>[] {
	return tokenDefinitions;
}

export function asCssVariableName(id: DesignTokenId): `--prctr-${string}` {
	return `--prctr-${id.replaceAll('.', '-')}`;
}

export function asCssVariable(id: DesignTokenId): `var(--prctr-${string})` {
	return `var(${asCssVariableName(id)})`;
}
