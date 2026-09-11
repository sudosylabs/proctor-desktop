import type { VSBuffer } from '../../../base/common/buffer.js';
import type { Edit } from '../../../base/common/jsonFormatter.js';
import type { Event } from '../../../base/common/event.js';
import type { IDisposable } from '../../../base/common/lifecycle.js';
import type { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

/** Resource operations consumed by the transplanted configuration service. */
export interface IFileService {
	readonly onDidFilesChange: Event<{ contains(resource: URI): boolean }>;
	readonly onDidRunOperation: Event<{
		readonly resource: URI;
		isOperation(operation: FileOperation): boolean;
	}>;
	watch(resource: URI): IDisposable;
	readFile(resource: URI): Promise<{ readonly value: VSBuffer }>;
	writeFile(resource: URI, value: VSBuffer): Promise<void>;
	writeEdits?(resource: URI, source: string, edits: readonly Edit[]): Promise<void>;
}

export enum FileOperation {
	CREATE,
	DELETE,
	MOVE,
	COPY,
	WRITE
}
export enum FileOperationResult {
	FILE_IS_DIRECTORY,
	FILE_NOT_FOUND,
	FILE_NOT_MODIFIED_SINCE,
	FILE_MODIFIED_SINCE,
	FILE_MOVE_CONFLICT,
	FILE_WRITE_LOCKED,
	FILE_PERMISSION_DENIED,
	FILE_TOO_LARGE,
	FILE_INVALID_PATH,
	FILE_NOT_DIRECTORY,
	FILE_OTHER_ERROR
}
export class FileOperationError extends Error {
	constructor(
		message: string,
		readonly fileOperationResult: FileOperationResult
	) {
		super(message);
	}
}

/** Configuration models need resource identity, never host workspace authority. */
export interface IWorkspaceFolder {
	readonly uri: URI;
	readonly name: string;
	readonly index: number;
}
export interface Workspace {
	getFolder(resource: URI): IWorkspaceFolder | null;
}

export interface ILogService {
	error(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	trace(...args: unknown[]): void;
}
export const ILogService = createDecorator<ILogService>('settingsLogService');

/** Settings values and source must never enter ordinary diagnostics. */
export class NullLogService implements ILogService {
	error(..._args: unknown[]): void {}
	warn(..._args: unknown[]): void {}
	trace(..._args: unknown[]): void {}
}
