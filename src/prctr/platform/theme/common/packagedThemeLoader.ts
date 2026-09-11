import { URI } from '../../../base/common/uri.js';
import { BUNDLED_THEMES } from './bundledThemes.js';
import { ColorThemeData } from './colorThemeData.js';
import { getThemeTypeSelector } from './themeService.js';
import { ExtensionData } from './workbenchThemeService.js';
import { StorageScope, StorageTarget, type IStorageService } from './themeDataAdapters.js';

/** A single serialized theme slot, used identically by build preparation and runtime reads. */
export class ThemeSnapshotStorage implements IStorageService {
	constructor(private value?: string) {}
	get(key: string, scope: number): string | undefined {
		if (key !== ColorThemeData.STORAGE_KEY || scope !== StorageScope.PROFILE)
			throw new Error('Unexpected theme snapshot read.');
		return this.value;
	}
	store(key: string, value: string, scope: number, target: number): void {
		if (
			key !== ColorThemeData.STORAGE_KEY ||
			scope !== StorageScope.PROFILE ||
			target !== StorageTarget.USER
		)
			throw new Error('Unexpected theme snapshot write.');
		this.value = value;
	}
	serialize(): string {
		if (this.value === undefined) throw new Error('Theme snapshot is not prepared.');
		return this.value;
	}
}

export async function loadPackagedTheme(
	name: string,
	resources: Readonly<Record<string, string>>
): Promise<ColorThemeData> {
	const entry = BUNDLED_THEMES.find((theme) => theme.name === name);
	if (!entry) throw new Error('Unknown packaged theme.');
	const model = ColorThemeData.fromExtensionTheme(
		{
			id: entry.name,
			label: entry.name,
			path: entry.path,
			uiTheme: getThemeTypeSelector(entry.scheme),
			_watch: false
		},
		URI.from({ scheme: 'prctr-theme', authority: 'bundled', path: '/' + entry.path }),
		ExtensionData.fromName('GitHub', 'github-vscode-theme', true)
	);
	let reads = 0;
	await model.ensureLoaded({
		readExtensionResource: async (uri) => {
			if (++reads > 256) throw new Error('Packaged theme resource graph exceeds its bound.');
			if (
				uri.scheme !== 'prctr-theme' ||
				uri.authority !== 'bundled' ||
				uri.query ||
				uri.fragment
			)
				throw new Error('Theme resource is outside the packaged catalog.');
			const key = uri.path.slice(1);
			if (!Object.hasOwn(resources, key)) throw new Error('Theme resource is not packaged.');
			return resources[key];
		}
	});
	return model;
}

export async function prepareThemeSnapshots(
	resources: Readonly<Record<string, string>>
): Promise<Record<string, string>> {
	const snapshots: Record<string, string> = Object.create(null);
	for (const entry of BUNDLED_THEMES) {
		const model = await loadPackagedTheme(entry.name, resources);
		const storage = new ThemeSnapshotStorage();
		model.toStorage(storage);
		snapshots[entry.name] = storage.serialize();
	}
	return snapshots;
}

export function restorePackagedTheme(snapshot: string): ColorThemeData {
	const model = ColorThemeData.fromStorageData(new ThemeSnapshotStorage(snapshot));
	if (!model) throw new Error('Packaged theme snapshot is invalid.');
	model.isLoaded = true;
	return model;
}
