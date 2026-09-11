import { PackagedTreeSitterAssets } from '../../../src/prctr/workbench/services/treeSitter/browser/packagedTreeSitterAssets.js';
import { TreeSitterLibraryService } from '../../../src/prctr/workbench/services/treeSitter/browser/treeSitterLibraryService.js';
import { ConfigurationService } from '../../../src/prctr/platform/configuration/common/configurationService.js';
import {
	SettingsDraftStorage,
	SettingsResourceFileService,
	userSettingsResource
} from '../../../src/prctr/platform/settings/common/settingsResource.js';
import { NullPolicyService } from '../../../src/prctr/platform/policy/common/policy.js';
import { NullLogService } from '../../../src/prctr/platform/settings/common/configurationPorts.js';

function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

export async function exerciseTreeSitterAssets(): Promise<void> {
	const assets = new PackagedTreeSitterAssets();
	const storage = new SettingsDraftStorage('{}');
	const files = new SettingsResourceFileService(storage);
	const configuration = new ConfigurationService(
		userSettingsResource,
		files,
		new NullPolicyService(),
		new NullLogService()
	);
	await configuration.initialize();
	const service = new TreeSitterLibraryService(configuration, assets);
	try {
		check(
			!service.supportsLanguage('jsonc', undefined),
			'JSONC unexpectedly enabled an unregistered Tree-sitter grammar.'
		);
		check(
			service.getLanguage('jsonc', false, undefined) === undefined,
			'Disabled grammar was loaded.'
		);
		const Parser = await service.getParserClass();
		for (const [id, source] of [
			['css', 'body { color: red; }'],
			['typescript', 'const value: number = 42;'],
			['ini', '[section]\nkey=value\n'],
			['regex', '(ab)+']
		] as const) {
			const language = await service.getLanguagePromise(id);
			check(language, 'Packaged grammar was unavailable.');
			check(
				(await service.getLanguagePromise(id)) === language,
				'Grammar cache lost identity.'
			);
			const parser = new Parser();
			parser.setLanguage(language);
			const tree = parser.parse(source);
			check(
				tree && !tree.rootNode.hasError,
				`Packaged ${id} parser rejected its fixture: ${tree?.rootNode.toString()}`
			);
			const text = await assets.loadQuery(id, 'highlights');
			check(text, 'Packaged highlighting query was unavailable.');
			const query = await service.createQuery(language, text);
			try {
				check(
					query.captures(tree.rootNode).length > 0,
					'Packaged query produced no highlighting.'
				);
			} finally {
				query.delete();
				tree.delete();
				parser.delete();
			}
		}
		check(
			(await assets.loadQuery('jsonc', 'highlights')) === undefined,
			'Missing query did not retain its absent-provider result.'
		);
		let denied = false;
		try {
			await assets.loadGrammar('../../outside');
		} catch {
			denied = true;
		}
		check(denied, 'Grammar acquisition allowed an unregistered path.');
	} finally {
		service.dispose();
		configuration.dispose();
		files.dispose();
		storage.dispose();
	}
}
