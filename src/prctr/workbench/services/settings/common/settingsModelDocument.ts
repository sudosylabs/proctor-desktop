import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import type { IModelService } from '../../../../editor/common/services/model.js';
import type { ITextModel } from '../../../../editor/common/model.js';
import type { IModelContentChangedEvent } from '../../../../editor/common/textModelEvents.js';
import type { SettingsWorkingDocument } from '../../../../platform/settings/common/settingsResource.js';
import type { Edit } from '../../../../base/common/jsonFormatter.js';
import { applyEdits } from '../../../../base/common/jsonEdit.js';
import { Range } from '../../../../editor/common/core/range.js';
import {
	MultiModelEditStackElement,
	SingleModelEditStackElement
} from '../../../../editor/common/model/editStack.js';
import type { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';

interface Serialization {
	readonly bom: string;
	readonly endings: readonly string[];
}

/** The model owns text and undo; serialization retains the source's otherwise invisible line endings. */
export class SettingsModelDocument extends Disposable implements SettingsWorkingDocument {
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	private disposed = false;
	private replacing = false;
	private serialization: Serialization;
	// Alternative version IDs follow the model's undo stack. No second text history is stored here.
	private readonly serializations = new Map<number, Serialization>();
	private pruningScheduled = false;

	constructor(
		readonly model: ITextModel,
		private readonly models: IModelService,
		private readonly undoRedo: IUndoRedoService,
		source = model.getValue(undefined, true)
	) {
		super();
		this.serialization = describe(source);
		if (
			source
				.replace(/^\uFEFF/, '')
				.split(/\r\n|\r|\n/)
				.join('\n') !== model.getLinesContent().join('\n')
		)
			throw new Error('Settings source does not match the editor model.');
		this.remember();
		this._register(model.onDidChangeContent((event) => this.acceptModelChange(event)));
		this._register(
			model.onWillDispose(() => {
				this.disposed = true;
				this.serializations.clear();
			})
		);
		this._register(
			toDisposable(() => {
				this.disposed = true;
				this.serializations.clear();
			})
		);
	}

	get value(): string {
		this.assertLive();
		const lines = this.model.getLinesContent();
		return (
			this.serialization.bom +
			lines.map((line, index) => line + (this.serialization.endings[index] ?? '')).join('')
		);
	}

	applyEdits(edits: readonly Edit[]): void {
		const source = this.value;
		const next = applyEdits(source, [...edits]);
		if (source === next) return;
		const operations = edits.map((edit) => {
			const start = rawPosition(source, edit.offset);
			const end = rawPosition(source, edit.offset + edit.length);
			return {
				range: new Range(start.lineNumber, start.column, end.lineNumber, end.column),
				text: edit.content
			};
		});
		this.replacing = true;
		try {
			this.model.pushStackElement();
			this.model.pushEditOperations(null, operations, () => null);
			this.model.pushStackElement();
			this.serialization = describe(next);
			this.remember();
		} finally {
			this.replacing = false;
		}
		this.changed.fire();
	}

	replace(source: string): void {
		if (this.value === source) return;
		const before = this.model.getAlternativeVersionId();
		this.replacing = true;
		try {
			this.models.updateModel(this.model, source);
			if (this.model.getAlternativeVersionId() === before) {
				// An EOL/BOM-only serialization edit still needs a real model undo boundary.
				this.model.pushStackElement();
				this.model.pushEditOperations(
					null,
					[{ range: this.model.getFullModelRange(), text: this.model.getValue() }],
					() => null
				);
				this.model.pushStackElement();
			}
			this.serialization = describe(source);
			this.remember();
		} finally {
			this.replacing = false;
		}
		this.changed.fire();
	}

	private acceptModelChange(event: IModelContentChangedEvent): void {
		if (this.replacing) return;
		const known =
			event.isUndoing || event.isRedoing
				? this.serializations.get(this.model.getAlternativeVersionId())
				: undefined;
		if (known) this.serialization = known;
		else if (event.isFlush) {
			this.serialization = describe(this.model.getValue(undefined, true));
			this.serializations.clear();
		} else if (event.isEolChange) {
			this.serialization = {
				bom: this.serialization.bom,
				endings: Array(this.model.getLineCount() - 1).fill(this.model.getEOL())
			};
		} else {
			let endings: string[] | undefined;
			for (const change of event.changes) {
				const inserted = change.text.match(/\r\n|\r|\n/g) ?? [];
				if (
					inserted.length === 0 &&
					change.range.startLineNumber === change.range.endLineNumber
				)
					continue;
				endings ??= [...this.serialization.endings];
				endings.splice(
					change.range.startLineNumber - 1,
					change.range.endLineNumber - change.range.startLineNumber,
					...inserted
				);
			}
			if (endings) this.serialization = { bom: this.serialization.bom, endings };
		}
		this.remember();
		this.changed.fire();
	}

	private remember(): void {
		this.serializations.set(this.model.getAlternativeVersionId(), this.serialization);
		if (this.pruningScheduled) return;
		this.pruningScheduled = true;
		// Content events fire before the edit-stack element records its ending version.
		queueMicrotask(() => {
			this.pruningScheduled = false;
			if (this.disposed) return;
			const retained = new Set([this.model.getAlternativeVersionId()]);
			const stack = this.undoRedo.getElements(this.model.uri);
			for (const element of [...stack.past, ...stack.future]) {
				const entries =
					element instanceof MultiModelEditStackElement ? element.split() : [element];
				for (const entry of entries) {
					if (
						entry instanceof SingleModelEditStackElement &&
						entry.matchesResource(this.model.uri)
					)
						for (const version of entry.getAlternativeVersionIds())
							retained.add(version);
				}
			}
			for (const version of this.serializations.keys())
				if (!retained.has(version)) this.serializations.delete(version);
		});
	}
	async read(): Promise<string> {
		return this.value;
	}
	async write(source: string): Promise<void> {
		this.replace(source);
	}
	private assertLive(): void {
		if (this.disposed || this.model.isDisposed())
			throw new Error('Settings document is disposed');
	}
}

function describe(source: string): Serialization {
	return {
		bom: source.startsWith('\uFEFF') ? '\uFEFF' : '',
		endings: source.match(/\r\n|\r|\n/g) ?? []
	};
}

function rawPosition(source: string, offset: number): { lineNumber: number; column: number } {
	if (!Number.isInteger(offset) || offset < 0 || offset > source.length)
		throw new Error('Invalid Settings edit range.');
	const lines = source
		.slice(0, offset)
		.replace(/^\uFEFF/, '')
		.split(/\r\n|\r|\n/);
	return { lineNumber: lines.length, column: lines[lines.length - 1]!.length + 1 };
}
