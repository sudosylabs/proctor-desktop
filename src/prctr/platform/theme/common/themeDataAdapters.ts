import type { URI } from '../../../base/common/uri.js';
import type {
	IColorCustomizations,
	ITokenColorCustomizations,
	ISemanticTokenColorCustomizations
} from './workbenchThemeService.js';

/** Theme snapshots retain upstream scope/target identities without choosing a store. */
export const StorageScope = { PROFILE: 0 } as const;
export const StorageTarget = { USER: 0, MACHINE: 1 } as const;

export interface IStorageService {
	get(key: string, scope: number): string | undefined;
	store(key: string, value: string, scope: number, target: number): void;
}

/** Resource acquisition is supplied by the packaged catalog, never by a theme URI. */
export interface IExtensionResourceLoaderService {
	readExtensionResource(resource: URI): Promise<string>;
}

/** The complete customization inputs consumed by the upstream theme model. */
export interface ThemeConfiguration {
	readonly colorCustomizations: IColorCustomizations;
	readonly tokenColorCustomizations: ITokenColorCustomizations;
	readonly semanticTokenColorCustomizations: ISemanticTokenColorCustomizations;
}
