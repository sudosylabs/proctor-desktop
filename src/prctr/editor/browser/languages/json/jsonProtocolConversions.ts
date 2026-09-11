import type * as Protocol from 'vscode-languageserver/browser';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { Range, type IRange } from '../../../common/core/range.js';
import type { IPosition } from '../../../common/core/position.js';
import * as Editor from '../../../common/languages.js';
import {
	MarkerSeverity,
	MarkerTag,
	type IMarkerData
} from '../../../../platform/markers/common/markers.js';
import { URI } from '../../../../base/common/uri.js';

export function toProtocolPosition(position: IPosition): Protocol.Position {
	return { line: position.lineNumber - 1, character: position.column - 1 };
}
export function toProtocolRange(range: IRange): Protocol.Range {
	return {
		start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
		end: { line: range.endLineNumber - 1, character: range.endColumn - 1 }
	};
}
export function fromProtocolRange(range: Protocol.Range): Range {
	return new Range(
		range.start.line + 1,
		range.start.character + 1,
		range.end.line + 1,
		range.end.character + 1
	);
}
export function fromProtocolEdit(edit: Protocol.TextEdit): Editor.TextEdit {
	return { range: fromProtocolRange(edit.range), text: edit.newText };
}

const completionKinds = [
	Editor.CompletionItemKind.Text,
	Editor.CompletionItemKind.Method,
	Editor.CompletionItemKind.Function,
	Editor.CompletionItemKind.Constructor,
	Editor.CompletionItemKind.Field,
	Editor.CompletionItemKind.Variable,
	Editor.CompletionItemKind.Class,
	Editor.CompletionItemKind.Interface,
	Editor.CompletionItemKind.Module,
	Editor.CompletionItemKind.Property,
	Editor.CompletionItemKind.Unit,
	Editor.CompletionItemKind.Value,
	Editor.CompletionItemKind.Enum,
	Editor.CompletionItemKind.Keyword,
	Editor.CompletionItemKind.Snippet,
	Editor.CompletionItemKind.Color,
	Editor.CompletionItemKind.File,
	Editor.CompletionItemKind.Reference,
	Editor.CompletionItemKind.Folder,
	Editor.CompletionItemKind.EnumMember,
	Editor.CompletionItemKind.Constant,
	Editor.CompletionItemKind.Struct,
	Editor.CompletionItemKind.Event,
	Editor.CompletionItemKind.Operator,
	Editor.CompletionItemKind.TypeParameter
];

/** The JSON client enables theme icons in Markdown while keeping document-provided commands untrusted. */
function markdown(value: string, plain = false): MarkdownString {
	return plain
		? new MarkdownString('', { supportThemeIcons: true }).appendText(value)
		: new MarkdownString(value, { supportThemeIcons: true, isTrusted: false });
}

export function fromProtocolCompletion(
	item: Protocol.CompletionItem,
	position: IPosition,
	wordRange: IRange,
	defaults?: Protocol.CompletionList['itemDefaults']
): Editor.CompletionItem {
	const editRange = item.textEdit
		? 'range' in item.textEdit
			? item.textEdit.range
			: { insert: item.textEdit.insert, replace: item.textEdit.replace }
		: defaults?.editRange;
	let range: IRange | Editor.CompletionItemRanges = !editRange
		? wordRange
		: 'start' in editRange
			? fromProtocolRange(editRange)
			: {
					insert: fromProtocolRange(editRange.insert),
					replace: fromProtocolRange(editRange.replace)
				};
	// Preserve the upstream JSON client middleware's separate insert/replace ranges.
	if (
		'startLineNumber' in range &&
		Range.containsPosition(range, position) &&
		(range.endLineNumber > position.lineNumber || range.endColumn > position.column)
	)
		range = {
			insert: new Range(
				range.startLineNumber,
				range.startColumn,
				position.lineNumber,
				position.column
			),
			replace: range
		};
	const documentation =
		typeof item.documentation === 'string'
			? item.documentation
			: item.documentation
				? markdown(item.documentation.value, item.documentation.kind === 'plaintext')
				: undefined;
	const command = item.command;
	if (
		command &&
		(command.command !== 'editor.action.triggerSuggest' || command.arguments?.length)
	)
		throw new Error('JSON completion returned an unregistered command.');
	const format = item.insertTextFormat ?? defaults?.insertTextFormat;
	const mode = item.insertTextMode ?? defaults?.insertTextMode;
	return {
		label: item.labelDetails
			? {
					label: item.label,
					detail: item.labelDetails.detail,
					description: item.labelDetails.description
				}
			: item.label,
		kind: completionKinds[(item.kind ?? 1) - 1] ?? Editor.CompletionItemKind.Text,
		tags:
			item.deprecated || item.tags?.includes(1)
				? [Editor.CompletionItemTag.Deprecated]
				: undefined,
		detail: item.detail,
		documentation,
		sortText: item.sortText,
		filterText: item.filterText,
		preselect: item.preselect,
		insertText: item.textEdit?.newText ?? item.textEditText ?? item.insertText ?? item.label,
		insertTextRules:
			(format === 2 ? Editor.CompletionItemInsertTextRule.InsertAsSnippet : 0) |
			(mode === 1 ? Editor.CompletionItemInsertTextRule.KeepWhitespace : 0),
		range,
		commitCharacters: item.commitCharacters ?? defaults?.commitCharacters,
		additionalTextEdits: item.additionalTextEdits?.map(fromProtocolEdit),
		command: command ? { id: command.command, title: command.title } : undefined
	};
}

export function fromProtocolHover(hover: Protocol.Hover): Editor.Hover {
	const values = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
	return {
		range: hover.range ? fromProtocolRange(hover.range) : undefined,
		contents: values.map((value) =>
			typeof value === 'string'
				? markdown(value)
				: 'kind' in value
					? markdown(value.value, value.kind === 'plaintext')
					: new MarkdownString('', { supportThemeIcons: true }).appendCodeblock(
							value.language,
							value.value
						)
		)
	};
}
export function fromProtocolSymbol(symbol: Protocol.DocumentSymbol): Editor.DocumentSymbol {
	return {
		name: symbol.name,
		detail: symbol.detail ?? '',
		kind: symbol.kind - 1,
		tags: symbol.deprecated || symbol.tags?.includes(1) ? [Editor.SymbolTag.Deprecated] : [],
		range: fromProtocolRange(symbol.range),
		selectionRange: fromProtocolRange(symbol.selectionRange),
		children: symbol.children?.map(fromProtocolSymbol)
	};
}
export function fromProtocolSelection(selection: Protocol.SelectionRange): Editor.SelectionRange[] {
	const ranges: Editor.SelectionRange[] = [];
	let value: Protocol.SelectionRange | undefined = selection;
	while (value) {
		ranges.push({ range: fromProtocolRange(value.range) });
		value = value.parent;
	}
	return ranges;
}
export function fromProtocolDiagnostic(
	diagnostic: Protocol.Diagnostic,
	resource: URI
): IMarkerData {
	return {
		...fromProtocolRange(diagnostic.range),
		message:
			typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value,
		severity:
			[
				MarkerSeverity.Error,
				MarkerSeverity.Warning,
				MarkerSeverity.Info,
				MarkerSeverity.Hint
			][(diagnostic.severity ?? 1) - 1] ?? MarkerSeverity.Error,
		code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
		source: diagnostic.source,
		tags: diagnostic.tags?.flatMap((tag) =>
			tag === 1 ? [MarkerTag.Unnecessary] : tag === 2 ? [MarkerTag.Deprecated] : []
		),
		relatedInformation: diagnostic.relatedInformation
			?.filter((info) => info.location.uri === resource.toString())
			.map((info) => ({
				resource,
				message: info.message,
				...fromProtocolRange(info.location.range)
			}))
	};
}
