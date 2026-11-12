/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { proctorIconGlyphs } from './proctorIconGlyphs.generated.js';

type PhosphorName = keyof typeof proctorIconGlyphs;

/**
 * Proctor's icons for LaunchWindow and AuthenticatedWindow, by meaning. Callers name what the
 * icon stands for; which Phosphor glyph draws it stays here. CandidateWindow keeps Codicons
 * through semantic icons.
 */
const icons = {
	'area.activity': 'calendar-check',
	'area.exams': 'exam',
	'area.administration': 'buildings',
	'area.overview': 'squares-four',

	'activity.upcoming': 'calendar-blank',
	'activity.available': 'play-circle',
	'activity.inProgress': 'hourglass',
	'activity.submitted': 'check-circle',
	'activity.results': 'seal-check',
	'activity.past': 'clock-counter-clockwise',

	'account.profile': 'user-circle',
	'account.security': 'shield-check',
	'account.sessions': 'devices',
	'account.tokens': 'key',
	'account.history': 'clock-counter-clockwise',
	'account.settings': 'gear-six',

	'admin.users': 'users-three',
	'admin.invitations': 'envelope-simple',
	'admin.imports': 'upload-simple',
	'admin.structure': 'tree-structure',
	'admin.periods': 'calendar-dots',
	'admin.roles': 'identification-card',
	'admin.policy': 'lock-key',
	'admin.audits': 'clock-counter-clockwise',
	'admin.retention': 'archive',
	'admin.jobs': 'queue',
	'admin.mail': 'paper-plane-tilt',
	'admin.progression': 'graduation-cap',

	'action.add': 'plus',
	'action.back': 'caret-left',
	'action.changePhoto': 'camera',
	'action.close': 'x',
	'action.confirm': 'check',
	'action.continue': 'arrow-right',
	'action.copy': 'copy',
	'action.decrease': 'minus',
	'action.delete': 'trash',
	'action.download': 'download-simple',
	'action.edit': 'pencil-simple',
	'action.disable': 'pause-circle',
	'action.enable': 'play-circle',
	'action.end': 'prohibit',
	'action.expand': 'caret-down',
	'action.filter': 'funnel',
	'action.forward': 'caret-right',
	'action.increase': 'plus',
	'action.invite': 'user-plus',
	'action.move': 'arrows-left-right',
	'action.more': 'dots-three',
	'action.openExternal': 'arrow-square-out',
	'action.reset': 'arrow-counter-clockwise',
	'action.retry': 'arrow-clockwise',
	'action.search': 'magnifying-glass',
	'action.sendEmail': 'envelope-simple',
	'action.sortAscending': 'arrow-up',
	'action.sortDescending': 'arrow-down',
	'action.goToDate': 'calendar-blank',
	'action.signOut': 'sign-out',
	'action.toggleSidebar': 'sidebar-simple',
	'action.upload': 'upload-simple',

	'status.attention': 'warning-circle',
	'status.busy': 'circle-notch',
	'status.prohibited': 'prohibit',
	'status.review': 'eye',
	'status.waiting': 'hourglass',
	'status.failed': 'x-circle',
	'status.here': 'map-pin',
	'status.info': 'info',
	'status.locked': 'lock-simple',
	'status.offline': 'cloud-slash',
	'status.saved': 'cloud-check',
	'status.saving': 'cloud-arrow-up',
	'status.success': 'check-circle',
	'status.time': 'clock',
	'status.verified': 'seal-check',
	'status.warning': 'warning',

	'device.apple': 'apple-logo',
	'device.browser': 'globe',
	'device.cli': 'terminal-window',
	'device.desktop': 'desktop',
	'device.laptop': 'laptop',
	'device.linux': 'linux-logo',
	'device.windows': 'windows-logo',

	'object.browserActivity': 'browser',
	'object.calendar': 'calendar-blank',
	'object.class': 'graduation-cap',
	'object.csv': 'file-csv',
	'object.student': 'student',
	'object.file': 'file-text',
	'object.image': 'image',
	'object.institution': 'buildings',
	'object.key': 'key',
	'object.password': 'password',
	'object.role': 'chalkboard-teacher',
	'object.zoom': 'magnifying-glass-plus',

	'settings.accessibility': 'person-simple-circle',
	'settings.appearance': 'palette',
	'settings.browser': 'browser',
	'settings.editor': 'code',
	'theme.dark': 'moon',
	'theme.light': 'sun',
	'theme.system': 'monitor'
} as const satisfies Readonly<Record<string, PhosphorName>>;

export type ProctorIconId = keyof typeof icons;
export type ProctorIconSize = 12 | 14 | 16 | 18 | 20 | 22 | 24;

/** One glyph: path data on a 256-unit grid, filled with the current color. */
export interface ProctorIconGlyph {
	readonly id: ProctorIconId;
	readonly d: string;
}

/**
 * The glyph for an icon. `filled` draws the fill weight where one exists, marking the selected
 * place in the rail and sidebar; elsewhere the regular weight is used.
 */
export function resolveProctorIcon(id: ProctorIconId, filled = false): ProctorIconGlyph {
	const glyph: { readonly regular: string; readonly fill?: string } =
		proctorIconGlyphs[icons[id]];
	return { id, d: filled && glyph.fill !== undefined ? glyph.fill : glyph.regular };
}

export function hasFilledProctorIcon(id: ProctorIconId): boolean {
	return 'fill' in proctorIconGlyphs[icons[id]];
}

export function getProctorIconIds(): readonly ProctorIconId[] {
	return Object.freeze(Object.keys(icons).sort() as ProctorIconId[]);
}
