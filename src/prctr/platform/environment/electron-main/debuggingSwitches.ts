/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/** Exit code of an installed build refusing a debugging switch. */
export const REFUSED_SWITCH_EXIT_CODE = 2;

/** What a launch knows about itself before Electron is ready. */
export interface LaunchSwitches {
	/**
	 * Whether this is an installed build rather than a source checkout. A checkout is
	 * started as `electron <path>`, which Electron reports as `process.defaultApp`; unlike
	 * `app.isPackaged`, this does not depend on the executable's name.
	 */
	readonly built: boolean;
	/** The process arguments, for Node's inspector options. */
	readonly argv: readonly string[];
	/** Whether Chromium was given the command-line switch `name`. */
	hasSwitch(name: string): boolean;
}

/** Chromium switches that let another process drive or inspect the application. */
const CHROMIUM_SWITCHES = [
	'remote-debugging-port',
	'remote-debugging-pipe',
	'remote-debugging-address',
	'auto-open-devtools-for-tabs'
] as const;

/** Node's inspector options; the packaged fuses also disable them. */
const NODE_INSPECTOR = /^--inspect(?:-brk|-port|-publish-uid)?(?:=|$)/;

/**
 * Whether one process argument is a debugging switch, in the `--name` or `--name=value` form
 * Chromium and Node read. A source checkout passes these through to Chromium and Node, so its
 * own argument parser skips them rather than treating them as unknown.
 */
export function isDebuggingArgument(argument: string): boolean {
	if (NODE_INSPECTOR.test(argument)) return true;
	return CHROMIUM_SWITCHES.some(
		(name) => argument === `--${name}` || argument.startsWith(`--${name}=`)
	);
}

/**
 * The debugging switch an installed build must refuse, or undefined. Remote debugging
 * and Node's inspector would let anyone who can start Proctor drive its windows,
 * read their pages and act as the candidate, so an installed build exits before
 * Electron is ready rather than accept one. A source checkout keeps them.
 */
export function refusedDebuggingSwitch(launch: LaunchSwitches): string | undefined {
	if (!launch.built) return undefined;
	const chromium = CHROMIUM_SWITCHES.find((name) => launch.hasSwitch(name));
	if (chromium !== undefined) return `--${chromium}`;
	return launch.argv.find((argument) => NODE_INSPECTOR.test(argument))?.split('=')[0];
}
