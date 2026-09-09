import { VSBuffer } from '../../../base/common/buffer.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import type { IFileService } from './configurationPorts.js';

/** Storage owns persistence and conflict semantics; configuration sees one URI. */
export interface SettingsStorage {
	readonly onDidChange: Event<void>;
	read(): Promise<string>;
	write(source: string): Promise<void>;
}

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
	private assertResource(resource: URI): void {
		if (resource.toString() !== this.resource.toString())
			throw new Error('Unknown settings resource');
	}
}

/** An explicit-save editor writes its working copy here; Save commits through the privileged owner. */
export class SettingsDraftStorage extends Disposable implements SettingsStorage {
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
	async read(): Promise<string> {
		return this.source;
	}
	async write(source: string): Promise<void> {
		this.replace(source);
	}
}
