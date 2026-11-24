/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import type { AdministrationValue } from '../../../../platform/administration/common/administrationProtocol.js';
import { createProctorIcon } from '../../../../platform/theme/browser/proctorIcon.js';
import type { IAdministrationService } from '../../../services/administration/common/administration.js';
import { readPages } from '../widgets/adminReads.js';
import './media/unitTree.css';

export type AdminUnit = AdministrationValue<'unitChildren'>['items'][number];

interface Node {
	readonly unit: AdminUnit;
	readonly depth: number;
	children: Node[] | undefined;
	expanded: boolean;
}

/**
 * The academic units as a tree, read one level at a time: root units first, a unit's children
 * when it is expanded. One unit is chosen; arrow keys move, Right and Left expand and collapse.
 */
export class UnitTree extends Disposable {
	readonly element: HTMLElement;
	private readonly list: HTMLElement;
	private readonly rowStore = this._register(new DisposableStore());
	private roots: Node[] = [];
	private chosen: string | undefined;
	private focused: string | undefined;
	private readonly selectEmitter = this._register(new Emitter<AdminUnit>());
	/** The person chose a unit. */
	readonly onDidSelect: Event<AdminUnit> = this.selectEmitter.event;

	constructor(
		host: HTMLElement,
		label: string,
		private readonly administration: IAdministrationService
	) {
		super();
		const $ = createElementFactory(host.ownerDocument);
		this.list = $('div.prctr-admin-unit-tree__list', {
			attrs: { role: 'tree', 'aria-label': label }
		});
		this.element = $('div.prctr-admin-unit-tree', {}, this.list);
		host.append(this.element);
		this._register(
			addDisposableListener(this.list, 'keydown', (event) => this.onKeyDown(event))
		);
	}

	get selected(): AdminUnit | undefined {
		return this.find(this.roots, this.chosen)?.unit;
	}

	/** Reads the root units again, keeping what was expanded and chosen when it still exists. */
	async load(): Promise<'ready' | 'empty' | { readonly failure: string }> {
		const roots = await readPages(this.administration, 'academicUnits', {}, 200);
		if (this._store.isDisposed) return 'empty';
		if (roots.kind === 'failure') return { failure: roots.reason };
		const previous = this.roots;
		this.roots = roots.value.items
			.filter((unit) => unit.archivedAt === undefined)
			.map((unit) => ({ unit, depth: 0, children: undefined, expanded: false }));
		for (const node of this.roots) {
			const before = previous.find((candidate) => candidate.unit.id === node.unit.id);
			// One root, usually the institution itself, starts open so its units show at once.
			if (before?.expanded || (before === undefined && this.roots.length === 1))
				await this.expand(node, false);
		}
		this.render();
		return this.roots.length === 0 ? 'empty' : 'ready';
	}

	/** Reads one unit's children again, as after adding or archiving one. */
	async reloadChildren(unitId: string | undefined): Promise<void> {
		if (unitId === undefined) {
			await this.load();
			return;
		}
		const node = this.find(this.roots, unitId);
		if (node === undefined) return;
		node.children = undefined;
		await this.expand(node, true);
	}

	select(unitId: string): void {
		this.chosen = unitId;
		this.focused = unitId;
		this.render();
		const node = this.find(this.roots, unitId);
		if (node !== undefined) this.selectEmitter.fire(node.unit);
	}

	private async expand(node: Node, render: boolean): Promise<void> {
		node.expanded = true;
		if (node.children === undefined) {
			const children = await readPages(
				this.administration,
				'unitChildren',
				{ unitId: node.unit.id },
				200
			);
			if (this._store.isDisposed) return;
			node.children =
				children.kind === 'data'
					? children.value.items
							.filter((unit) => unit.archivedAt === undefined)
							.map((unit) => ({
								unit,
								depth: node.depth + 1,
								children: undefined,
								expanded: false
							}))
					: [];
		}
		if (render) this.render();
	}

	private visible(): Node[] {
		const result: Node[] = [];
		const walk = (nodes: readonly Node[]) => {
			for (const node of nodes) {
				result.push(node);
				if (node.expanded && node.children !== undefined) walk(node.children);
			}
		};
		walk(this.roots);
		return result;
	}

	private find(nodes: readonly Node[], id: string | undefined): Node | undefined {
		if (id === undefined) return undefined;
		for (const node of nodes) {
			if (node.unit.id === id) return node;
			const inner = node.children === undefined ? undefined : this.find(node.children, id);
			if (inner !== undefined) return inner;
		}
		return undefined;
	}

	private render(): void {
		this.rowStore.clear();
		const $ = createElementFactory(this.list.ownerDocument);
		const nodes = this.visible();
		const focus = this.focused ?? this.chosen ?? nodes[0]?.unit.id;
		const hadFocus = this.list.contains(this.list.ownerDocument.activeElement);
		this.list.replaceChildren(
			...nodes.map((node) => {
				const leaf = node.children !== undefined && node.children.length === 0;
				const caret = this.rowStore.add(
					createProctorIcon(this.list.ownerDocument, {
						id: node.expanded ? 'action.expand' : 'action.forward',
						size: 12
					})
				);
				caret.element.classList.add('prctr-admin-unit-tree__caret');
				caret.element.dataset.leaf = String(leaf);
				const item = $(
					'div.prctr-admin-unit-tree__item',
					{
						tabIndex: node.unit.id === focus ? 0 : -1,
						data: { unitId: node.unit.id },
						attrs: {
							role: 'treeitem',
							'aria-level': String(node.depth + 1),
							'aria-selected': String(node.unit.id === this.chosen),
							...(leaf ? {} : { 'aria-expanded': String(node.expanded) })
						}
					},
					caret.element,
					$('span.prctr-admin-unit-tree__label', { textContent: node.unit.displayName })
				);
				item.style.paddingInlineStart = `${4 + node.depth * 14}px`;
				this.rowStore.add(
					addDisposableListener(caret.element, 'click', (event) => {
						event.stopPropagation();
						void this.toggle(node);
					})
				);
				this.rowStore.add(
					// Choosing a unit also opens it, so its sub-units show beside its details.
					addDisposableListener(item, 'click', () => {
						this.select(node.unit.id);
						if (!node.expanded) void this.expand(node, true);
					})
				);
				return item;
			})
		);
		if (hadFocus) this.focusItem(focus);
	}

	private async toggle(node: Node): Promise<void> {
		if (node.expanded) {
			node.expanded = false;
			this.render();
		} else await this.expand(node, true);
	}

	private focusItem(id: string | undefined): void {
		if (id === undefined) return;
		this.focused = id;
		for (const item of this.list.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
			const match = item.dataset.unitId === id;
			item.tabIndex = match ? 0 : -1;
			if (match) item.focus();
		}
	}

	private onKeyDown(event: KeyboardEvent): void {
		const nodes = this.visible();
		const index = nodes.findIndex((node) => node.unit.id === this.focused);
		const node = nodes[index];
		if (node === undefined) return;
		let handled = true;
		if (event.key === 'ArrowDown')
			this.focusItem(nodes[Math.min(index + 1, nodes.length - 1)]?.unit.id);
		else if (event.key === 'ArrowUp') this.focusItem(nodes[Math.max(index - 1, 0)]?.unit.id);
		else if (event.key === 'Home') this.focusItem(nodes[0]?.unit.id);
		else if (event.key === 'End') this.focusItem(nodes.at(-1)?.unit.id);
		else if (event.key === 'ArrowRight') {
			if (!node.expanded)
				void this.expand(node, true).then(() => this.focusItem(node.unit.id));
			else this.focusItem(node.children?.[0]?.unit.id ?? node.unit.id);
		} else if (event.key === 'ArrowLeft') {
			if (node.expanded) {
				node.expanded = false;
				this.render();
				this.focusItem(node.unit.id);
			} else {
				const parent = nodes
					.slice(0, index)
					.reverse()
					.find((candidate) => candidate.depth < node.depth);
				this.focusItem(parent?.unit.id);
			}
		} else if (event.key === 'Enter' || event.key === ' ') this.select(node.unit.id);
		else handled = false;
		if (handled) event.preventDefault();
	}
}
