/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import type {
	ExamResourceCatalog,
	ExamResourceEntry,
	ExamResourceObservation,
	ExamResourceProjection,
	ExamResourceReadResult
} from './attemptWorkspace.js';
import type { ExamResourcePort } from './internalPorts.js';
import { workspacePath } from './path.js';

export const EXAM_RESOURCE_CATALOG_LIMITS = Object.freeze({
	entries: 2_048,
	contentBytes: 100 * 1024 * 1024,
	titleLength: 512
});

export interface ExamResourceAuthorization {
	readonly current: () => boolean;
	readonly onDidChange: Event<void>;
}

export async function createExamResourceCatalog(
	port: ExamResourcePort,
	authorization?: ExamResourceAuthorization
): Promise<ExamResourceCatalog> {
	return new ExamResourceCatalogImpl(port, validateEntries(await port.list()), authorization);
}
class ExamResourceCatalogImpl extends Disposable implements ExamResourceCatalog {
	readonly #port: ExamResourcePort;
	readonly #change = this._register(new Emitter<ExamResourceProjection>());
	#projection: ExamResourceProjection;
	#disposed = false;
	constructor(
		port: ExamResourcePort,
		entries: ExamResourceProjection['entries'],
		private readonly authorization?: ExamResourceAuthorization
	) {
		super();
		this.#port = port;
		this.#projection = Object.freeze({
			available: authorization?.current() ?? true,
			entries: Object.freeze(
				[...entries].sort(
					(a, b) => (a.order ?? 0) - (b.order ?? 0) || a.path.localeCompare(b.path)
				)
			)
		});
		if (authorization)
			this._register(
				authorization.onDidChange(() => {
					if (this.#disposed) return;
					this.#projection = Object.freeze({
						...this.#projection,
						available: authorization.current()
					});
					this.#change.fire(this.#projection);
				})
			);
	}
	observe(): ExamResourceObservation {
		this.#assertLive();
		return Object.freeze({
			current: Object.freeze({
				...this.#projection,
				available: this.authorization?.current() ?? this.#projection.available
			}),
			onDidChange: this.#change.event
		});
	}
	async read(reference: string): Promise<ExamResourceReadResult> {
		this.#assertLive();
		this.#assertAuthorized();
		const authorized = this.#projection.entries.find((entry) => entry.reference === reference);
		if (authorized === undefined) throw new Error('Exam Resource is not authorized');
		const value = await this.#port.read(reference);
		this.#assertLive();
		this.#assertAuthorized();
		return validateRead(value, authorized);
	}
	#assertAuthorized(): void {
		if (!(this.authorization?.current() ?? this.#projection.available))
			throw new Error('Exam Resource access is unavailable');
	}
	#assertLive(): void {
		if (this.#disposed) throw new Error('ExamResourceCatalog is disposed');
	}
	override dispose(): void {
		this.#disposed = true;
		super.dispose();
	}
}

function validateEntries(value: readonly ExamResourceEntry[]): readonly ExamResourceEntry[] {
	if (!Array.isArray(value) || value.length > EXAM_RESOURCE_CATALOG_LIMITS.entries)
		throw new TypeError('Exam Resource catalog exceeds packaged bounds');
	const references = new Set<string>();
	const paths = new Set<string>();
	const entries: ExamResourceEntry[] = [];
	for (let index = 0; index < value.length; index++) {
		if (!Object.hasOwn(value, index))
			throw new TypeError('Exam Resource catalog contains a sparse entry');
		const entry = validateEntry(value[index]);
		if (references.has(entry.reference) || paths.has(entry.path))
			throw new TypeError('Exam Resource catalog contains duplicate identity');
		references.add(entry.reference);
		paths.add(entry.path);
		entries.push(entry);
	}
	return Object.freeze(entries);
}
function validateEntry(value: unknown): ExamResourceEntry {
	if (!isRecord(value)) throw new TypeError('Exam Resource catalog entry is invalid');
	const expected =
		value.order === undefined
			? ['byteSize', 'mediaType', 'path', 'reference', 'title', 'version']
			: ['byteSize', 'mediaType', 'order', 'path', 'reference', 'title', 'version'];
	if (
		!exactKeys(value, expected) ||
		!boundedId(value.reference) ||
		!boundedId(value.version) ||
		typeof value.path !== 'string' ||
		!boundedText(value.mediaType, 255) ||
		!boundedText(value.title, EXAM_RESOURCE_CATALOG_LIMITS.titleLength) ||
		!Number.isSafeInteger(value.byteSize) ||
		(value.byteSize as number) < 0 ||
		(value.byteSize as number) > EXAM_RESOURCE_CATALOG_LIMITS.contentBytes ||
		(value.order !== undefined && !Number.isSafeInteger(value.order))
	)
		throw new TypeError('Exam Resource catalog entry is invalid');
	const path = workspacePath(value.path);
	return Object.freeze({
		reference: value.reference,
		path,
		version: value.version,
		mediaType: value.mediaType,
		byteSize: value.byteSize as number,
		title: value.title,
		...(value.order === undefined ? {} : { order: value.order as number })
	});
}
function validateRead(value: unknown, authorized: ExamResourceEntry): ExamResourceReadResult {
	if (!isRecord(value)) throw new TypeError('Exam Resource read is invalid');
	const expected =
		authorized.order === undefined
			? ['byteSize', 'content', 'mediaType', 'path', 'reference', 'title', 'version']
			: [
					'byteSize',
					'content',
					'mediaType',
					'order',
					'path',
					'reference',
					'title',
					'version'
				];
	if (!exactKeys(value, expected) || !(value.content instanceof Uint8Array))
		throw new TypeError('Exam Resource read is invalid');
	const entry = validateEntry({
		reference: value.reference,
		path: value.path,
		version: value.version,
		mediaType: value.mediaType,
		byteSize: value.byteSize,
		title: value.title,
		...(value.order === undefined ? {} : { order: value.order })
	});
	if (!sameEntry(entry, authorized) || value.content.byteLength !== authorized.byteSize)
		throw new TypeError('Exam Resource read does not match its authorized catalog entry');
	return Object.freeze({ ...authorized, content: new Uint8Array(value.content) });
}
function sameEntry(left: ExamResourceEntry, right: ExamResourceEntry): boolean {
	return (
		left.reference === right.reference &&
		left.path === right.path &&
		left.version === right.version &&
		left.mediaType === right.mediaType &&
		left.byteSize === right.byteSize &&
		left.title === right.title &&
		left.order === right.order
	);
}
function boundedId(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}
function boundedText(value: unknown, maximum: number): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= maximum &&
		!/[\0\r\n]/u.test(value)
	);
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Object.keys(value).sort();
	const sorted = [...expected].sort();
	return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}
