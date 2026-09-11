/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-modal-services

import { localize } from '../../../../base/common/vscodeNls.js';
import { URI } from '../../../../base/common/uri.js';
import { IDisposable, Disposable } from '../../../../base/common/lifecycle.js';
import { posix, win32 } from '../../../../base/common/path.js';
import { Emitter } from '../../../../base/common/event.js';


import { IWorkspace, isWorkspace, ISingleFolderWorkspaceIdentifier, isSingleFolderWorkspaceIdentifier, isWorkspaceIdentifier, IWorkspaceIdentifier, toWorkspaceIdentifier, WORKSPACE_EXTENSION, isTemporaryWorkspace } from '../../../../platform/workspace/common/workspace.js';
import { basename, dirname, isEqualOrParent, joinPath, relativePath } from '../../../../base/common/resources.js';
import { tildify, getPathLabel } from '../../../../base/common/labels.js';
import { ILabelService, ResourceLabelFormatter, ResourceLabelFormatting, IFormatterChangeEvent, Verbosity, ResourceLabelTemplateFormatter } from '../../../../platform/label/common/label.js';

import { match } from '../../../../base/common/glob.js';


import { OperatingSystem, OS } from '../../../../base/common/platform.js';

import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { Memento } from '../../../common/memento.js';
import { escapeRegExpCharacters } from '../../../../base/common/strings.js';

const posixPathSeparatorRegexp = /\//g;
const winPathSeparatorRegexp = /[\\\/]/g;
const labelMatchingRegexp = /\$\{(scheme|authoritySuffix|authority|path|(query)\.(.+?))\}/g;

function hasDriveLetterIgnorePlatform(path: string): boolean {
	return !!(path && path[2] === ':');
}

const FORMATTER_CACHE_SIZE = 50;

interface IStoredFormatters {
	formatters?: ResourceLabelFormatter[];
	i?: number;
}

interface IHomeFormatterRegistration {
	readonly formatter: ResourceLabelTemplateFormatter;
	readonly templateMatcher: RegExp;
}

interface IResolvedHomeFormatter {
	readonly home: URI;
	readonly formatting: ResourceLabelFormatting;
	readonly literalLabel: boolean;
	readonly homeLength: number;
	readonly authorityLength: number;
}

const homeTemplateParameterRegex = /^\$\{(?<name>[a-zA-Z_][\w]*)\}$/;

function isTemplateFormatter(formatter: ResourceLabelFormatter | ResourceLabelTemplateFormatter): formatter is ResourceLabelTemplateFormatter {
	return URI.isUri(formatter.home);
}

export class LabelService extends Disposable implements ILabelService {

	declare readonly _serviceBrand: undefined;

	private formatters: ResourceLabelFormatter[];
	private homeFormatters: IHomeFormatterRegistration[] = [];

	private readonly _onDidChangeFormatters = this._register(new Emitter<IFormatterChangeEvent>({ leakWarningThreshold: 400, leakWarningName: 'LabelService._onDidChangeFormatters' }));
	readonly onDidChangeFormatters = this._onDidChangeFormatters.event;

	private readonly storedFormattersMemento: Memento<IStoredFormatters>;
	private readonly storedFormatters: IStoredFormatters;
	private os: OperatingSystem;
	private userHome: URI | undefined;

	constructor(


		@IStorageService storageService: IStorageService,

	) {
		super();

		// Find some meaningful defaults until the remote environment
		// is resolved, by taking the current OS we are running in
		// and by taking the local `userHome` if we run on a local
		// file scheme.
		this.os = OS;
		// The virtual Settings namespace has no local or remote home path.

		const memento = this.storedFormattersMemento = new Memento('cachedResourceLabelFormatters2', storageService);
		this.storedFormatters = memento.getMemento(StorageScope.PROFILE, StorageTarget.MACHINE);
		this.formatters = this.storedFormatters?.formatters?.slice() || [];

	}

	getUriHome(resource: URI): URI | undefined {
		const formatter = this.findHomeFormatter(resource);
		return formatter?.home;
	}

	private findHomeFormatter(resource: URI): IResolvedHomeFormatter | undefined {
		let bestResult = this.findStaticHomeFormatter(resource);
		let bestResultIsTemplate = false;
		for (const registration of this.homeFormatters) {
			const formatter = registration.formatter;
			if (formatter.home.scheme !== resource.scheme ||
				(formatter.home.authority && formatter.home.authority.toLowerCase() !== resource.authority.toLowerCase())) {
				continue;
			}
			const templateMatch = registration.templateMatcher.exec(resource.path);
			if (!templateMatch) {
				continue;
			}
			const parameters = new Map(Object.entries(templateMatch.groups ?? {}));
			const home = resource.with({ path: templateMatch[0], query: null, fragment: null });
			const formatting = formatter.formatting({ resource, home, parameters });
			if (!formatting) {
				continue;
			}

			const result: IResolvedHomeFormatter = {
				home,
				formatting,
				literalLabel: true,
				homeLength: home.path.length,
				authorityLength: formatter.home.authority.length,
			};
			if (!bestResult ||
				result.homeLength > bestResult.homeLength ||
				(result.homeLength === bestResult.homeLength && result.authorityLength > bestResult.authorityLength) ||
				(result.homeLength === bestResult.homeLength && result.authorityLength === bestResult.authorityLength && !bestResultIsTemplate)
			) {
				bestResult = result;
				bestResultIsTemplate = true;
			}
		}
		return bestResult;
	}

	private findStaticHomeFormatter(resource: URI): IResolvedHomeFormatter | undefined {
		let bestResult: IResolvedHomeFormatter | undefined;
		for (const formatter of this.formatters) {
			if (!formatter.home || formatter.scheme !== resource.scheme ||
				(formatter.authority && !match(formatter.authority, resource.authority, { ignoreCase: true })) ||
				!isEqualOrParent(resource, resource.with({ path: formatter.home }))) {
				continue;
			}

			const result: IResolvedHomeFormatter = {
				home: resource.with({ path: formatter.home, query: null, fragment: null }),
				formatting: formatter.formatting,
				literalLabel: false,
				homeLength: formatter.home.length,
				authorityLength: formatter.authority?.length ?? 0,
			};
			if (!bestResult ||
				result.homeLength > bestResult.homeLength ||
				(result.homeLength === bestResult.homeLength && result.authorityLength > bestResult.authorityLength) ||
				(result.homeLength === bestResult.homeLength && result.authorityLength === bestResult.authorityLength && formatter.priority)
			) {
				bestResult = result;
			}
		}
		return bestResult;
	}

	findFormatting(resource: URI): ResourceLabelFormatting | undefined {
		let bestResult: ResourceLabelFormatter | undefined;
		for (const formatter of this.formatters) {
			if (formatter.home || formatter.scheme !== resource.scheme) {
				continue;
			}
			if (!formatter.authority && (!bestResult || formatter.priority)) {
				bestResult = formatter;
				continue;
			}
			if (!formatter.authority) {
				continue;
			}
			if (match(formatter.authority, resource.authority, { ignoreCase: true }) &&
				(
					!bestResult?.authority ||
					formatter.authority.length > bestResult.authority.length ||
					((formatter.authority.length === bestResult.authority.length) && formatter.priority)
				)
			) {
				bestResult = formatter;
			}
		}
		return bestResult?.formatting;
	}

	getUriLabel(resource: URI, options: { relative?: boolean; noPrefix?: boolean; separator?: '/' | '\\'; appendWorkspaceSuffix?: boolean } = {}): string {
		const homeFormatter = options.noPrefix ? undefined : this.findHomeFormatter(resource);
		if (homeFormatter) {
			const separator = options.separator ?? homeFormatter.formatting.separator;
			const path = relativePath(homeFormatter.home, resource);
			const label = homeFormatter.literalLabel ? homeFormatter.formatting.label : this.formatUri(homeFormatter.home, homeFormatter.formatting);
			return path ? `${label}${separator}${this.adjustPathSeparators(path, separator)}` : label;
		}

		let formatting = this.findFormatting(resource);
		if (formatting && options.separator) {
			// mixin separator if defined from the outside
			formatting = { ...formatting, separator: options.separator };
		}

		let label = this.doGetUriLabel(resource, formatting, options);

		// Without formatting we still need to support the separator
		// as provided in options (https://github.com/microsoft/vscode/issues/130019)
		if (!formatting && options.separator) {
			label = this.adjustPathSeparators(label, options.separator);
		}

		if (options.appendWorkspaceSuffix && formatting?.workspaceSuffix) {
			label = this.appendWorkspaceSuffix(label, resource);
		}

		return label;
	}

	private doGetUriLabel(resource: URI, formatting?: ResourceLabelFormatting, options: { relative?: boolean; noPrefix?: boolean } = {}): string {
		if (!formatting) {
			return getPathLabel(resource, {
				os: this.os,
				tildify: this.userHome ? { userHome: this.userHome } : undefined,
			});
		}

		// Absolute label
		return this.formatUri(resource, formatting, options.noPrefix);
	}

	getUriBasenameLabel(resource: URI): string {
		const formatting = this.findFormatting(resource);
		const label = this.doGetUriLabel(resource, formatting);

		let pathLib: typeof win32 | typeof posix;
		if (formatting?.separator === win32.sep) {
			pathLib = win32;
		} else if (formatting?.separator === posix.sep) {
			pathLib = posix;
		} else {
			pathLib = (this.os === OperatingSystem.Windows) ? win32 : posix;
		}

		return pathLib.basename(label);
	}

	getWorkspaceLabel(workspace: IWorkspace | IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | URI, options?: { verbose: Verbosity }): string {
		if (isWorkspace(workspace)) {
			const identifier = toWorkspaceIdentifier(workspace);
			if (isSingleFolderWorkspaceIdentifier(identifier) || isWorkspaceIdentifier(identifier)) {
				return this.getWorkspaceLabel(identifier, options);
			}

			return '';
		}

		// Workspace: Single Folder (as URI)
		if (URI.isUri(workspace)) {
			return this.doGetSingleFolderWorkspaceLabel(workspace, options);
		}

		// Workspace: Single Folder (as workspace identifier)
		if (isSingleFolderWorkspaceIdentifier(workspace)) {
			return this.doGetSingleFolderWorkspaceLabel(workspace.uri, options);
		}

		// Workspace: Multi Root
		if (isWorkspaceIdentifier(workspace)) {
			return this.doGetWorkspaceLabel(workspace.configPath, options);
		}

		return '';
	}

	private doGetWorkspaceLabel(workspaceUri: URI, options?: { verbose: Verbosity }): string {

		// Workspace: Temporary
		if (isTemporaryWorkspace(workspaceUri)) {
			return localize('temporaryWorkspace', "Workspace");
		}

		// Workspace: Saved
		let filename = basename(workspaceUri);
		if (filename.endsWith(WORKSPACE_EXTENSION)) {
			filename = filename.substr(0, filename.length - WORKSPACE_EXTENSION.length - 1);
		}

		let label: string;
		switch (options?.verbose) {
			case Verbosity.SHORT:
				label = filename; // skip suffix for short label
				break;
			case Verbosity.LONG:
				label = localize('workspaceNameVerbose', "{0} (Workspace)", this.getUriLabel(joinPath(dirname(workspaceUri), filename)));
				break;
			case Verbosity.MEDIUM:
			default:
				label = localize('workspaceName', "{0} (Workspace)", filename);
				break;
		}

		if (options?.verbose === Verbosity.SHORT) {
			return label; // skip suffix for short label
		}

		return this.appendWorkspaceSuffix(label, workspaceUri);
	}

	private doGetSingleFolderWorkspaceLabel(folderUri: URI, options?: { verbose: Verbosity }): string {
		let label: string;
		switch (options?.verbose) {
			case Verbosity.LONG:
				label = this.getUriLabel(folderUri);
				break;
			case Verbosity.SHORT:
			case Verbosity.MEDIUM:
			default:
				label = basename(folderUri) || posix.sep;
				break;
		}

		if (options?.verbose === Verbosity.SHORT) {
			return label; // skip suffix for short label
		}

		return this.appendWorkspaceSuffix(label, folderUri);
	}

	getSeparator(scheme: string, authority?: string): '/' | '\\' {
		const formatter = this.findFormatting(URI.from({ scheme, authority }));

		return formatter?.separator || posix.sep;
	}

	getHostLabel(scheme: string, authority?: string): string {
		const formatter = this.findFormatting(URI.from({ scheme, authority }));

		return formatter?.workspaceSuffix || authority || '';
	}

	getHostTooltip(scheme: string, authority?: string): string | undefined {
		const formatter = this.findFormatting(URI.from({ scheme, authority }));

		return formatter?.workspaceTooltip;
	}

	registerCachedFormatter(formatter: ResourceLabelFormatter): IDisposable {
		const list = this.storedFormatters.formatters ??= [];

		let replace = list.findIndex(f => f.scheme === formatter.scheme && f.authority === formatter.authority);
		if (replace === -1 && list.length >= FORMATTER_CACHE_SIZE) {
			replace = FORMATTER_CACHE_SIZE - 1; // at max capacity, replace the last element
		}

		if (replace === -1) {
			list.unshift(formatter);
		} else {
			for (let i = replace; i > 0; i--) {
				list[i] = list[i - 1];
			}
			list[0] = formatter;
		}

		this.storedFormattersMemento.saveMemento();

		return this.registerFormatter(formatter);
	}

	registerFormatter(formatter: ResourceLabelFormatter | ResourceLabelTemplateFormatter): IDisposable {
		let homeRegistration: IHomeFormatterRegistration | undefined;
		let scheme: string;
		if (isTemplateFormatter(formatter)) {
			homeRegistration = this.createTemplateFormatterRegistration(formatter);
			this.homeFormatters.push(homeRegistration);
			scheme = formatter.home.scheme;
		} else {
			this.formatters.push(formatter);
			scheme = formatter.scheme;
		}
		this._onDidChangeFormatters.fire({ scheme });
		const changeListener = homeRegistration?.formatter.onDidChangeFormatting(() => this._onDidChangeFormatters.fire({ scheme }));

		return {
			dispose: () => {
				changeListener?.dispose();
				this.formatters = this.formatters.filter(f => f !== formatter);
				if (homeRegistration) {
					this.homeFormatters = this.homeFormatters.filter(candidate => candidate !== homeRegistration);
				}
				this._onDidChangeFormatters.fire({ scheme });
			}
		};
	}

	private createTemplateFormatterRegistration(formatter: ResourceLabelTemplateFormatter): IHomeFormatterRegistration {
		const { home } = formatter;
		const homePath = home.path.length > 1 ? home.path.replace(/\/+$/, '') : home.path;
		const parameterNames = new Set<string>();
		const matcherPattern = homePath.split('/').map(segment => {
			const parameterMatch = homeTemplateParameterRegex.exec(segment);
			if (parameterMatch?.groups?.name) {
				const parameterName = parameterMatch.groups.name;
				if (parameterNames.has(parameterName)) {
					throw new Error(`Duplicate resource label home template parameter: ${parameterName}`);
				}
				parameterNames.add(parameterName);
				return `(?<${parameterName}>(?!\\.{1,2}(?:/|$))[^/]+)`;
			}
			if (segment.includes('${')) {
				throw new Error(`Resource label home template parameters must occupy an entire path segment: ${segment}`);
			}
			return escapeRegExpCharacters(segment);
		}).join('/');
		const isRootHome = homePath === '' || homePath === '/';
		return {
			formatter,
			templateMatcher: new RegExp(`^${matcherPattern}${isRootHome ? '' : '(?=/|$)'}`),
		};
	}

	private formatUri(resource: URI, formatting: ResourceLabelFormatting, forceNoTildify?: boolean): string {
		let label = formatting.label.replace(labelMatchingRegexp, (match, token, qsToken, qsValue) => {
			switch (token) {
				case 'scheme': return resource.scheme;
				case 'authority': return resource.authority;
				case 'authoritySuffix': {
					const i = resource.authority.indexOf('+');
					return i === -1 ? resource.authority : resource.authority.slice(i + 1);
				}
				case 'path': {
					let pathValue = resource.path;
					if (formatting.stripPathSegments) {
						let pos = 0;
						for (let i = 0; i < formatting.stripPathSegments; i++) {
							const next = pathValue.indexOf('/', pos + 1);
							if (next === -1) {
								break;
							}
							pos = next;
						}
						pathValue = pathValue.substring(pos);
					}
					return formatting.stripPathStartingSeparator
						? pathValue.slice(pathValue[0] === formatting.separator ? 1 : 0)
						: pathValue;
				}
				default: {
					if (qsToken === 'query') {
						const { query } = resource;
						if (query && query[0] === '{' && query[query.length - 1] === '}') {
							try {
								return JSON.parse(query)[qsValue] || '';
							} catch { }
						}
					}

					return '';
				}
			}
		});

		// convert \c:\something => C:\something
		if (formatting.normalizeDriveLetter && hasDriveLetterIgnorePlatform(label)) {
			label = label.charAt(1).toUpperCase() + label.substr(2);
		}

		if (formatting.tildify && !forceNoTildify) {
			if (this.userHome) {
				label = tildify(label, this.userHome.fsPath, this.os);
			}
		}

		if (formatting.authorityPrefix && resource.authority) {
			label = formatting.authorityPrefix + label;
		}

		return this.adjustPathSeparators(label, formatting.separator);
	}

	private adjustPathSeparators(label: string, separator: '/' | '\\' | ''): string {
		return label.replace(this.os === OperatingSystem.Windows ? winPathSeparatorRegexp : posixPathSeparatorRegexp, separator);
	}

	private appendWorkspaceSuffix(label: string, uri: URI): string {
		const formatting = this.findFormatting(uri);
		const suffix = formatting && (typeof formatting.workspaceSuffix === 'string') ? formatting.workspaceSuffix : undefined;

		return suffix ? `${label} [${suffix}]` : label;
	}
}

