export type Diagnostic = {
	readonly checkId: string;
	readonly path: string;
	readonly line?: number;
	readonly column?: number;
	readonly problem: string;
	readonly remediation: string;
};

export type EntryKind = 'file' | 'directory' | 'symlink';

export interface Repository {
	files(): readonly string[];
	exists(path: string): boolean;
	kind(path: string): EntryKind | undefined;
	read(path: string): string;
	readBytes(path: string): Uint8Array;
	readLink(path: string): string | undefined;
}

export interface CheckContext {
	readonly repository: Repository;
	readonly registeredCheckIds: ReadonlySet<string>;
}

export interface Check {
	readonly id: string;
	readonly category:
		'assurance' | 'dependency' | 'documentation' | 'generation' | 'source' | 'upstream';
	readonly contractRequired: boolean;
	run(context: CheckContext): readonly Diagnostic[] | Promise<readonly Diagnostic[]>;
}

export function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
	return (
		left.checkId.localeCompare(right.checkId) ||
		left.path.localeCompare(right.path) ||
		(left.line ?? 0) - (right.line ?? 0) ||
		(left.column ?? 0) - (right.column ?? 0) ||
		left.problem.localeCompare(right.problem)
	);
}

export function diagnostic(
	checkId: string,
	path: string,
	problem: string,
	remediation: string,
	line?: number,
	column?: number
): Diagnostic {
	return {
		checkId,
		path,
		...(line === undefined ? {} : { line }),
		...(column === undefined ? {} : { column }),
		problem,
		remediation
	};
}
