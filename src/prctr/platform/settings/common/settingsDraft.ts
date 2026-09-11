import { setProperty } from '../../../base/common/jsonEdit.js';
import { findNodeAtLocation, parseTree } from '../../../base/common/json.js';
import { stripComments } from '../../../base/common/jsonc.js';
import { parseSettingsDocument } from './settingsDocument.js';
import { applyEdits } from './settingsMigration.js';
import { settingsRegistry } from './settingsRegistry.js';
import { ConfigurationService } from '../../configuration/common/configurationService.js';
import { NullPolicyService } from '../../policy/common/policy.js';
import { NullLogService } from './configurationPorts.js';
import {
	SettingsDraftStorage,
	type SettingsWorkingDocument,
	SettingsResourceFileService,
	userSettingsResource
} from './settingsResource.js';
import { registerSettingsConfiguration } from './settingsConfigurationRegistry.js';
import { Queue } from '../../../base/common/async.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import type { Edit } from '../../../base/common/jsonFormatter.js';

export interface SettingsMergeConflict {
	readonly path: readonly string[];
	readonly reason:
		'same-path' | 'delete-modify' | 'syntax-trivia' | 'unknown-property' | 'invalid-source';
}

export interface SettingsMergeResult {
	readonly merged?: string;
	readonly conflicts: readonly SettingsMergeConflict[];
}

export class SettingsDraft extends Disposable {
	private base: { readonly source: string; readonly revision: string };
	readonly #document: SettingsWorkingDocument;
	#sourceVersion = 0;
	readonly #edits = this._register(new Queue<void>());
	#disposed = false;

	constructor(source: string, revision: string, document?: SettingsWorkingDocument, private readonly isReadonly: () => boolean = () => false) {
		super();
		this.base = { source, revision };
		this.#document = document ?? this._register(new SettingsDraftStorage(source));
		if (this.#document.value !== source) throw new Error('Settings document does not match its base source');
		this._register(this.#document.onDidChange(() => this.#sourceVersion++));
	}

	get source(): string {
		return this.#document.value;
	}
	get baseSource(): string { return this.base.source; }
	get baseRevision(): string { return this.base.revision; }
	/** Advance only the acknowledged base; edits made while saving remain in the same working document. */
	acknowledge(source: string, revision: string): void {
		if (this.#disposed) throw new Error('Settings draft is disposed');
		this.base = { source, revision };
	}
	get validation() {
		return parseSettingsDocument(this.#document.value);
	}

	replaceSource(source: string): void {
		if (this.#disposed) throw new Error('Settings draft is disposed');
		this.#document.replace(source);
	}

	async set(id: string, value: unknown, language?: string): Promise<void> {
		const declaration = settingsRegistry.declaration(id);
		if (declaration === undefined || declaration.candidate === 'prohibited')
			throw new Error(`Setting ${id} is not editable`);
		if (language !== undefined && !declaration.languageOverride)
			throw new Error(`Setting ${id} has no language override`);
		if (value !== undefined && settingsRegistry.normalize(id as never, value) === undefined)
			throw new Error(`Invalid value for ${id}`);
		return this.#edits.queue(async () => {
			if (this.#disposed) throw new Error('Settings draft is disposed');
			if (this.isReadonly()) throw new Error('Settings draft is read-only');
			registerSettingsConfiguration();
			const source = this.#document.value;
			const sourceVersion = this.#sourceVersion;
			const disposables = new DisposableStore();
			try {
				const storage = disposables.add(new SettingsDraftStorage(source));
				const transactions: (readonly Edit[])[] = [];
				disposables.add(storage.onDidApplyEdits(edits => transactions.push(edits)));
				const files = disposables.add(new SettingsResourceFileService(storage));
				const service = disposables.add(
					new ConfigurationService(
						userSettingsResource,
						files,
						new NullPolicyService(),
						new NullLogService()
					)
				);
				await service.initialize();
				await service.updateValue(
					id,
					value,
					language === undefined ? {} : { overrideIdentifiers: [language.toLowerCase()] }
				);
				if (this.#disposed) throw new Error('Settings draft is disposed');
				if (this.isReadonly()) throw new Error('Settings draft is read-only');
				if (this.#sourceVersion !== sourceVersion)
					throw new Error('Settings draft changed during the edit');
				for (const edits of transactions) this.#document.applyEdits(edits);
			} finally {
				disposables.dispose();
			}
		});
	}

	mergeLatest(latestSource: string): SettingsMergeResult {
		return mergeSettingsSources(this.baseSource, this.#document.value, latestSource);
	}

	override dispose(): void {
		this.#disposed = true;
		super.dispose();
	}
}

export function mergeSettingsSources(
	baseSource: string,
	draftSource: string,
	latestSource: string
): SettingsMergeResult {
	const base = parseSettingsDocument(baseSource);
	const draft = parseSettingsDocument(draftSource);
	const latest = parseSettingsDocument(latestSource);
	if (
		!base.valid ||
		!draft.valid ||
		!latest.valid ||
		base.root === undefined ||
		draft.root === undefined ||
		latest.root === undefined
	) {
		return Object.freeze({
			conflicts: Object.freeze([{ path: [], reason: 'invalid-source' as const }])
		});
	}
	const draftTriviaChanged =
		jsonWithoutTrivia(baseSource) === jsonWithoutTrivia(draftSource) &&
		baseSource !== draftSource;
	const latestTriviaChanged =
		jsonWithoutTrivia(baseSource) === jsonWithoutTrivia(latestSource) &&
		baseSource !== latestSource;
	const draftChanges = changes(base.root, draft.root);
	const latestChanges = changes(base.root, latest.root);
	const draftTriviaChanges = propertyTriviaChanges(
		baseSource,
		draftSource,
		base.root,
		draft.root
	);
	const latestTriviaChanges = propertyTriviaChanges(
		baseSource,
		latestSource,
		base.root,
		latest.root
	);
	if (
		draftTriviaChanged &&
		latestTriviaChanged &&
		draftTriviaChanges.size === 0 &&
		latestTriviaChanges.size === 0
	)
		return Object.freeze({
			conflicts: Object.freeze([{ path: [], reason: 'syntax-trivia' as const }])
		});
	const conflicts: SettingsMergeConflict[] = [];
	for (const [path, draftChange] of draftChanges) {
		const segments = path.split('/');
		const declarationKey = segments.length === 1 ? segments[0]! : segments[1]!;
		if (!settingsRegistry.isKnown(declarationKey)) {
			conflicts.push({ path: path.split('/'), reason: 'unknown-property' });
			continue;
		}
		const latestChange = latestChanges.get(path);
		if (latestChange !== undefined && !equal(draftChange.after, latestChange.after)) {
			conflicts.push({
				path: segments,
				reason:
					draftChange.after === missing || latestChange.after === missing
						? 'delete-modify'
						: 'same-path'
			});
			continue;
		}
	}
	for (const [path, draftTrivia] of draftTriviaChanges) {
		const latestTrivia = latestTriviaChanges.get(path);
		if (latestTrivia !== undefined && latestTrivia !== draftTrivia)
			conflicts.push({ path: path.split('/'), reason: 'syntax-trivia' });
	}
	if (conflicts.length > 0) return Object.freeze({ conflicts: Object.freeze(conflicts) });
	let merged = draftTriviaChanged && draftChanges.size === 0 ? draftSource : latestSource;
	const changesToApply =
		draftTriviaChanged && draftChanges.size === 0 ? latestChanges : draftChanges;
	for (const [path, change] of changesToApply) {
		const segments = path.split('/');
		merged = applyEdits(
			merged,
			setProperty(merged, segments, change.after === missing ? undefined : change.after, {
				insertSpaces: true,
				tabSize: 2,
				eol: '\n'
			})
		);
	}
	if (changesToApply === draftChanges)
		for (const [path, trivia] of draftTriviaChanges)
			if (trivia !== undefined)
				merged = replaceLeadingPropertyTrivia(merged, path.split('/'), trivia);
	return Object.freeze({ merged, conflicts: Object.freeze([]) });
}

const missing = Symbol('missing');
interface Change {
	readonly after: unknown | typeof missing;
}

function changes(
	base: Readonly<Record<string, unknown>>,
	next: Readonly<Record<string, unknown>>
): Map<string, Change> {
	const result = new Map<string, Change>();
	for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
		const before = Object.hasOwn(base, key) ? base[key] : missing;
		const after = Object.hasOwn(next, key) ? next[key] : missing;
		if (isLanguageObject(key, before) || isLanguageObject(key, after)) {
			const beforeRecord = recordOrEmpty(before);
			const afterRecord = recordOrEmpty(after);
			for (const nested of new Set([
				...Object.keys(beforeRecord),
				...Object.keys(afterRecord)
			])) {
				const nestedBefore = Object.hasOwn(beforeRecord, nested)
					? beforeRecord[nested]
					: missing;
				const nestedAfter = Object.hasOwn(afterRecord, nested)
					? afterRecord[nested]
					: missing;
				if (!equal(nestedBefore, nestedAfter))
					result.set(`${key}/${nested}`, { after: nestedAfter });
			}
		} else if (!equal(before, after)) result.set(key, { after });
	}
	return result;
}

function propertyTriviaChanges(
	baseSource: string,
	nextSource: string,
	base: Readonly<Record<string, unknown>>,
	next: Readonly<Record<string, unknown>>
): Map<string, string | undefined> {
	const result = new Map<string, string | undefined>();
	for (const path of propertyPaths(base, next)) {
		const segments = path.split('/');
		const before = leadingPropertyTrivia(baseSource, segments);
		const after = leadingPropertyTrivia(nextSource, segments);
		if (before !== after) result.set(path, after);
	}
	return result;
}
function propertyPaths(
	left: Readonly<Record<string, unknown>>,
	right: Readonly<Record<string, unknown>>
): readonly string[] {
	const result: string[] = [];
	for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
		const leftValue = left[key];
		const rightValue = right[key];
		if (isLanguageObject(key, leftValue) || isLanguageObject(key, rightValue))
			for (const nested of new Set([
				...Object.keys(recordOrEmpty(leftValue)),
				...Object.keys(recordOrEmpty(rightValue))
			]))
				result.push(`${key}/${nested}`);
		else result.push(key);
	}
	return result;
}

function isLanguageObject(key: string, value: unknown): boolean {
	return /^\[[^\]]+\]$/.test(key) && typeof value === 'object' && value !== null;
}
function recordOrEmpty(value: unknown): Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null
		? (value as Readonly<Record<string, unknown>>)
		: {};
}
function equal(left: unknown, right: unknown): boolean {
	return left === missing || right === missing
		? left === right
		: JSON.stringify(left) === JSON.stringify(right);
}
function jsonWithoutTrivia(source: string): string {
	try {
		return JSON.stringify(JSON.parse(stripComments(source)));
	} catch {
		return '';
	}
}
function leadingPropertyTrivia(source: string, path: readonly string[]): string | undefined {
	const range = leadingPropertyTriviaRange(source, path);
	return range === undefined
		? undefined
		: source.slice(range.offset, range.offset + range.length);
}
function replaceLeadingPropertyTrivia(
	source: string,
	path: readonly string[],
	trivia: string
): string {
	const range = leadingPropertyTriviaRange(source, path);
	return range === undefined
		? source
		: source.slice(0, range.offset) + trivia + source.slice(range.offset + range.length);
}
function leadingPropertyTriviaRange(
	source: string,
	path: readonly string[]
): { readonly offset: number; readonly length: number } | undefined {
	const root = parseTree(source);
	const value = findNodeAtLocation(root, [...path]);
	const property = value?.parent;
	const parent = property?.parent;
	if (property?.type !== 'property' || parent?.type !== 'object' || parent.children === undefined)
		return undefined;
	const index = parent.children.indexOf(property);
	if (index < 0) return undefined;
	const start =
		index === 0
			? parent.offset + 1
			: parent.children[index - 1]!.offset + parent.children[index - 1]!.length;
	const raw = source.slice(start, property.offset);
	const comma = raw.indexOf(',');
	const offset = comma < 0 ? start : start + comma + 1;
	return { offset, length: property.offset - offset };
}
