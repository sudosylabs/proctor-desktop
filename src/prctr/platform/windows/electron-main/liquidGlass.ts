/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { LiquidGlassOwner } from './windowMaterial.js';

interface GlassModule {
	readonly LiquidGlass: new (runtime: {
		readonly platform: string;
		readonly pointerSize: number;
		load(): unknown;
	}) => LiquidGlassOwner;
}

interface GlassAddon {
	readonly LiquidGlassNative: new () => unknown;
}

/**
 * A new glass owner for one window, or undefined where Liquid Glass cannot
 * exist. The build stages the package's module and this architecture's addon
 * in `directory`; they are loaded by path because the app ships no
 * node_modules. The addon itself loads on first use.
 */
export function createLiquidGlass(directory: string | undefined): LiquidGlassOwner | undefined {
	if (process.platform !== 'darwin' || directory === undefined) {
		return undefined;
	}
	try {
		const load = createRequire(join(directory, 'index.cjs'));
		const { LiquidGlass } = load(join(directory, 'index.cjs')) as GlassModule;
		return new LiquidGlass({
			platform: 'darwin',
			pointerSize: 8,
			load: () => new (load(join(directory, 'elg.node')) as GlassAddon).LiquidGlassNative()
		});
	} catch {
		// Not staged: the window falls back to vibrancy.
		return undefined;
	}
}
