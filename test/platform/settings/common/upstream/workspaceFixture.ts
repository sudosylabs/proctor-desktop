/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port user-settings-common
import { URI } from '../../../../../src/prctr/base/common/uri.ts';
import { TernarySearchTree } from '../../../../../src/prctr/base/common/ternarySearchTree.ts';
import { joinPath, basenameOrAuthority } from '../../../../../src/prctr/base/common/resources.ts';
import { isLinux } from '../../../../../src/prctr/base/common/platform.ts';
export interface IWorkspace {

	/**
	 * the unique identifier of the workspace.
	 */
	readonly id: string;

	/**
	 * Folders in the workspace.
	 */
	readonly folders: IWorkspaceFolder[];

	/**
	 * Transient workspaces are meant to go away after being used
	 * once, e.g. a window reload of a transient workspace will
	 * open an empty window.
	 */
	readonly transient?: boolean;

	/**
	 * the location of the workspace configuration
	 */
	readonly configuration?: URI | null;

	/**
	 * Optional display name for the workspace.
	 */
	readonly name?: string;

}

export function isWorkspace(thing: unknown): thing is IWorkspace {
	const candidate = thing as IWorkspace | undefined;

	return !!(candidate && typeof candidate === 'object'
		&& typeof candidate.id === 'string'
		&& Array.isArray(candidate.folders));
}

export interface IWorkspaceFolderData {

	/**
	 * The associated URI for this workspace folder.
	 */
	readonly uri: URI;

	/**
	 * The name of this workspace folder. Defaults to
	 * the basename of its [uri-path](#Uri.path)
	 */
	readonly name: string;

	/**
	 * The ordinal number of this workspace folder.
	 */
	readonly index: number;
}

export interface IWorkspaceFolder extends IWorkspaceFolderData {

	/**
	 * Given workspace folder relative path, returns the resource with the absolute path.
	 */
	toResource: (relativePath: string) => URI;
}

export function isWorkspaceFolder(thing: unknown): thing is IWorkspaceFolder {
	const candidate = thing as IWorkspaceFolder;

	return !!(candidate && typeof candidate === 'object'
		&& URI.isUri(candidate.uri)
		&& typeof candidate.name === 'string'
		&& typeof candidate.toResource === 'function');
}

export class Workspace implements IWorkspace {

	private foldersMap: TernarySearchTree<URI, WorkspaceFolder>;

	private _folders!: WorkspaceFolder[];
	get folders(): WorkspaceFolder[] { return this._folders; }
	set folders(folders: WorkspaceFolder[]) {
		this._folders = folders;
		this.updateFoldersMap();
	}

	constructor(
		private _id: string,
		folders: WorkspaceFolder[],
		private _transient: boolean = false,
		private _configuration: URI | null = null,
		private ignorePathCasing: (key: URI) => boolean = () => !isLinux,
		private _workspaceName?: string,
	) {
		this.foldersMap = TernarySearchTree.forUris<WorkspaceFolder>(this.ignorePathCasing, () => true);
		this.folders = folders;
	}

	update(workspace: Workspace) {
		this._id = workspace.id;
		this._configuration = workspace.configuration;
		this._transient = workspace.transient;
		this._workspaceName = workspace.name;
		this.ignorePathCasing = workspace.ignorePathCasing;
		this.folders = workspace.folders;
	}

	get id(): string {
		return this._id;
	}

	get transient(): boolean {
		return this._transient;
	}

	get configuration(): URI | null {
		return this._configuration;
	}

	set configuration(configuration: URI | null) {
		this._configuration = configuration;
	}

	get name(): string | undefined {
		return this._workspaceName;
	}

	getFolder(resource: URI): IWorkspaceFolder | null {
		if (!resource) {
			return null;
		}

		return this.foldersMap.findSubstr(resource) || null;
	}

	private updateFoldersMap(): void {
		this.foldersMap = TernarySearchTree.forUris<WorkspaceFolder>(this.ignorePathCasing, () => true);
		for (const folder of this.folders) {
			this.foldersMap.set(folder.uri, folder);
		}
	}

	toJSON(): IWorkspace {
		return { id: this.id, folders: this.folders, transient: this.transient, configuration: this.configuration, name: this.name };
	}
}

export interface IRawFileWorkspaceFolder {
	readonly path: string;
	name?: string;
}

export interface IRawUriWorkspaceFolder {
	readonly uri: string;
	name?: string;
}

export class WorkspaceFolder implements IWorkspaceFolder {

	readonly uri: URI;
	readonly name: string;
	readonly index: number;

	constructor(
		data: IWorkspaceFolderData,
		/**
		 * Provides access to the original metadata for this workspace
		 * folder. This can be different from the metadata provided in
		 * this class:
		 * - raw paths can be relative
		 * - raw paths are not normalized
		 */
		readonly raw?: IRawFileWorkspaceFolder | IRawUriWorkspaceFolder
	) {
		this.uri = data.uri;
		this.index = data.index;
		this.name = data.name;
	}

	toResource(relativePath: string): URI {
		return joinPath(this.uri, relativePath);
	}

	toJSON(): IWorkspaceFolderData {
		return { uri: this.uri, name: this.name, index: this.index };
	}
}

export function toWorkspaceFolder(resource: URI): WorkspaceFolder {
	return new WorkspaceFolder({ uri: resource, index: 0, name: basenameOrAuthority(resource) }, { uri: resource.toString() });
}

