/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type {
	AdministrationListPageSize,
	AdministrationLists,
	SavedUserView
} from '../../../../platform/settings/common/administrationLists.js';
import { parseSettingsDocument } from '../../../../platform/settings/common/settingsDocument.js';
import { SettingsDraft } from '../../../../platform/settings/common/settingsDraft.js';
import type { UserSettingsProjection } from '../../../../platform/settings/common/settingsRendererProtocol.js';
import { settingsRegistry } from '../../../../platform/settings/common/settingsRegistry.js';
import { IUserSettingsService } from '../../settings/common/settingsRendererClient.js';

const SETTING = 'administration.lists';

export const IAdministrationListsService = createDecorator<IAdministrationListsService>(
	'administrationListsService'
);

/**
 * What Administration remembers about its lists for this person: each list's page size and
 * the saved views of Users. It lives in the person's settings, so it follows them to any
 * computer; a change from elsewhere arrives as an event.
 */
export interface IAdministrationListsService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	/** Settles once the settings have been read; until then nothing is remembered yet. */
	readonly ready: Promise<void>;
	pageSize(list: string): AdministrationListPageSize | undefined;
	readonly userViews: readonly SavedUserView[];
	setPageSize(list: string, size: AdministrationListPageSize): Promise<boolean>;
	/** Replaces the saved views; settles `false` when the settings can't be saved now. */
	setUserViews(views: readonly SavedUserView[]): Promise<boolean>;
}

export class AdministrationListsService extends Disposable implements IAdministrationListsService {
	declare readonly _serviceBrand: undefined;
	private readonly changeEmitter = this._register(new Emitter<void>());
	readonly onDidChange = this.changeEmitter.event;
	readonly ready: Promise<void>;
	private projection: UserSettingsProjection | undefined;
	private value: AdministrationLists = {};
	private serial: Promise<unknown> = Promise.resolve();

	constructor(@IUserSettingsService private readonly settings: IUserSettingsService) {
		super();
		const unsubscribe = settings.onDidChange((projection) => this.receive(projection));
		this._register({ dispose: unsubscribe });
		this.ready = settings.projection().then(
			(projection) => this.receive(projection),
			() => undefined
		);
	}

	get userViews(): readonly SavedUserView[] {
		return this.value.userViews ?? [];
	}

	pageSize(list: string): AdministrationListPageSize | undefined {
		return this.value.pageSizes?.[list];
	}

	setPageSize(list: string, size: AdministrationListPageSize): Promise<boolean> {
		return this.update((value) => ({
			...value,
			pageSizes: { ...value.pageSizes, [list]: size }
		}));
	}

	setUserViews(views: readonly SavedUserView[]): Promise<boolean> {
		return this.update((value) => ({ ...value, userViews: [...views] }));
	}

	private receive(projection: UserSettingsProjection): void {
		this.projection = projection;
		const parsed = parseSettingsDocument(projection.source);
		const next =
			(parsed.valid
				? settingsRegistry.normalize(SETTING, parsed.values.get(SETTING) ?? {})
				: undefined) ?? {};
		if (JSON.stringify(next) === JSON.stringify(this.value)) return;
		this.value = next;
		this.changeEmitter.fire();
	}

	/** One save at a time; a save that meets someone else's applies the change to theirs once. */
	private update(change: (value: AdministrationLists) => AdministrationLists): Promise<boolean> {
		const run = async (): Promise<boolean> => {
			for (let attempt = 0; attempt < 2; attempt++) {
				const projection = this.projection;
				if (projection === undefined || !projection.writable) return false;
				const draft = new SettingsDraft(projection.source, projection.revision);
				try {
					await draft.set(SETTING, change(this.value));
					const response = await this.settings.commit({
						source: draft.source,
						expectedRevision: projection.revision,
						idempotencyKey: crypto.randomUUID()
					});
					if (response.kind === 'success') {
						this.receive(response.projection);
						return true;
					}
					if (response.kind !== 'conflict') return false;
					this.receive(response.projection);
				} catch {
					return false;
				} finally {
					draft.dispose();
				}
			}
			return false;
		};
		const result = this.serial.then(run, run);
		this.serial = result;
		return result;
	}
}
