/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-browser-host

import type { IContextMenuItem, IPopupOptions, ISerializableContextMenuItem, IContextMenuTransport } from '../common/contextmenu.js';
import { toDisposable, type IDisposable } from '../../../common/lifecycle.js';

let contextMenuIdPool = 0;

export function popup(transport: IContextMenuTransport, items: IContextMenuItem[], options: IPopupOptions = {}, onHide?: () => void, onError?: () => void): IDisposable {
	const processedItems: IContextMenuItem[] = [];
	const contextMenuId = contextMenuIdPool++;
	let finished = false;
	void transport.popup(contextMenuId, items.map(item => createItem(item, processedItems)), options).then(selection => {
		if (finished) return;
		finished = true;
		try {
			if (selection) processedItems[selection.id]?.click?.(selection.event);
		} finally { onHide?.(); }
	}, () => {
		if (finished) return;
		finished = true;
		try { onError?.(); } finally { onHide?.(); }
	});
	return toDisposable(() => {
		if (finished) return;
		finished = true;
		void transport.cancel(contextMenuId).catch(() => onError?.());
		onHide?.();
	});
}

function createItem(item: IContextMenuItem, processedItems: IContextMenuItem[]): ISerializableContextMenuItem {
	const serializableItem: ISerializableContextMenuItem = {
		id: processedItems.length,
		label: item.label,
		type: item.type,
		accelerator: item.accelerator,
		checked: item.checked,
		enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
		visible: typeof item.visible === 'boolean' ? item.visible : true
	};

	processedItems.push(item);

	// Submenu
	if (Array.isArray(item.submenu)) {
		serializableItem.submenu = item.submenu.map(submenuItem => createItem(submenuItem, processedItems));
	}

	return serializableItem;
}
