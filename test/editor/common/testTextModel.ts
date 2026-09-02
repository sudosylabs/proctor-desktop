import { Range } from '../../../src/prctr/editor/common/core/range.ts';
import {
	DefaultEndOfLine,
	EndOfLinePreference,
	EndOfLineSequence,
	ValidAnnotatedEditOperation,
	type IIdentifiedSingleEditOperation,
	type ITextSnapshot
} from '../../../src/prctr/editor/common/model.ts';
import { PieceTreeTextBufferBuilder } from '../../../src/prctr/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.ts';

export function createTextModel(value: string): TestTextModel {
	const builder = new PieceTreeTextBufferBuilder();
	builder.acceptChunk(value);
	const created = builder.finish().create(DefaultEndOfLine.LF);
	return new TestTextModel(created.textBuffer, created.disposable);
}

export class TestTextModel {
	constructor(
		private readonly buffer: ReturnType<
			ReturnType<PieceTreeTextBufferBuilder['finish']>['create']
		>['textBuffer'],
		private readonly owner: { dispose(): void }
	) {}
	applyEdits(operations: readonly IIdentifiedSingleEditOperation[]): void {
		this.buffer.applyEdits(
			operations.map(
				(operation) =>
					new ValidAnnotatedEditOperation(
						operation.identifier ?? null,
						Range.lift(operation.range),
						operation.text,
						operation.forceMoveMarkers ?? false,
						operation.isAutoWhitespaceEdit ?? false,
						operation._isTracked ?? false
					)
			),
			false,
			false
		);
	}
	createSnapshot(): ITextSnapshot {
		return this.buffer.createSnapshot(false);
	}
	getEOL(): string {
		return this.buffer.getEOL();
	}
	setEOL(sequence: EndOfLineSequence): void {
		this.buffer.setEOL(sequence === EndOfLineSequence.CRLF ? '\r\n' : '\n');
	}
	getFullModelRange(): Range {
		return new Range(
			1,
			1,
			this.buffer.getLineCount(),
			this.buffer.getLineMaxColumn(this.buffer.getLineCount())
		);
	}
	getLineContent(lineNumber: number): string {
		return this.buffer.getLineContent(lineNumber);
	}
	getLineCount(): number {
		return this.buffer.getLineCount();
	}
	getLineMaxColumn(lineNumber: number): number {
		return this.buffer.getLineMaxColumn(lineNumber);
	}
	getOffsetAt(position: { readonly lineNumber: number; readonly column: number }): number {
		return this.buffer.getOffsetAt(position.lineNumber, position.column);
	}
	getPositionAt(offset: number) {
		return this.buffer.getPositionAt(offset);
	}
	getValueInRange(range: Range, eol: EndOfLinePreference): string {
		return this.buffer.getValueInRange(range, eol);
	}
	getLinesContent(): string[] {
		return this.buffer.getLinesContent();
	}
	dispose(): void {
		this.owner.dispose();
	}
}
