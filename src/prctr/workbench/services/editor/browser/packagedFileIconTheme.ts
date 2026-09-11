import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import type { ILanguageService } from '../../../../editor/common/languages/language.js';
import { FileIconThemeData, FileIconThemeLoader } from '../../themes/browser/fileIconThemeData.js';
import seti from '../../../../../../resources/file-icons/seti/vs-seti-icon-theme.json' with { type: 'json' };
import setiFont from '../../../../../../resources/file-icons/seti/seti.woff';

/** The built-in VS Code file icon theme, loaded without an extension host or network access. */
export class PackagedFileIconTheme extends Disposable {
	readonly data = FileIconThemeData.createUnloadedTheme('vs-seti');
	private readonly sheet: CSSStyleSheet;
	private disposed = false;

	constructor(private readonly document: Document) {
		super();
		this.sheet = new document.defaultView!.CSSStyleSheet();
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.sheet];
		this._register({ dispose: () => {
			this.disposed = true;
			document.adoptedStyleSheets = document.adoptedStyleSheets.filter(value => value !== this.sheet);
		} });
	}

	async initialize(languages: ILanguageService): Promise<void> {
		// Only the bundled font location changes. Preserve the complete mapping,
		// including light/high-contrast associations and language fallbacks.
		const packaged = structuredClone(seti);
		packaged.fonts[0].src[0].path = setiFont;
		const location = URI.parse(new URL('vs-seti-icon-theme.json', this.document.baseURI).href);
		this.data.location = location;
		const loader = new FileIconThemeLoader({ readExtensionResource: async resource => {
			if (resource.toString() !== location.toString()) throw new Error('Unknown packaged file icon resource.');
			return JSON.stringify(packaged);
		} }, languages);
		const css = await this.data.ensureLoaded(loader);
		if (this.disposed) return;
		// Keep the source stylesheet intact; contain its selectors within the
		// existing editor scope. Font faces remain available to its file labels.
		this.sheet.replaceSync(`@scope (.prctr-editor-scope) { ${css ?? ''} }`);
	}
}
