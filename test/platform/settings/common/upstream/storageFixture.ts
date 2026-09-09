import { VSBuffer } from '../../../../../src/prctr/base/common/buffer.ts';
import { Emitter, Event } from '../../../../../src/prctr/base/common/event.ts';
import { Disposable } from '../../../../../src/prctr/base/common/lifecycle.ts';
import type { URI } from '../../../../../src/prctr/base/common/uri.ts';
import {
	FileOperationError,
	FileOperationResult,
	type IFileService,
	type ILogService
} from '../../../../../src/prctr/platform/settings/common/configurationPorts.ts';
import { AbstractPolicyService } from '../../../../../src/prctr/platform/policy/common/policy.ts';

/** Exercise the configuration owner suite through Proctor's resource adapter boundary. */
export class FileService extends Disposable implements IFileService {
	private readonly sources = new Map<string, VSBuffer>();
	private readonly changed = this._register(new Emitter<{ contains(resource: URI): boolean }>());
	readonly onDidFilesChange = this.changed.event;
	readonly onDidRunOperation = Event.None;
	constructor(_log: ILogService) {
		super();
	}
	watch(_resource: URI) {
		return Disposable.None;
	}
	async readFile(resource: URI) {
		const value = this.sources.get(resource.toString());
		if (value === undefined)
			throw new FileOperationError('Missing settings', FileOperationResult.FILE_NOT_FOUND);
		return { value };
	}
	async writeFile(resource: URI, value: VSBuffer): Promise<void> {
		this.sources.set(resource.toString(), value);
		this.changed.fire({
			contains: (candidate) => candidate.toString() === resource.toString()
		});
	}
}

/** The owner test needs authoritative values, not a native machine-policy implementation. */
export class FilePolicyService extends AbstractPolicyService {
	constructor(
		private readonly resource: URI,
		private readonly files: IFileService,
		_log: ILogService
	) {
		super();
	}
	protected async _updatePolicyDefinitions(): Promise<void> {
		const values = JSON.parse((await this.files.readFile(this.resource)).value.toString());
		for (const name of Object.keys(this.policyDefinitions))
			this.policies.set(name, values[name]);
	}
}
