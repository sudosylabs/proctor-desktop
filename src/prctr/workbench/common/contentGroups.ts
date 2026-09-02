/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import type { WorkbenchItem } from './workbenchItem.js';

export interface WorkbenchGroupChange { readonly kind: 'active' | 'close' | 'open'; readonly item: WorkbenchItem }

export class WorkbenchGroupModel extends Disposable {
	readonly #change = this._register(new Emitter<WorkbenchGroupChange>()); readonly onDidChange: Event<WorkbenchGroupChange> = this.#change.event;
	readonly #items: WorkbenchItem[] = []; readonly #history: WorkbenchItem[] = []; #active: WorkbenchItem | undefined;
	get items(): readonly WorkbenchItem[] { return Object.freeze([...this.#items]); }
	get active(): WorkbenchItem | undefined { return this.#active; }
	get history(): readonly WorkbenchItem[] { return Object.freeze([...this.#history]); }
	open(item: WorkbenchItem): WorkbenchItem {
		const existing = this.#items.find(candidate => candidate.matches(item));
		const target = existing ?? item;
		if (existing === undefined) { this.#items.push(item); this.#change.fire({ kind: 'open', item }); }
		this.activate(target); return target;
	}
	activate(item: WorkbenchItem): void {
		const target = this.#items.find(candidate => candidate.matches(item)); if (target === undefined) throw new Error('Cannot activate an item outside this group');
		if (this.#active === target) return; this.#active = target;
		const prior = this.#history.findIndex(candidate => candidate.matches(target)); if (prior >= 0) this.#history.splice(prior, 1); this.#history.unshift(target);
		this.#change.fire({ kind: 'active', item: target });
	}
	close(item: WorkbenchItem, force = false): boolean {
		const index = this.#items.findIndex(candidate => candidate.matches(item)); if (index < 0) return false;
		const target = this.#items[index] as WorkbenchItem; if (!force && !target.closable) return false;
		this.#items.splice(index, 1); const historyIndex = this.#history.findIndex(candidate => candidate.matches(target)); if (historyIndex >= 0) this.#history.splice(historyIndex, 1);
		if (this.#active === target) this.#active = this.#history.find(candidate => this.#items.includes(candidate)) ?? this.#items[Math.min(index, this.#items.length - 1)];
		this.#change.fire({ kind: 'close', item: target }); if (this.#active !== undefined) this.#change.fire({ kind: 'active', item: this.#active }); return true;
	}
}

export type GroupSplitDirection = 'horizontal' | 'vertical';
export class WorkbenchContentModel extends Disposable {
	readonly #groups: WorkbenchGroupModel[];
	readonly maxGroups: number; readonly allowedSplits: ReadonlySet<GroupSplitDirection>;
	constructor(maxGroups: number, allowedSplits: ReadonlySet<GroupSplitDirection>) {
		super(); this.maxGroups = maxGroups; this.allowedSplits = allowedSplits; if (!Number.isSafeInteger(maxGroups) || maxGroups < 1 || maxGroups > 4) throw new RangeError('maxGroups must be an integer from 1 to 4');
		this.#groups = [this._register(new WorkbenchGroupModel())];
	}
	get groups(): readonly WorkbenchGroupModel[] { return Object.freeze([...this.#groups]); }
	split(source: WorkbenchGroupModel, direction: GroupSplitDirection): WorkbenchGroupModel {
		if (!this.#groups.includes(source)) throw new Error('Source group does not belong to this workbench');
		if (!this.allowedSplits.has(direction)) throw new Error(`${direction} content splits are not allowed by this composition`);
		if (this.#groups.length >= this.maxGroups) throw new Error('The composition content-group limit has been reached');
		const group = this._register(new WorkbenchGroupModel()); this.#groups.splice(this.#groups.indexOf(source) + 1, 0, group); return group;
	}
	remove(group: WorkbenchGroupModel): void {
		if (this.#groups.length === 1) throw new Error('The last content group cannot be removed');
		const index = this.#groups.indexOf(group); if (index < 0) throw new Error('Group does not belong to this workbench');
		this.#groups.splice(index, 1); group.dispose();
	}
}
