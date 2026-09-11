import { Emitter, Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type { IWorkbenchColorTheme } from '../../../../platform/theme/common/workbenchThemeService.js';
import type { BrowserThemeService } from '../../../../platform/theme/browser/themeService.js';
import type { IColorTheme, IFileIconTheme, IProductIconTheme, IThemeService } from '../../../../platform/theme/common/themeService.js';
import { FileIconThemeData } from '../../themes/browser/fileIconThemeData.js';
import { ProductIconThemeData } from '../../themes/browser/productIconThemeData.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { getIconsStyleSheet } from '../../../../platform/theme/browser/iconsStyleSheet.js';
import { PackagedFileIconTheme } from './packagedFileIconTheme.js';
import type { ILanguageService } from '../../../../editor/common/languages/language.js';

/** The editor consumes the same resolved theme as the window, including token styles. */
export const IEditorThemeService = createDecorator<IEditorThemeService>('editorThemeService');
export interface IEditorThemeService extends IThemeService {
	getColorTheme(): IWorkbenchColorTheme;
}

export class EditorThemeService extends Disposable implements IEditorThemeService {
	declare readonly _serviceBrand: undefined;
	readonly onDidColorThemeChange: Event<IColorTheme>;
	// Icon themes are immutable packaged choices, with no user extension registration.
	private readonly fileIconThemeChange = this._register(new Emitter<IFileIconTheme>());
	readonly onDidFileIconThemeChange = this.fileIconThemeChange.event;
	readonly onDidProductIconThemeChange = Event.None;
	private readonly fileIcons: PackagedFileIconTheme;

	constructor(private readonly presentation: BrowserThemeService, document: Document) {
		super();
		this.fileIcons = this._register(new PackagedFileIconTheme(document));
		this.onDidColorThemeChange = Event.map(presentation.onDidChangeTheme, theme => theme.colorTheme);
		// Keep WorkbenchThemeService's registry/theme invalidation and coalescing;
		// constructed sheets preserve the renderer's no-inline-style CSP.
		const sheet = new document.defaultView!.CSSStyleSheet();
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
		this._register({ dispose: () => { document.adoptedStyleSheets = document.adoptedStyleSheets.filter(value => value !== sheet); } });
		const icons = this._register(getIconsStyleSheet(this));
		const update = this._register(new RunOnceScheduler(() => sheet.replaceSync(icons.getCSS()), 0));
		this._register(icons.onDidChange(() => update.schedule()));
		update.schedule();
	}

	getColorTheme(): IWorkbenchColorTheme { return this.presentation.theme.colorTheme; }
	async initialize(languages: ILanguageService): Promise<void> {
		await this.fileIcons.initialize(languages);
		this.fileIconThemeChange.fire(this.getFileIconTheme());
	}
	getFileIconTheme(): IFileIconTheme { return this.fileIcons.data.isLoaded ? this.fileIcons.data : FileIconThemeData.noIconTheme; }
	getProductIconTheme(): IProductIconTheme { return ProductIconThemeData.defaultTheme; }
}
