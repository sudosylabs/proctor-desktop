import { PackagedTextMateAssets } from '../../../src/prctr/workbench/services/textMate/common/packagedTextMateAssets.js';
import { TMGrammarFactory } from '../../../src/prctr/workbench/services/textMate/common/TMGrammarFactory.js';
import { restorePackagedTheme } from '../../../src/prctr/platform/theme/common/packagedThemeLoader.js';
import { bundledThemeSnapshots } from '../../../src/prctr/platform/theme/common/bundledThemeSnapshots.generated.js';
import { URI } from '../../../src/prctr/base/common/uri.js';
import { LanguageIdCodec } from '../../../src/prctr/editor/common/services/languagesRegistry.js';
import { PackagedEditorWorkerService } from '../../../src/prctr/workbench/services/editor/browser/editorWorkerService.js';
import { ThreadedBackgroundTokenizerFactory } from '../../../src/prctr/workbench/services/textMate/browser/backgroundTokenization/threadedBackgroundTokenizerFactory.js';
import type { ITextMateTokenizationWorker } from '../../../src/prctr/workbench/services/textMate/common/backgroundTokenization/textMateWorkerProtocol.js';
import { TextMateWorkerHost } from '../../../src/prctr/workbench/services/textMate/common/backgroundTokenization/textMateWorkerHost.js';
import { ContiguousMultilineTokensBuilder } from '../../../src/prctr/editor/common/tokens/contiguousMultilineTokensBuilder.js';

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export async function exerciseTextMateAssets(): Promise<void> {
	const assets = new PackagedTextMateAssets();
	const [textMate, oniguruma] = await Promise.all([assets.loadTextMate(), assets.loadOniguruma()]);
	check(await assets.loadOniguruma() === oniguruma, 'Oniguruma runtime lost identity.');
	let denied = false;
	try { await assets.readGrammar(URI.parse('https://example.invalid/grammar')); } catch { denied = true; }
	check(denied, 'Grammar resolution admitted a nonpackaged resource.');
	const factory = new TMGrammarFactory({
		logTrace: () => {}, logError: () => { throw new Error('Packaged grammar failed to parse.'); },
		readFile: resource => assets.readGrammar(resource)
	}, [...assets.grammars], textMate, Promise.resolve(oniguruma));
	try {
		const result = await factory.createGrammar('jsonc', 2);
		const grammar = result.grammar;
		check(grammar, 'Packaged JSONC grammar is unavailable.');
		const line = '{ "value": 42 /* comment */ }';
		const scopes = grammar.tokenizeLine(line, result.initialState).tokens;
		check(scopes.some(token => token.scopes.some(scope => scope.includes('property-name'))), 'JSON property scopes were lost.');
		check(scopes.some(token => token.scopes.some(scope => scope.includes('comment.block'))), 'JSONC comments were not tokenized.');
		let previous: string | undefined;
		for (const name of ['GitHub Dark Default', 'GitHub Light Default']) {
			const theme = restorePackagedTheme(bundledThemeSnapshots[name]!);
			factory.setTheme({ name, settings: theme.tokenColors }, theme.tokenColorMap);
			const tokens = grammar.tokenizeLine2(line, result.initialState).tokens;
			check(tokens.length > 4, 'Encoded tokenization did not preserve multiple token classes.');
			const colors = theme.tokenColorMap.join(',');
			check(colors !== previous, 'Theme change retained stale token colors.');
			previous = colors;
		}
		const commentStart = grammar.tokenizeLine('/* start', result.initialState);
		const commentEnd = grammar.tokenizeLine('end */', commentStart.ruleStack);
		check(commentEnd.tokens[0]?.scopes.some(scope => scope.includes('comment.block')), 'Multiline rule stack was not retained.');
		check(!factory.has('unregistered'), 'A missing language fabricated a grammar.');
	} finally { factory.dispose(); }

	const service = new PackagedEditorWorkerService(document);
	const codec = new LanguageIdCodec();
	codec.register('jsonc');
	for (let iteration = 0; iteration < 3; iteration++) {
		const worker = service.createWorkerClient<ITextMateTokenizationWorker>(ThreadedBackgroundTokenizerFactory.workerDescriptor);
		const batches: { id: number; version: number; tokens: Uint8Array }[] = [];
		let changed: (() => void) | undefined;
		TextMateWorkerHost.setChannel(worker, {
			$readFile: resource => assets.readGrammar(URI.revive(resource)),
			$setTokensAndStates: async (id, version, tokens) => { batches.push({ id, version, tokens }); changed?.(); },
			$reportTokenizationTime: () => {}
		});
		const waitVersion = async (version: number): Promise<void> => {
			if (batches.some(batch => batch.version === version)) return;
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => { changed = undefined; reject(new Error('TextMate worker did not publish the model version.')); }, 5000);
				changed = () => { if (batches.some(batch => batch.version === version)) { clearTimeout(timeout); changed = undefined; resolve(); } };
			});
		};
		try {
			await worker.proxy.$init({ grammarDefinitions: [...assets.grammars] });
			const theme = restorePackagedTheme(bundledThemeSnapshots['GitHub Dark Default']!);
			await worker.proxy.$acceptTheme({ name: theme.label, settings: theme.tokenColors }, theme.tokenColorMap);
			await worker.proxy.$acceptNewModel({ controllerId: iteration, uri: URI.parse(`prctr-settings://principal-${iteration}/settings.json`),
				versionId: 1, EOL: '\n', lines: ['{', '"value": 42', '}'], languageId: 'jsonc', encodedLanguageId: codec.encodeLanguageId('jsonc'), maxTokenizationLineLength: 20000 });
			await waitVersion(1);
			const batch = batches.find(value => value.version === 1)!;
			check(batch.id === iteration && ContiguousMultilineTokensBuilder.deserialize(batch.tokens).length > 0, 'Worker lost its controller or encoded tokens.');
			await worker.proxy.$acceptModelChanged(iteration, { versionId: 2, eol: '\n', isUndoing: false, isRedoing: false,
				changes: [{ range: { startLineNumber: 2, startColumn: 10, endLineNumber: 2, endColumn: 12 }, rangeOffset: 11, rangeLength: 2, text: 'true' }] });
			await waitVersion(2);
			await worker.proxy.$acceptRemovedModel(iteration);
			const count = batches.length;
			await new Promise<void>(resolve => setTimeout(resolve, 50));
			check(batches.length === count, 'Removed TextMate model produced additional tokens.');
		} finally { worker.dispose(); }
	}
}

import { DisposableStore } from '../../../src/prctr/base/common/lifecycle.js';
import { DeferredPromise } from '../../../src/prctr/base/common/async.js';
import { InstantiationService } from '../../../src/prctr/platform/instantiation/common/instantiationService.js';
import { ServiceCollection } from '../../../src/prctr/platform/instantiation/common/serviceCollection.js';
import { IConfigurationService } from '../../../src/prctr/platform/configuration/common/configuration.js';
import { SettingsEditorConfiguration } from '../../../src/prctr/workbench/services/settings/common/settingsEditorConfiguration.js';
import { BrowserThemeService } from '../../../src/prctr/platform/theme/browser/themeService.js';
import { EditorThemeService } from '../../../src/prctr/workbench/services/editor/browser/editorThemeService.js';
import { LanguageService } from '../../../src/prctr/editor/common/services/languageService.js';
import { ILanguageService } from '../../../src/prctr/editor/common/languages/language.js';
import { ITextMateAssets } from '../../../src/prctr/workbench/services/textMate/common/packagedTextMateAssets.js';
import { TextMateTokenizationFeature } from '../../../src/prctr/workbench/services/textMate/browser/textMateTokenizationFeatureImpl.js';
import { NullLogService } from '../../../src/prctr/platform/log/common/log.js';
import { ITelemetryService } from '../../../src/prctr/platform/telemetry/common/telemetry.js';
import { NullTelemetryService } from '../../../src/prctr/platform/telemetry/common/telemetryUtils.js';
import { IWebWorkerService } from '../../../src/prctr/platform/webWorker/browser/webWorkerService.js';
import { INotificationService } from '../../../src/prctr/platform/notification/common/notification.js';
import { NotificationService } from '../../../src/prctr/workbench/services/notification/common/notificationService.js';
import { NotificationStorage } from '../../../src/prctr/workbench/services/notification/common/notificationStorage.js';

export async function exerciseTextMateDisposal(): Promise<void> {
	const store = new DisposableStore();
	const gate = new DeferredPromise<void>();
	let grammarReads = 0;
	class DelayedAssets extends PackagedTextMateAssets {
		override async loadTextMate() { const runtime = await super.loadTextMate(); await gate.p; return runtime; }
		override readGrammar(resource: URI) { grammarReads++; return super.readGrammar(resource); }
	}
	try {
		const assets = new DelayedAssets();
		await assets.loadOniguruma();
		const configuration = store.add(new SettingsEditorConfiguration('{}'));
		await configuration.initialize();
		const languages = store.add(new LanguageService());
		store.add(languages.registerLanguage({ id: 'jsonc' }));
		const presentation = store.add(new BrowserThemeService(document, 'dark', { density: 'default', motion: 'full', transparency: 'full' }));
		const services = new ServiceCollection(
			[IConfigurationService, configuration], [ILanguageService, languages], [ITextMateAssets, assets],
			[ITelemetryService, NullTelemetryService], [IWebWorkerService, new PackagedEditorWorkerService(document)],
			[INotificationService, store.add(new NotificationService(new NotificationStorage()))]
		);
		const instantiation = store.add(new InstantiationService(services, true));
		const theme = store.add(new EditorThemeService(presentation, document));
		const sheets = document.adoptedStyleSheets.length;
		const feature = store.add(new TextMateTokenizationFeature(languages, theme, assets, new NullLogService(), configuration, instantiation, NullTelemetryService));
		const pending = feature.createTokenizer('jsonc');
		feature.dispose();
		await gate.complete();
		let cancelled = false;
		try { await pending; } catch { cancelled = true; }
		check(cancelled, 'A disposed TextMate feature published an asynchronous grammar factory.');
		check(grammarReads === 0, 'A disposed feature loaded grammar source after its lifetime ended.');
		check(document.adoptedStyleSheets.length === sheets, 'TextMate disposal left a token stylesheet attached.');
	} finally { store.dispose(); }
}
