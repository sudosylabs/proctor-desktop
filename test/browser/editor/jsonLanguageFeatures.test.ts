import assert from '../upstream/assert.ts';
import { suite, test } from '../upstream/testAdapter.ts';
import { createEditorTestServices } from './editorTestServices.ts';
import { SettingsWorkingCopy } from '../../../src/prctr/workbench/services/settings/browser/settingsWorkingCopy.ts';
import {
	JsonLanguageClient,
	PackagedJsonWorkerFactory
} from '../../../src/prctr/editor/browser/languages/json/jsonLanguageClient.ts';
import { JsonLanguageFeatures } from '../../../src/prctr/editor/browser/languages/json/jsonLanguageFeatures.ts';
import { PackagedJsonSchemas } from '../../../src/prctr/editor/common/languages/json/packagedJsonSchemas.ts';
import { settingsSchema } from '../../../src/prctr/platform/settings/common/settingsSchema.generated.ts';
import { tokenCustomizationSchemas } from '../../../src/prctr/platform/theme/common/tokenCustomizationSchemas.generated.ts';
import { settingsRegistry } from '../../../src/prctr/platform/settings/common/settingsRegistry.ts';
import { ILanguageFeaturesService } from '../../../src/prctr/editor/common/services/languageFeatures.ts';
import { CancellationToken } from '../../../src/prctr/base/common/cancellation.ts';
import { Position } from '../../../src/prctr/editor/common/core/position.ts';
import { Range } from '../../../src/prctr/editor/common/core/range.ts';
import {
	CompletionItemKind,
	CompletionItemInsertTextRule,
	CompletionTriggerKind,
	CodeActionTriggerType
} from '../../../src/prctr/editor/common/languages.ts';
import { MarkerService } from '../../../src/prctr/platform/markers/common/markerService.ts';
import { IMarkerService } from '../../../src/prctr/platform/markers/common/markers.ts';
import { SettingsJsonDiagnostics } from '../../../src/prctr/workbench/services/settings/browser/settingsJsonDiagnostics.ts';
import { SETTINGS_DOCUMENT_LIMITS } from '../../../src/prctr/platform/settings/common/settingsDocument.ts';

suite('Settings JSON providers with real server worker', () => {
	test('completion, hover, formatting, symbols, ranges, colors and sort use the shared model', async () => {
		const source = '{\n  \n}';
		const f = await createEditorTestServices(source);
		try {
			const copy = f.store.add(
				f.instantiation.createInstance(SettingsWorkingCopy, source, 'r1')
			);
			const uri = 'prctr-schema://settings/document';
			const client = f.store.add(
				new JsonLanguageClient(
					copy.document.model,
					new PackagedJsonSchemas(
						new Map([
							[uri, JSON.stringify(settingsSchema)],
							...Object.entries(tokenCustomizationSchemas).map(
								([key, schema]): [string, string] => [key, JSON.stringify(schema)]
							)
						])
					),
					uri,
					new PackagedJsonWorkerFactory(document),
					SETTINGS_DOCUMENT_LIMITS
				)
			);
			const registration = f.store.add(
				f.instantiation.createInstance(JsonLanguageFeatures, client)
			);
			const features = f.instantiation.invokeFunction((accessor) =>
				accessor.get(ILanguageFeaturesService)
			);
			const model = copy.document.model;
			const completion = await features.completionProvider
				.ordered(model)[0]!
				.provideCompletionItems(
					model,
					new Position(2, 3),
					{ triggerKind: CompletionTriggerKind.Invoke },
					CancellationToken.None
				);
			const item = completion?.suggestions.find((value) => value.label === 'editor.fontSize');
			assert.ok(item, 'The generated registry schema did not produce Settings completion.');
			assert.strictEqual(item.kind, CompletionItemKind.Property);
			assert.ok((item.insertTextRules ?? 0) & CompletionItemInsertTextRule.InsertAsSnippet);
			copy.document.replace(
				'{\n"editor.fontSize": 18,\n"workbench.colorCustomizations": {"editor.background": "#123456"}\n}'
			);
			const hover = await features.hoverProvider
				.ordered(model)[0]!
				.provideHover(model, new Position(2, 4), CancellationToken.None);
			assert.ok(hover?.contents.length);
			const symbols = await features.documentSymbolProvider
				.ordered(model)[0]!
				.provideDocumentSymbols(model, CancellationToken.None);
			assert.strictEqual(symbols?.length, 2);
			const ranges = await features.selectionRangeProvider
				.ordered(model)[0]!
				.provideSelectionRanges(model, [new Position(2, 4)], CancellationToken.None);
			assert.ok((ranges?.[0]?.length ?? 0) > 1);
			const folds = await features.foldingRangeProvider
				.ordered(model)[0]!
				.provideFoldingRanges(model, {}, CancellationToken.None);
			assert.ok(folds?.length);
			const colors = await features.colorProvider
				.ordered(model)[0]!
				.provideDocumentColors(model, CancellationToken.None);
			assert.ok(colors?.length);
			const presentations = await features.colorProvider
				.ordered(model)[0]!
				.provideColorPresentations(model, colors[0]!, CancellationToken.None);
			assert.ok(presentations?.[0]?.textEdit);
			const beforeFormat = copy.draft.source;
			const edits = await features.documentFormattingEditProvider
				.ordered(model)[0]!
				.provideDocumentFormattingEdits(
					model,
					{ tabSize: 2, insertSpaces: true },
					CancellationToken.None
				);
			assert.ok(edits?.length);
			model.pushStackElement();
			model.pushEditOperations(null, edits, () => null);
			model.pushStackElement();
			assert.ok(copy.draft.source !== beforeFormat);
			await model.undo();
			assert.strictEqual(copy.draft.source, beforeFormat);
			copy.document.replace('{"z": 1, "a": 2}');
			const actions = features.codeActionProvider.ordered(model)[0]!;
			const list = await actions.provideCodeActions(
				model,
				model.getFullModelRange(),
				{ trigger: CodeActionTriggerType.Invoke },
				CancellationToken.None
			);
			assert.ok(list?.actions[0]);
			const action = await actions.resolveCodeAction!(
				list.actions[0],
				CancellationToken.None
			);
			assert.ok(action?.edit?.edits.length);
			assert.strictEqual(action.command, undefined);
			list.dispose();
			registration.dispose();
			assert.strictEqual(features.completionProvider.ordered(model).length, 0);
		} finally {
			f.store.dispose();
		}
	});

	test('diagnostics combine authoritative bounds and worker schema results without duplicates or stale versions', async () => {
		const source = '{"editor.fontSize": 2}';
		const f = await createEditorTestServices(source);
		try {
			const copy = f.store.add(
				f.instantiation.createInstance(SettingsWorkingCopy, source, 'r1')
			);
			const markers = f.store.add(new MarkerService());
			f.services.set(IMarkerService, markers);
			const uri = 'prctr-schema://settings/document';
			const client = f.store.add(
				new JsonLanguageClient(
					copy.document.model,
					new PackagedJsonSchemas(
						new Map([
							[uri, JSON.stringify(settingsSchema)],
							...Object.entries(tokenCustomizationSchemas).map(
								([key, schema]): [string, string] => [key, JSON.stringify(schema)]
							)
						])
					),
					uri,
					new PackagedJsonWorkerFactory(document),
					SETTINGS_DOCUMENT_LIMITS
				)
			);
			const registration = f.store.add(
				f.instantiation.createInstance(JsonLanguageFeatures, client)
			);
			const diagnostics = f.store.add(
				f.instantiation.createInstance(SettingsJsonDiagnostics, registration)
			);
			await registration.validate();
			assert.strictEqual(markers.read({ resource: copy.document.model.uri }).length, 1);
			assert.ok(
				markers
					.read({ resource: copy.document.model.uri })[0]!
					.message.includes(
						String(settingsRegistry.declaration('editor.fontSize')!.minimum)
					),
				'The JSON schema minimum was hidden by a generic settings error.'
			);
			copy.document.replace('{"editor.wordWrap": "invalid"}');
			await registration.validate();
			const enumMarkers = markers.read({ resource: copy.document.model.uri });
			assert.strictEqual(enumMarkers.length, 1);
			assert.ok(
				enumMarkers[0]!.message.includes('off') &&
					enumMarkers[0]!.message.includes('wordWrapColumn'),
				'The JSON diagnostic lost the valid enum alternatives.'
			);
			copy.document.replace('{"editor.fontSize":18,"editor.fontSize":20}');
			await registration.validate();
			const duplicateMarkers = markers.read({ resource: copy.document.model.uri });
			const duplicate = duplicateMarkers.find((marker) => marker.code === 'duplicate-key');
			assert.ok(duplicate, 'Duplicate settings stopped blocking Save.');
			assert.strictEqual(
				duplicateMarkers.filter((marker) =>
					Range.areIntersectingOrTouching(marker, duplicate)
				).length,
				1,
				'The repeated property is diagnosed twice.'
			);
			copy.document.replace('{"editor.fontSize": 18}');
			assert.strictEqual(markers.read({ resource: copy.document.model.uri }).length, 0);
			await registration.validate();
			assert.strictEqual(markers.read({ resource: copy.document.model.uri }).length, 0);
			copy.document.replace('{"unknown.future": true}');
			await registration.validate();
			assert.strictEqual(
				markers.read({ resource: copy.document.model.uri })[0]?.code,
				'unknown-setting'
			);
			assert.strictEqual(copy.draft.source, '{"unknown.future": true}');
			const pending = client.request('textDocument/hover', {
				position: { line: 0, character: 3 }
			});
			copy.document.model.pushEditOperations(
				null,
				[{ range: new Range(1, 2, 1, 2), text: ' ' }],
				() => null
			);
			let cancelled = false;
			try {
				await pending;
			} catch {
				cancelled = true;
			}
			assert.strictEqual(cancelled, true);
			diagnostics.dispose();
			assert.strictEqual(markers.read({ resource: copy.document.model.uri }).length, 0);
		} finally {
			f.store.dispose();
		}
	});
});

suite('Settings JSON worker input bounds', () => {
	test('oversize and deeply nested drafts stay editable, retire their worker, and recover after repair', async () => {
		const f = await createEditorTestServices('{}');
		try {
			const copy = f.store.add(
				f.instantiation.createInstance(SettingsWorkingCopy, '{}', 'r1')
			);
			const uri = 'prctr-schema://settings/document';
			let creations = 0;
			const workers = new PackagedJsonWorkerFactory(document);
			const client = f.store.add(
				new JsonLanguageClient(
					copy.document.model,
					new PackagedJsonSchemas(
						new Map([
							[uri, JSON.stringify(settingsSchema)],
							...Object.entries(tokenCustomizationSchemas).map(
								([key, schema]): [string, string] => [key, JSON.stringify(schema)]
							)
						])
					),
					uri,
					{
						create() {
							creations++;
							return workers.create();
						}
					},
					SETTINGS_DOCUMENT_LIMITS
				)
			);
			for (const source of [
				'{"unknown":' + '[},'.repeat(10000) + '0' + ']'.repeat(10000) + '}',
				'{"unknown":' + '['.repeat(10000) + '0' + ']'.repeat(10000) + '}',
				'{"unknown":"' + 'x'.repeat(SETTINGS_DOCUMENT_LIMITS.maxBytes) + '"}'
			]) {
				copy.document.replace(source);
				let rejected = false;
				try {
					await client.request('json/validate', {});
				} catch {
					rejected = true;
				}
				assert.strictEqual(rejected, true);
				assert.strictEqual(creations, 0);
				assert.strictEqual(copy.draft.source, source);
			}
			copy.document.replace('{"editor.fontSize":18}');
			assert.strictEqual((await client.request('json/validate', {})).length, 0);
			assert.strictEqual(creations, 1);
			copy.document.replace('{"unknown":' + '['.repeat(10000));
			copy.document.replace('{"editor.fontSize":20}');
			assert.strictEqual((await client.request('json/validate', {})).length, 0);
			assert.strictEqual(creations, 2);
		} finally {
			f.store.dispose();
		}
	});
});

suite('Settings JSON worker response bounds', () => {
	test('rejects oversized symbols with recoverable feedback and returns full results after repair', async () => {
		const source = JSON.stringify(
			Object.fromEntries(Array.from({ length: 2050 }, (_, index) => [`field${index}`, index]))
		);
		const f = await createEditorTestServices('{}');
		try {
			const copy = f.store.add(
				f.instantiation.createInstance(SettingsWorkingCopy, source, 'r1')
			);
			const uri = 'prctr-schema://settings/document';
			const client = f.store.add(
				new JsonLanguageClient(
					copy.document.model,
					new PackagedJsonSchemas(new Map([[uri, '{}']])),
					uri,
					new PackagedJsonWorkerFactory(document),
					SETTINGS_DOCUMENT_LIMITS
				)
			);
			let failures = 0;
			f.store.add(client.onDidFail(() => failures++));
			let rejected = false;
			try {
				await client.request('textDocument/documentSymbol', {});
			} catch {
				rejected = true;
			}
			assert.strictEqual(rejected, true);
			assert.strictEqual(failures, 1);
			assert.strictEqual(copy.draft.source, source);
			copy.document.replace('{"editor.fontSize":18}');
			const symbols = await client.request('textDocument/documentSymbol', {});
			assert.strictEqual(symbols.length, 1);
			assert.strictEqual(symbols[0]!.name, 'editor.fontSize');
		} finally {
			f.store.dispose();
		}
	});
});
