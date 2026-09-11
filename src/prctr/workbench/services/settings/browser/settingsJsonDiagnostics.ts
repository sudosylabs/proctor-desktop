import { parseTree } from '../../../../base/common/json.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../base/common/vscodeNls.js';
import { Range } from '../../../../editor/common/core/range.js';
import { JsonLanguageFeatures, type JsonValidationResult } from '../../../../editor/browser/languages/json/jsonLanguageFeatures.js';
import { fromProtocolDiagnostic } from '../../../../editor/browser/languages/json/jsonProtocolConversions.js';
import { IMarkerService, MarkerSeverity, MarkerTag, type IMarkerData } from '../../../../platform/markers/common/markers.js';
import { parseSettingsDocument } from '../../../../platform/settings/common/settingsDocument.js';
import { settingsRegistry } from '../../../../platform/settings/common/settingsRegistry.js';

/** Authoritative settings bounds and JSON-language markers share one versioned diagnostic owner. */
export class SettingsJsonDiagnostics extends Disposable {
	private static readonly owner = 'prctr.settings.json';
	private language: JsonValidationResult | undefined;
	private disposed = false;

	constructor(private readonly features: JsonLanguageFeatures, @IMarkerService private readonly markers: IMarkerService) {
		super();
		this._register(features.onDidValidate(result => {
			if (features.client.model.getVersionId() !== result.version) return;
			this.language = result;
			this.publish();
		}));
		this._register(features.client.model.onDidChangeContent(() => {
			this.language = undefined;
			this.publish();
		}));
		this._register(features.client.model.onWillDispose(() => this.dispose()));
		this.publish();
	}

	private publish(): void {
		const model = this.features.client.model;
		if (this.disposed || model.isDisposed()) return;
		const source = model.getValue();
		const parsed = parseSettingsDocument(source);
		const rangeAt = (offset: number, length: number): Range => Range.fromPositions(model.getPositionAt(offset), model.getPositionAt(offset + length));
		const authoritative: IMarkerData[] = parsed.diagnostics.map(diagnostic => ({
			...rangeAt(diagnostic.offset, diagnostic.length), code: diagnostic.code,
			message: diagnostic.message, source: 'Proctor', severity: MarkerSeverity.Error
		}));
		const language = this.language?.version === model.getVersionId() ? this.language.diagnostics.map(diagnostic => fromProtocolDiagnostic(diagnostic, model.uri)) : [];
		// The JSON language service owns syntax/schema explanations (expected type,
		// enum alternatives, bounds). Keep privileged validation as the immediate
		// fallback and retain independent Proctor policy/security diagnostics.
		// JSON's DuplicateKey (520) identifies both occurrences. At a location
		// rejected by the settings parser, retain its save-blocking error once.
		const languageMarkers = language.filter(marker => marker.code !== '520' || !authoritative.some(own =>
			own.code === 'duplicate-key' && Range.areIntersectingOrTouching(own, marker)));
		const combined = [...languageMarkers, ...authoritative.filter(own => {
			const coveredByLanguage = own.code === 'syntax' || own.code === 'invalid-value' || own.code === 'invalid-root';
			return !coveredByLanguage || !language.some(marker => Range.areIntersectingOrTouching(own, marker));
		})];
		if (parsed.valid) {
			const root = parseTree(source);
			for (const property of root?.children ?? []) {
				const key = property.children?.[0];
				if (!key || typeof key.value !== 'string' || settingsRegistry.isKnown(key.value) || /^\[.+\]$/.test(key.value)) continue;
				combined.push({ ...rangeAt(key.offset, key.length), severity: MarkerSeverity.Hint, tags: [MarkerTag.Unnecessary],
					code: 'unknown-setting', source: 'Proctor', message: localize('unknownSetting', 'This setting is preserved but is not supported by Proctor.') });
			}
		}
		this.markers.changeOne(SettingsJsonDiagnostics.owner, model.uri, combined);
	}

	override dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.markers.remove(SettingsJsonDiagnostics.owner, [this.features.client.model.uri]);
		super.dispose();
	}
}
