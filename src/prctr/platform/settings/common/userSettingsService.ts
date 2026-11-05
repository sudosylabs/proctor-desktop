import { Emitter, type Event } from '../../../base/common/event.js';
import type { SettingsDiagnostic } from './settingsDocument.js';
import { parseSettingsDocument } from './settingsDocument.js';
import {
	EffectiveSettings,
	type SettingsResolutionContext,
	type SettingInspection
} from './settingsResolution.js';
import type { EffectiveSettingId, SettingValueMap } from './settingsManifest.js';

export interface AcknowledgedUserSettings {
	readonly source: string;
	readonly revision: string;
}

export interface SettingsCommitRequest {
	readonly source: string;
	readonly expectedRevision: string;
	readonly idempotencyKey: string;
}

export type SettingsCommitResult =
	| { readonly kind: 'success'; readonly revision: string }
	| { readonly kind: 'conflict'; readonly latest: AcknowledgedUserSettings }
	| { readonly kind: 'ambiguous' }
	| { readonly kind: 'unavailable' };

export interface UserSettingsService {
	readonly onDidChangeEffectiveSettings: Event<void>;
	get<K extends EffectiveSettingId>(id: K): SettingValueMap[K];
	inspect<K extends EffectiveSettingId>(id: K): SettingInspection<K>;
	validate(source: string): readonly SettingsDiagnostic[];
}

export class DefaultUserSettingsService implements UserSettingsService {
	readonly #changeEmitter = new Emitter<void>();
	readonly onDidChangeEffectiveSettings = this.#changeEmitter.event;
	#acknowledged: AcknowledgedUserSettings;
	#context: SettingsResolutionContext;
	#effective: EffectiveSettings;
	#previewSource: string | undefined;

	constructor(acknowledged: AcknowledgedUserSettings, context: SettingsResolutionContext) {
		this.#acknowledged = acknowledged;
		this.#context = context;
		this.#effective = new EffectiveSettings(
			parseSettingsDocument(acknowledged.source),
			context
		);
	}

	get<K extends EffectiveSettingId>(id: K): SettingValueMap[K] {
		return this.#effective.get(id);
	}
	inspect<K extends EffectiveSettingId>(id: K): SettingInspection<K> {
		return this.#effective.inspect(id);
	}
	validate(source: string): readonly SettingsDiagnostic[] {
		return parseSettingsDocument(source).diagnostics;
	}

	updateContext(context: SettingsResolutionContext): void {
		this.#context = context;
		this.#effective = new EffectiveSettings(
			parseSettingsDocument(this.#previewSource ?? this.#acknowledged.source),
			context
		);
		this.#changeEmitter.fire();
	}
	updateAcknowledged(acknowledged: AcknowledgedUserSettings): void {
		this.#acknowledged = acknowledged;
		this.#previewSource = undefined;
		this.#effective = new EffectiveSettings(
			parseSettingsDocument(acknowledged.source),
			this.#context
		);
		this.#changeEmitter.fire();
	}
	preview(source: string): void {
		const parsed = parseSettingsDocument(source);
		if (!parsed.valid) throw new TypeError('Cannot preview an invalid User Settings document');
		this.#previewSource = source;
		this.#effective = new EffectiveSettings(parsed, this.#context);
		this.#changeEmitter.fire();
	}
	cancelPreview(): void {
		if (this.#previewSource === undefined) return;
		this.#previewSource = undefined;
		this.#effective = new EffectiveSettings(
			parseSettingsDocument(this.#acknowledged.source),
			this.#context
		);
		this.#changeEmitter.fire();
	}

	dispose(): void {
		this.#changeEmitter.dispose();
	}
}
