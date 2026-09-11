/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port platform-context-conditions

import { Event, PauseableEmitter } from '../../../base/common/event.js';
import { Disposable, MutableDisposable, type IDisposable } from '../../../base/common/lifecycle.js';
import { equals } from '../common/contextKeyEquality.js';
import type { ContextKeyExpression, ContextKeyValue, IContext, IContextKey, IContextKeyChangeEvent, IContextKeyService, IContextKeyServiceTarget, IReadableSet, IScopedContextKeyService } from '../common/contextkey.js';

const KEYBINDING_CONTEXT_ATTR = 'data-keybinding-context';

export class Context implements IContext {
	readonly #value: Record<string, ContextKeyValue> = Object.create(null) as Record<string, ContextKeyValue>;
	#parent: Context | null;
	constructor(readonly id: number, parent: Context | null) { this.#parent = parent; this.#value._contextId = id; }
	get value(): Readonly<Record<string, ContextKeyValue>> { return { ...this.#value }; }
	setValue(key: string, value: ContextKeyValue): boolean { if (equals(this.#value[key], value)) return false; this.#value[key] = value; return true; }
	removeValue(key: string): boolean { if (!(key in this.#value)) return false; delete this.#value[key]; return true; }
	getValue<T extends ContextKeyValue>(key: string): T | undefined { const value = this.#value[key]; return value === undefined && this.#parent !== null ? this.#parent.getValue<T>(key) : value as T | undefined; }
	updateParent(parent: Context): void { this.#parent = parent; }
	collectAllValues(): Record<string, ContextKeyValue> { const result = { ...(this.#parent?.collectAllValues() ?? Object.create(null) as Record<string, ContextKeyValue>), ...this.#value }; delete result._contextId; return result; }
}

class NullContext extends Context {
	static readonly instance = new NullContext();
	private constructor() { super(-1, null); }
	override setValue(): boolean { return false; }
	override removeValue(): boolean { return false; }
	override getValue<T extends ContextKeyValue>(): T | undefined { return undefined; }
	override collectAllValues(): Record<string, ContextKeyValue> { return Object.create(null) as Record<string, ContextKeyValue>; }
}

class ContextKey<T extends ContextKeyValue> implements IContextKey<T> {
	constructor(private readonly service: AbstractContextKeyService, private readonly key: string, private readonly defaultValue: T | undefined) { this.reset(); }
	set(value: T): void { this.service.setContext(this.key, value); }
	reset(): void { if (this.defaultValue === undefined) this.service.removeContext(this.key); else this.service.setContext(this.key, this.defaultValue); }
	get(): T | undefined { return this.service.getContextKeyValue<T>(this.key); }
}

class SimpleContextKeyChangeEvent implements IContextKeyChangeEvent {
	constructor(readonly key: string) { }
	affectsSome(keys: IReadableSet<string>): boolean { return keys.has(this.key); }
	allKeysContainedIn(keys: IReadableSet<string>): boolean { return keys.has(this.key); }
}
class ArrayContextKeyChangeEvent implements IContextKeyChangeEvent {
	constructor(readonly keys: readonly string[]) { }
	affectsSome(candidates: IReadableSet<string>): boolean { return this.keys.some(key => candidates.has(key)); }
	allKeysContainedIn(candidates: IReadableSet<string>): boolean { return this.keys.every(key => candidates.has(key)); }
}
class CompositeContextKeyChangeEvent implements IContextKeyChangeEvent {
	constructor(readonly events: readonly IContextKeyChangeEvent[]) { }
	affectsSome(keys: IReadableSet<string>): boolean { return this.events.some(event => event.affectsSome(keys)); }
	allKeysContainedIn(keys: IReadableSet<string>): boolean { return this.events.every(event => event.allKeysContainedIn(keys)); }
}

export abstract class AbstractContextKeyService extends Disposable implements IContextKeyService {
	declare readonly _serviceBrand: undefined;
	protected disposed = false;
	protected readonly changeEmitter = this._register(new PauseableEmitter<IContextKeyChangeEvent>({ merge: events => new CompositeContextKeyChangeEvent(events) }));
	readonly onDidChangeContext: Event<IContextKeyChangeEvent> = this.changeEmitter.event;
	protected constructor(readonly contextId: number) { super(); }
	createKey<T extends ContextKeyValue>(key: string, defaultValue: T | undefined): IContextKey<T> { this.assertLive(); return new ContextKey(this, key, defaultValue); }
	bufferChangeEvents(callback: Function): void { this.assertLive(); this.changeEmitter.pause(); try { callback(); } finally { this.changeEmitter.resume(); } }
	createScoped(target: IContextKeyServiceTarget): IScopedContextKeyService { this.assertLive(); return new ScopedContextKeyService(this, target); }
	createOverlay(overlay: Iterable<[string, ContextKeyValue]> = []): IContextKeyService { this.assertLive(); return new OverlayContextKeyService(this, overlay); }
	contextMatchesRules(rules: ContextKeyExpression | undefined): boolean { this.assertLive(); return rules?.evaluate(this.getContextValuesContainer(this.contextId)) ?? true; }
	getContextKeyValue<T>(key: string): T | undefined { return this.disposed ? undefined : this.getContextValuesContainer(this.contextId).getValue<T & ContextKeyValue>(key) as T | undefined; }
	setContext(key: string, value: ContextKeyValue): void { if (this.disposed) return; if (this.getContextValuesContainer(this.contextId).setValue(key, value)) this.changeEmitter.fire(new SimpleContextKeyChangeEvent(key)); }
	removeContext(key: string): void { if (this.disposed) return; if (this.getContextValuesContainer(this.contextId).removeValue(key)) this.changeEmitter.fire(new SimpleContextKeyChangeEvent(key)); }
	getContext(target: IContextKeyServiceTarget | null): IContext { return this.disposed ? NullContext.instance : this.getContextValuesContainer(findContextId(target)); }
	abstract getContextValuesContainer(contextId: number): Context;
	abstract createChildContext(parentContextId?: number): number;
	abstract disposeContext(contextId: number): void;
	abstract updateParent(parentContextKeyService: IContextKeyService): void;
	protected assertLive(): void { if (this.disposed) throw new Error('ContextKeyService has been disposed'); }
	override dispose(): void { if (this.disposed) return; this.disposed = true; super.dispose(); }
}

export class ContextKeyService extends AbstractContextKeyService {
	readonly #contexts = new Map<number, Context>();
	#lastContextId = 0;
	constructor() { super(0); this.#contexts.set(0, new Context(0, null)); }
	getContextValuesContainer(contextId: number): Context { return this.disposed ? NullContext.instance : this.#contexts.get(contextId) ?? NullContext.instance; }
	createChildContext(parentContextId = this.contextId): number { this.assertLive(); const id = ++this.#lastContextId; this.#contexts.set(id, new Context(id, this.getContextValuesContainer(parentContextId))); return id; }
	disposeContext(contextId: number): void { if (!this.disposed) this.#contexts.delete(contextId); }
	updateParent(): void { throw new Error('Cannot update the parent of the root ContextKeyService'); }
}

class ScopedContextKeyService extends AbstractContextKeyService {
	#parent: AbstractContextKeyService;
	readonly #parentChangeListener = this._register(new MutableDisposable<IDisposable>());
	constructor(parent: AbstractContextKeyService, private readonly target: IContextKeyServiceTarget) {
		if (target.hasAttribute(KEYBINDING_CONTEXT_ATTR)) throw new Error('Element already owns a scoped keybinding context');
		super(parent.createChildContext()); this.#parent = parent; this.#listenToParent();
		target.setAttribute(KEYBINDING_CONTEXT_ATTR, String(this.contextId));
	}
	#listenToParent(): void { this.#parentChangeListener.value = this.#parent.onDidChangeContext(event => { const local = this.#parent.getContextValuesContainer(this.contextId).value; if (!event.allKeysContainedIn(new Set(Object.keys(local)))) this.changeEmitter.fire(event); }); }
	getContextValuesContainer(contextId: number): Context { return this.disposed ? NullContext.instance : this.#parent.getContextValuesContainer(contextId); }
	createChildContext(parentContextId = this.contextId): number { this.assertLive(); return this.#parent.createChildContext(parentContextId); }
	disposeContext(contextId: number): void { this.#parent.disposeContext(contextId); }
	updateParent(parentContextKeyService: IContextKeyService): void {
		this.assertLive();
		if (!(parentContextKeyService instanceof AbstractContextKeyService)) throw new TypeError('Scoped context parents must be mutable context services');
		if (this.#parent === parentContextKeyService) return;
		const container = this.#parent.getContextValuesContainer(this.contextId);
		if (container === NullContext.instance || parentContextKeyService.getContextValuesContainer(this.contextId) !== container) {
			throw new Error('Scoped contexts must remain in the same live root context service');
		}
		for (let ancestor: AbstractContextKeyService = parentContextKeyService; ancestor instanceof ScopedContextKeyService; ancestor = ancestor.#parent) {
			if (ancestor === this) throw new Error('Scoped context parent cycle');
		}
		const before = container.collectAllValues(); this.#parent = parentContextKeyService; this.#listenToParent(); container.updateParent(this.#parent.getContextValuesContainer(this.#parent.contextId)); const after = container.collectAllValues(); const changed = distinctKeys(before, after); this.changeEmitter.fire(new ArrayContextKeyChangeEvent(changed));
	}
	override dispose(): void { if (this.disposed) return; this.#parentChangeListener.clear(); this.#parent.disposeContext(this.contextId); this.target.removeAttribute(KEYBINDING_CONTEXT_ATTR); super.dispose(); }
}

class OverlayContext implements IContext {
	constructor(private readonly parent: IContext, private readonly overlay: ReadonlyMap<string, ContextKeyValue>) { }
	getValue<T extends ContextKeyValue>(key: string): T | undefined { return (this.overlay.has(key) ? this.overlay.get(key) : this.parent.getValue<T>(key)) as T | undefined; }
}
class OverlayContextKeyService implements IContextKeyService {
	declare readonly _serviceBrand: undefined;
	readonly #overlay: ReadonlyMap<string, ContextKeyValue>;
	constructor(private readonly parent: AbstractContextKeyService | OverlayContextKeyService, overlay: Iterable<[string, ContextKeyValue]>) { this.#overlay = new Map(overlay); }
	get contextId(): number { return this.parent.contextId; }
	get onDidChangeContext(): Event<IContextKeyChangeEvent> { return this.parent.onDidChangeContext; }
	bufferChangeEvents(callback: Function): void { this.parent.bufferChangeEvents(callback); }
	createKey<T extends ContextKeyValue>(): IContextKey<T> { throw new Error('Overlay contexts are read-only'); }
	getContextValuesContainer(contextId: number): IContext { return new OverlayContext(this.parent.getContextValuesContainer(contextId), this.#overlay); }
	contextMatchesRules(rules: ContextKeyExpression | undefined): boolean { return rules?.evaluate(this.getContextValuesContainer(this.contextId)) ?? true; }
	getContextKeyValue<T>(key: string): T | undefined { return (this.#overlay.has(key) ? this.#overlay.get(key) : this.parent.getContextKeyValue<T>(key)) as T | undefined; }
	createScoped(): IScopedContextKeyService { throw new Error('Overlay contexts cannot own DOM scopes'); }
	createOverlay(overlay: Iterable<[string, ContextKeyValue]> = []): IContextKeyService { return new OverlayContextKeyService(this, overlay); }
	getContext(target: IContextKeyServiceTarget | null): IContext { return new OverlayContext(this.parent.getContext(target), this.#overlay); }
	updateParent(): void { throw new Error('Overlay contexts cannot change parent'); }
}

function findContextId(target: IContextKeyServiceTarget | null): number {
	for (let current = target; current !== null; current = current.parentElement) {
		if (current.hasAttribute(KEYBINDING_CONTEXT_ATTR)) {
			const value = current.getAttribute(KEYBINDING_CONTEXT_ATTR);
			return value ? Number.parseInt(value, 10) : NaN;
		}
	}
	return 0;
}
function distinctKeys(left: Readonly<Record<string, ContextKeyValue>>, right: Readonly<Record<string, ContextKeyValue>>): readonly string[] { return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(key => !equals(left[key], right[key])); }
