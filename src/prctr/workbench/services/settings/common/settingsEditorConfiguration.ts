import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ConfigurationService } from '../../../../platform/configuration/common/configurationService.js';
import {
	ConfigurationTarget,
	isConfigurationOverrides,
	isConfigurationUpdateOverrides,
	type IConfigurationOverrides,
	type IConfigurationUpdateOptions,
	type IConfigurationUpdateOverrides
} from '../../../../platform/configuration/common/configuration.js';
import { NullPolicyService } from '../../../../platform/policy/common/policy.js';
import { NullLogService } from '../../../../platform/settings/common/configurationPorts.js';
import { parseSettingsDocument } from '../../../../platform/settings/common/settingsDocument.js';
import { registerSettingsConfiguration } from '../../../../platform/settings/common/settingsConfigurationRegistry.js';
import { settingsRegistry } from '../../../../platform/settings/common/settingsRegistry.js';
import {
	SettingsResourceFileService,
	userSettingsResource,
	type SettingsStorage
} from '../../../../platform/settings/common/settingsResource.js';
import type { SettingsDraft } from '../../../../platform/settings/common/settingsDraft.js';

export const ISettingsEditorConfiguration = createDecorator<SettingsEditorConfiguration>(
	'settingsEditorConfiguration'
);

/** Derived configuration is never the editable source. Unknown JSON properties cannot activate services. */
class SettingsConfigurationInput extends Disposable implements SettingsStorage {
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	private source = '{}';

	update(source: string): void {
		const document = parseSettingsDocument(source);
		if (!document.valid) return;
		const active: Record<string, unknown> = Object.create(null);
		for (const [key, value] of document.values) {
			const declaration = settingsRegistry.declaration(key);
			if (
				declaration &&
				declaration.candidate !== 'prohibited' &&
				declaration.windows.includes('authenticated')
			)
				active[key] = value;
		}
		for (const [language, values] of document.languageValues) {
			const overrides: Record<string, unknown> = Object.create(null);
			for (const [key, value] of values) {
				const declaration = settingsRegistry.declaration(key);
				if (
					declaration?.languageOverride &&
					declaration.candidate !== 'prohibited' &&
					declaration.windows.includes('authenticated')
				)
					overrides[key] = value;
			}
			if (Object.keys(overrides).length) active[`[${language}]`] = overrides;
		}
		const next = JSON.stringify(active);
		if (next === this.source) return;
		this.source = next;
		this.changed.fire();
	}

	async read(): Promise<string> {
		return this.source;
	}
	async write(): Promise<void> {
		throw new Error('Edit the Settings working document to change configuration.');
	}
}

/** Retains original reads, inspection and change events; edits target the shared draft only. */
export class SettingsEditorConfiguration extends ConfigurationService {
	private draft: SettingsDraft | undefined;
	private previewEnabled = true;
	private acknowledgedSource: string;
	private readonly input: SettingsConfigurationInput;
	private readonly pendingEdits = new Set<Promise<void>>();
	private readonly pendingChanged = this._register(new Emitter<void>());
	readonly onDidChangePendingEdits = this.pendingChanged.event;

	constructor(initialSource: string) {
		registerSettingsConfiguration();
		const input = new SettingsConfigurationInput();
		input.update(initialSource);
		const files = new SettingsResourceFileService(input);
		super(userSettingsResource, files, new NullPolicyService(), new NullLogService());
		this.input = this._register(input);
		this.acknowledgedSource = initialSource;
		this._register(files);
	}

	/** The modal installs its current draft after creating the model with this service's defaults. */
	bindDraft(draft: SettingsDraft | undefined): void {
		this.draft = draft;
		if (draft) this.input.update(this.previewEnabled ? draft.source : this.acknowledgedSource);
	}

	unbindDraft(draft: SettingsDraft): void {
		if (this.draft === draft) this.draft = undefined;
	}

	async refresh(): Promise<void> {
		this.input.update(
			this.previewEnabled && this.draft ? this.draft.source : this.acknowledgedSource
		);
		await this.reloadConfiguration();
	}

	async setPreviewEnabled(enabled: boolean): Promise<void> {
		this.previewEnabled = enabled;
		await this.refresh();
	}

	acknowledge(source: string): void {
		this.acknowledgedSource = source;
	}

	get hasPendingEdits(): boolean {
		return this.pendingEdits.size > 0;
	}

	async flushPendingEdits(): Promise<void> {
		const failures: unknown[] = [];
		while (this.pendingEdits.size) {
			const results = await Promise.allSettled([...this.pendingEdits]);
			for (const result of results)
				if (result.status === 'rejected') failures.push(result.reason);
		}
		if (failures.length)
			throw new AggregateError(failures, 'A Settings edit could not be applied.');
	}

	override updateValue(
		key: string,
		value: unknown,
		arg3?: ConfigurationTarget | IConfigurationOverrides | IConfigurationUpdateOverrides,
		arg4?: ConfigurationTarget,
		options?: IConfigurationUpdateOptions
	): Promise<void> {
		const operation = this.updateDraftValue(key, value, arg3, arg4, options);
		this.pendingEdits.add(operation);
		this.pendingChanged.fire();
		const settled = (): void => {
			this.pendingEdits.delete(operation);
			this.pendingChanged.fire();
		};
		void operation.then(settled, settled);
		return operation;
	}

	private async updateDraftValue(
		key: string,
		value: unknown,
		arg3?: ConfigurationTarget | IConfigurationOverrides | IConfigurationUpdateOverrides,
		arg4?: ConfigurationTarget,
		_options?: IConfigurationUpdateOptions
	): Promise<void> {
		const draft = this.draft;
		if (!draft) throw new Error('No Settings working document is open.');
		const overrides = isConfigurationUpdateOverrides(arg3)
			? arg3
			: isConfigurationOverrides(arg3)
				? {
						resource: arg3.resource,
						overrideIdentifiers: arg3.overrideIdentifier
							? [arg3.overrideIdentifier]
							: undefined
					}
				: undefined;
		const target = overrides ? arg4 : arg3;
		if (
			target !== undefined &&
			target !== ConfigurationTarget.USER &&
			target !== ConfigurationTarget.USER_LOCAL
		)
			throw new Error('This Settings window has one user target.');
		if (
			overrides?.resource &&
			overrides.resource.toString() !== userSettingsResource.toString()
		)
			throw new Error('Configuration resource does not belong to this Settings window.');
		const languages = [...new Set(overrides?.overrideIdentifiers ?? [])];
		if (languages.length > 1)
			throw new Error('Edit one registered language override at a time.');
		await draft.set(key, value, languages[0]);
		await this.refresh();
	}
}
