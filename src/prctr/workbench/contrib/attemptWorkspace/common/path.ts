/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { WorkspacePath } from './attemptWorkspace.js';

export function workspacePath(value: string): WorkspacePath {
	if (
		value.length === 0 ||
		value.length > 1024 ||
		value.startsWith('/') ||
		value.endsWith('/') ||
		value.includes('\\') ||
		value.includes('\0')
	)
		throw new Error('Workspace path is invalid');
	const segments = value.split('/');
	if (
		segments.length > 128 ||
		segments.some(
			(segment) =>
				segment.length === 0 || segment === '.' || segment === '..' || segment.length > 255
		)
	)
		throw new Error('Workspace path is invalid');
	return value as WorkspacePath;
}
export function pathsOverlap(left: WorkspacePath, right: WorkspacePath): boolean {
	return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
