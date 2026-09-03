/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port platform-keybindings

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { KeybindingParser } from '../../../../base/common/keybindingParser.js';
import { KeyCodeChord, type Keybinding, type ResolvedKeybinding } from '../../../../base/common/keybindings.js';
import { type IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { OS } from '../../../../base/common/platform.js';
import type { ICommandService } from '../../../../platform/commands/common/commands.js';
import type { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { AbstractKeybindingService, type IKeybindingFeedbackService, type IKeybindingLogService, type IKeybindingStatusHandle } from '../../../../platform/keybinding/common/abstractKeybindingService.js';
import type { IKeyboardEvent, KeybindingsSchemaContribution } from '../../../../platform/keybinding/common/keybinding.js';
import { KeybindingResolver } from '../../../../platform/keybinding/common/keybindingResolver.js';
import { KeybindingsRegistry, type IKeybindingItem } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ResolvedKeybindingItem } from '../../../../platform/keybinding/common/resolvedKeybindingItem.js';
import { USLayoutResolvedKeybinding } from '../../../../platform/keybinding/common/usLayoutResolvedKeybinding.js';

export class WorkbenchKeybindingFeedbackService implements IKeybindingFeedbackService {
	#active: symbol | undefined;
	constructor(private readonly statusElement: HTMLElement) { statusElement.setAttribute('aria-live', 'polite'); }
	status(message: string, options?: { readonly hideAfter?: number }): IKeybindingStatusHandle {
		const identity = Symbol('keybindingStatus'); this.#active = identity; this.statusElement.textContent = message;
		let timeout: number | undefined; if (options?.hideAfter !== undefined) timeout = this.statusElement.ownerDocument.defaultView?.setTimeout(() => close(), options.hideAfter);
		const close = (): void => { if (timeout !== undefined) this.statusElement.ownerDocument.defaultView?.clearTimeout(timeout); if (this.#active !== identity) return; this.#active = undefined; this.statusElement.textContent = ''; };
		return Object.freeze({ close });
	}
	warn(error: unknown): void { console.error('Workbench command failed', error); }
}

const NULL_LOG_SERVICE: IKeybindingLogService = Object.freeze({ info: () => undefined, trace: () => undefined });

export class BrowserKeybindingService extends AbstractKeybindingService {
	#resolver: KeybindingResolver | undefined;
	#keybindingHoldMode: DeferredPromise<void> | undefined;
	readonly #schemaContributions = new Set<{ readonly contribution: KeybindingsSchemaContribution; readonly listener: IDisposable | undefined }>();
	constructor(private readonly document: Document, contextKeyService: IContextKeyService, commandService: ICommandService, feedbackService: IKeybindingFeedbackService, logService: IKeybindingLogService = NULL_LOG_SERVICE) {
		super(contextKeyService, commandService, feedbackService, logService);
		this._register(KeybindingsRegistry.onDidChangeKeybindings(() => { this.#resolver = undefined; this._onDidUpdateKeybindings.fire(); }));
		this._register(addDisposableListener(document, 'keydown', event => { if (this.#keybindingHoldMode !== undefined) return; const keyboardEvent = new StandardKeyboardEvent(event); if (this.dispatchEvent(keyboardEvent, keyboardEvent.target)) keyboardEvent.preventDefault(); }, true));
		this._register(addDisposableListener(document, 'keyup', event => { this.#resetKeybindingHoldMode(); const keyboardEvent = new StandardKeyboardEvent(event); if (this._singleModifierDispatch(keyboardEvent, keyboardEvent.target)) keyboardEvent.preventDefault(); }, true));
	}
	protected _getResolver(): KeybindingResolver { return this.#resolver ??= new KeybindingResolver(this.#resolveItems(KeybindingsRegistry.getDefaultKeybindings()), [], value => this._log(value)); }
	protected _documentHasFocus(): boolean { return this.document.hasFocus(); }
	resolveKeybinding(keybinding: Keybinding): ResolvedKeybinding[] { return USLayoutResolvedKeybinding.resolveKeybinding(keybinding, OS); }
	resolveKeyboardEvent(event: IKeyboardEvent): ResolvedKeybinding { return new USLayoutResolvedKeybinding([new KeyCodeChord(event.ctrlKey, event.shiftKey, event.altKey, event.metaKey, event.keyCode)], OS); }
	resolveUserBinding(userBinding: string): ResolvedKeybinding[] { const parsed = KeybindingParser.parseKeybinding(userBinding); return parsed === null ? [] : this.resolveKeybinding(parsed); }
	registerSchemaContribution(contribution: KeybindingsSchemaContribution): IDisposable {
		const entry = { contribution, listener: contribution.onDidChange?.(() => this._onDidUpdateKeybindings.fire()) };
		this.#schemaContributions.add(entry);
		return toDisposable(() => { if (this.#schemaContributions.delete(entry)) entry.listener?.dispose(); });
	}
	enableKeybindingHoldMode(commandId: string): Promise<void> | undefined {
		if (this._currentlyDispatchingCommandId !== commandId) return undefined;
		this.#resetKeybindingHoldMode();
		const hold = new DeferredPromise<void>(); this.#keybindingHoldMode = hold;
		const window = this.document.defaultView; const blurListener = window === null ? undefined : addDisposableListener(window, 'blur', () => this.#resetKeybindingHoldMode());
		void hold.p.finally(() => blurListener?.dispose());
		this._log(`+ Enabled hold-mode for ${commandId}.`);
		return hold.p;
	}
	#resetKeybindingHoldMode(): void { const hold = this.#keybindingHoldMode; if (hold === undefined) return; this.#keybindingHoldMode = undefined; void hold.complete(); }
	override dispose(): void {
		for (const entry of this.#schemaContributions) entry.listener?.dispose();
		this.#schemaContributions.clear();
		this.#resetKeybindingHoldMode();
		super.dispose();
	}
	_dumpDebugInfo(): string { return this._getResolver().getKeybindings().map(item => `${item.resolvedKeybinding?.getLabel() ?? '<unbound>'}: ${item.command ?? '<none>'}${item.when === undefined ? '' : ` when ${item.when.serialize()}`}`).join('\n'); }
	_dumpDebugInfoJSON(): string { return JSON.stringify(this._getResolver().getKeybindings().map(item => ({ command: item.command, key: item.resolvedKeybinding?.getUserSettingsLabel(), when: item.when?.serialize() })), null, 2); }
	#resolveItems(items: readonly IKeybindingItem[]): ResolvedKeybindingItem[] {
		const result: ResolvedKeybindingItem[] = [];
		for (const item of items) {
			const when = item.when ?? undefined;
			if (item.keybinding === null) result.push(new ResolvedKeybindingItem(undefined, item.command, item.commandArgs, when, true, item.extensionId, item.isBuiltinExtension));
			else for (const resolved of this.resolveKeybinding(item.keybinding).reverse()) result.push(new ResolvedKeybindingItem(resolved, item.command, item.commandArgs, when, true, item.extensionId, item.isBuiltinExtension));
		}
		return result;
	}
}
