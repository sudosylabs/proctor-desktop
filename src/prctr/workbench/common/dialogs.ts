/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @proctor-vscode-port settings-editor-runtime-services

import { CancellationError } from '../../base/common/errors.js';
import { DeferredPromise } from '../../base/common/async.js';
import { type Event, Emitter } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import type { IDialogArgs, IDialogResult } from '../../platform/dialogs/common/dialogs.js';

export interface IDialogViewItem {
	readonly args: IDialogArgs;

	close(result?: IDialogResult | Error): void;
}

export interface IDialogHandle {
	readonly item: IDialogViewItem;
	readonly result: Promise<IDialogResult | undefined>;
}

export interface IDialogsModel {

	readonly onWillShowDialog: Event<void>;
	readonly onDidShowDialog: Event<void>;

	readonly dialogs: IDialogViewItem[];

	show(dialog: IDialogArgs): IDialogHandle;
}

export class DialogsModel extends Disposable implements IDialogsModel {

	readonly dialogs: IDialogViewItem[] = [];
	private disposed = false;

	private readonly _onWillShowDialog = this._register(new Emitter<void>());
	readonly onWillShowDialog = this._onWillShowDialog.event;

	private readonly _onDidShowDialog = this._register(new Emitter<void>());
	readonly onDidShowDialog = this._onDidShowDialog.event;

	show(dialog: IDialogArgs): IDialogHandle {
		if (this.disposed) throw new CancellationError();
		const promise = new DeferredPromise<IDialogResult | undefined>();
		let closed = false;

		const item: IDialogViewItem = {
			args: dialog,
			close: result => {
				if (closed) return;
				closed = true;
				const index = this.dialogs.indexOf(item);
				if (index >= 0) this.dialogs.splice(index, 1);
				if (result instanceof Error) {
					promise.error(result);
				} else {
					promise.complete(result);
				}
				this._onDidShowDialog.fire();
			}
		};

		this.dialogs.push(item);
		this._onWillShowDialog.fire();

		return {
			item,
			result: promise.p
		};
	}
	override dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const item of [...this.dialogs]) item.close(new CancellationError());
		super.dispose();
	}
}
