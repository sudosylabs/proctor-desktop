/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage, type LocalizationContext, type MessageDescriptor } from '../../../../base/common/localization.js';
import type { RemoteTerminalPanelLabels } from './remoteTerminalPanel.js';

const definitions = Object.freeze({
	title: defineMessage({ id: 'workbench.terminal.title', defaultMessage: 'Terminal', description: 'Title of the Candidate remote terminal panel.' }),
	open: defineMessage({ id: 'workbench.terminal.open', defaultMessage: 'Start terminal', description: 'Action that asks the server to open the Candidate remote terminal.' }),
	close: defineMessage({ id: 'workbench.terminal.close', defaultMessage: 'Close terminal', description: 'Action that closes the Candidate remote terminal.' }),
	input: defineMessage({ id: 'workbench.terminal.input', defaultMessage: 'Terminal input', description: 'Accessible label for the Candidate remote terminal input.' }),
	closed: defineMessage({ id: 'workbench.terminal.status.closed', defaultMessage: 'Not started', description: 'Status shown when the Candidate remote terminal is closed.' }),
	closing: defineMessage({ id: 'workbench.terminal.status.closing', defaultMessage: 'Closing…', description: 'Status shown while the Candidate remote terminal close request is in flight.' }),
	exited: defineMessage({ id: 'workbench.terminal.status.exited', defaultMessage: 'Process exited', description: 'Status shown after the remote terminal process exits.' }),
	failed: defineMessage({ id: 'workbench.terminal.status.failed', defaultMessage: 'Terminal unavailable', description: 'Status shown after the remote terminal fails closed.' }),
	opening: defineMessage({ id: 'workbench.terminal.status.opening', defaultMessage: 'Starting…', description: 'Status shown while the remote terminal is opening.' }),
	paused: defineMessage({ id: 'workbench.terminal.status.paused', defaultMessage: 'Paused by exam policy', description: 'Status shown while the remote terminal is paused by an independent exam gate.' }),
	ready: defineMessage({ id: 'workbench.terminal.status.ready', defaultMessage: 'Connected', description: 'Status shown when the remote terminal is connected and accepts input.' })
});

export const remoteTerminalMessageDescriptors: readonly MessageDescriptor[] = Object.freeze(Object.values(definitions));
export function createRemoteTerminalPanelLabels(localization: LocalizationContext): RemoteTerminalPanelLabels {
	return Object.freeze({
		title: localization.format(definitions.title), open: localization.format(definitions.open), close: localization.format(definitions.close), input: localization.format(definitions.input),
		statuses: Object.freeze({ closed: localization.format(definitions.closed), closing: localization.format(definitions.closing), exited: localization.format(definitions.exited), failed: localization.format(definitions.failed), opening: localization.format(definitions.opening), paused: localization.format(definitions.paused), ready: localization.format(definitions.ready) })
	});
}
