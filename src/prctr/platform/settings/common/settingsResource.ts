import { VSBuffer } from '../../../base/common/buffer.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import type { IFileService } from './configurationPorts.js';
import type { Edit } from '../../../base/common/jsonFormatter.js';
import { applyEdits } from '../../../base/common/jsonEdit.js';

/** Storage owns persistence and conflict semantics; configuration sees one URI. */
export interface SettingsStorage {
	readonly onDidChange: Event<void>;
	read(): Promise<string>;
	write(source: string): Promise<void>;
	applyEdits?(edits: readonly Edit[]): void;
}

export const userSettingsEncoding = 'utf8';

export const userSettingsResource = URI.from({
	scheme: 'proctor-settings',
	path: '/settings.json'
});

export class SettingsResourceFileService extends Disposable implements IFileService {
	private readonly changed = this._register(new Emitter<{ contains(resource: URI): boolean }>());
	readonly onDidFilesChange = this.changed.event;
	readonly onDidRunOperation = Event.None;
	constructor(
		private readonly storage: SettingsStorage,
		readonly resource = userSettingsResource
	) {
		super();
		this._register(
			storage.onDidChange(() =>
				this.changed.fire({
					contains: (candidate) => candidate.toString() === resource.toString()
				})
			)
		);
	}
	watch(_resource: URI) {
		return Disposable.None;
	}
	async readFile(resource: URI) {
		this.assertResource(resource);
		return { value: VSBuffer.fromString(await this.storage.read()) };
	}
	async writeFile(resource: URI, value: VSBuffer): Promise<void> {
		this.assertResource(resource);
		await this.storage.write(value.toString());
	}
	async writeEdits(resource: URI, source: string, edits: readonly Edit[]): Promise<void> {
		this.assertResource(resource);
		if ((await this.storage.read()) !== source)
			throw new Error('Settings changed during the edit.');
		if (this.storage.applyEdits) this.storage.applyEdits(edits);
		else await this.storage.write(applyEdits(source, [...edits]));
	}
	private assertResource(resource: URI): void {
		if (resource.toString() !== this.resource.toString())
			throw new Error('Unknown settings resource');
	}
}

/** Synchronous working document; the owner may supply a text model without exposing it here. */
export interface SettingsWorkingDocument extends SettingsStorage {
	readonly value: string;
	replace(source: string): void;
	applyEdits(edits: readonly Edit[]): void;
}

/** An explicit-save editor writes its working copy here; Save commits through the privileged owner. */
export class SettingsDraftStorage extends Disposable implements SettingsWorkingDocument {
	private readonly edited = this._register(new Emitter<readonly Edit[]>());
	readonly onDidApplyEdits = this.edited.event;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	constructor(private source: string) {
		super();
	}
	get value(): string {
		return this.source;
	}
	replace(source: string): void {
		if (source === this.source) return;
		this.source = source;
		this.changed.fire();
	}
	applyEdits(edits: readonly Edit[]): void {
		this.replace(applyEdits(this.source, [...edits]));
		this.edited.fire(edits);
	}
	async read(): Promise<string> {
		return this.source;
	}
	async write(source: string): Promise<void> {
		this.replace(source);
	}
}
