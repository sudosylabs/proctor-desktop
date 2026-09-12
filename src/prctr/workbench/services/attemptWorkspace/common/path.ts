/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { WorkspacePath } from './attemptWorkspace.js';

export function workspacePath(value: string): WorkspacePath {
	if (
		value.length === 0 ||
		new TextEncoder().encode(value).byteLength > 1024 ||
		/[\uD800-\uDFFF]/u.test(value) ||
		value.startsWith('/') ||
		value.endsWith('/') ||
		value.includes('\\') ||
		/[\p{Cc}]/u.test(value)
	)
		throw new Error('Workspace path is invalid');
	const segments = value.split('/');
	if (
		segments.length > 16 ||
		segments[0] === '.proctor' ||
		segments.some(
			(segment) =>
				segment.length === 0 ||
				segment === '.' ||
				segment === '..' ||
				new TextEncoder().encode(segment).byteLength > 255
		)
	)
		throw new Error('Workspace path is invalid');
	return value as WorkspacePath;
}
export function pathsOverlap(left: WorkspacePath, right: WorkspacePath): boolean {
	return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
