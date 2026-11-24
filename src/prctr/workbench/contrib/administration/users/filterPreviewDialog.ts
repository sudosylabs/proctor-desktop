/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createElementFactory } from '../../../../base/browser/documentElements.js';
import { ButtonControl } from '../../../../base/browser/ui/button/buttonControl.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import type {
	AdministrationFailure,
	AdministrationIntentOf,
	AdministrationValue
} from '../../../../platform/administration/common/administrationProtocol.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import {
	createProctorIcon,
	proctorIconFactory
} from '../../../../platform/theme/browser/proctorIcon.js';
import type { ProctorIconId } from '../../../../platform/theme/common/proctorIcons.js';
import { PageDialog } from '../../../browser/authenticated/pages/pageDialog.js';
import { PageFeedback } from '../../../browser/authenticated/pages/pageFeedback.js';
import { IPagePaneContext } from '../../../browser/authenticated/pages/pagePaneContext.js';
import { IAdministrationService } from '../../../services/administration/common/administration.js';
import { IAdministrationFormatService, type AdministrationText } from '../administrationFormat.js';
import { AdminChanges } from '../widgets/adminChanges.js';
import { renderDetails } from '../../../browser/authenticated/pages/pageDetails.js';
import { readOnce } from '../widgets/adminReads.js';
import './media/filterPreviewDialog.css';

type Preview = AdministrationValue<'academicPreview'>;
type Create = AdministrationIntentOf<'createAcademicPreview'>;

/** A preview is read again this often while the server checks everyone. */
const POLL_MS = 1000;
/** Names listed under "Show who" before the list says there are more. */
const SHOW_WHO = 25;

export interface FilterPreviewOptions {
	/** The change for everyone the filter matches, as the server is asked to check it. */
	readonly create: Create;
	/** How many people the filter matched when it was chosen. */
	readonly matching: number;
	/** The dialog title, as in "Enrol everyone matching in Databases (CS204)?". */
	readonly title: string;
	/** What the change is, for the facts of an expired or refused check. */
	readonly change: string;
	/** The filters, in words, for the same facts. */
	readonly filters: string;
	/** The confirming button for this many people, as in "Enrol 1,269 people". */
	confirmLabel(count: number): string;
	readonly confirmIcon: ProctorIconId;
	readonly destructive: boolean;
	/** Called once the change was sent as a job. */
	onDidCommit(): void;
}

type Stage =
	| { readonly kind: 'checking' }
	| { readonly kind: 'ready'; readonly preview: Preview }
	| { readonly kind: 'expired' | 'accessChanged'; readonly checkedAt: number }
	| { readonly kind: 'failed'; readonly reason: AdministrationFailure };

/**
 * A change for everyone a filter matches. Nothing changes until the server has checked each
 * person: the dialog says who would change, who is left as they are and who is left out and
 * why, with Show who for each. The check holds for 15 minutes; once it has expired, or the
 * viewer's access no longer covers the filter, the dialog says so and offers to check again.
 * The change itself runs as a job.
 */
export class FilterPreviewDialog extends Disposable {
	private readonly dialog: PageDialog;
	private readonly content: HTMLElement;
	private readonly feedback: PageFeedback;
	private readonly cancel: ButtonControl;
	private readonly confirm: ButtonControl;
	private readonly changes: AdminChanges;
	private readonly stageStore = this._register(new DisposableStore());
	private stage: Stage = { kind: 'checking' };
	private previewId: string | undefined;
	private checkedAt = 0;
	private committed = false;
	private working = false;
	private poll: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly options: FilterPreviewOptions,
		@IAdministrationService private readonly administration: IAdministrationService,
		@IAdministrationFormatService private readonly format: IAdministrationFormatService,
		@IPagePaneContext private readonly pane: IPagePaneContext,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		this.changes = this._register(instantiationService.createInstance(AdminChanges));
		this.dialog = this._register(
			new PageDialog(pane, { title: options.title, size: 'medium' })
		);
		const $ = createElementFactory(this.dialog.element.ownerDocument);
		this.content = $('div.prctr-admin-filter-preview', { attrs: { 'aria-live': 'polite' } });
		this.dialog.body.append(this.content);
		this.feedback = this._register(new PageFeedback(this.dialog.body));
		this.cancel = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: 'secondary',
				label: format.text('cancel')
			})
		);
		this.confirm = this._register(
			new ButtonControl(this.dialog.actions, {
				variant: options.destructive ? 'danger' : 'brand',
				label: format.text('previewChecking'),
				icon: proctorIconFactory(options.confirmIcon),
				disabled: true
			})
		);
		this._register(this.cancel.onDidRequest(() => this.close()));
		this._register(this.dialog.onDidRequestCancel(() => this.close()));
		this._register(this.confirm.onDidRequest(() => void this.act()));
		this._register({ dispose: () => clearTimeout(this.poll) });
		this.render();
		this.dialog.show(this.cancel.element);
		void this.check();
	}

	/** Asks the server to check everyone the filter matches, then follows the check. */
	private async check(): Promise<void> {
		this.setStage({ kind: 'checking' });
		this.feedback.set();
		const created = await this.changes.send(this.options.create, [this.options.title]);
		if (this._store.isDisposed) return;
		if (created === 'busy' || created.kind !== 'created') {
			if (created !== 'busy' && created.kind === 'error' && created.reason === 'cancelled') {
				this.dispose();
				return;
			}
			this.setStage({
				kind: 'failed',
				reason:
					created === 'busy' || created.kind !== 'error' ? 'unavailable' : created.reason
			});
			return;
		}
		this.previewId = created.id;
		this.checkedAt = this.format.now();
		void this.follow();
	}

	private async follow(): Promise<void> {
		const id = this.previewId;
		if (id === undefined) return;
		const read = await readOnce(this.administration, { kind: 'academicPreview', id });
		if (this._store.isDisposed || id !== this.previewId) return;
		if (read.kind === 'failure') {
			this.fail(read.reason);
			return;
		}
		const preview = read.value;
		if (preview.state === 'parsing') {
			this.poll = setTimeout(() => void this.follow(), POLL_MS);
			return;
		}
		if (preview.state !== 'preview_ready') {
			this.setStage({ kind: 'failed', reason: 'unavailable' });
			return;
		}
		this.setStage({ kind: 'ready', preview });
	}

	/** An expired or refused check is a state of its own; anything else is a failure. */
	private fail(reason: AdministrationFailure): void {
		if (reason === 'expired' || reason === 'accessChanged')
			this.setStage({ kind: reason, checkedAt: this.checkedAt });
		else this.setStage({ kind: 'failed', reason });
	}

	private async act(): Promise<void> {
		const stage = this.stage;
		if (this.working) return;
		if (stage.kind !== 'ready') {
			void this.check();
			return;
		}
		const digest = stage.preview.previewDigest;
		if (digest === undefined) return;
		this.working = true;
		this.render();
		const result = await this.changes.send(
			{
				kind: 'commitAcademicPreview',
				id: stage.preview.id,
				expectedRevision: stage.preview.revision,
				previewDigest: digest
			},
			[this.options.confirmLabel(stage.preview.summary?.willChange ?? 0)]
		);
		if (this._store.isDisposed) return;
		this.working = false;
		if (result !== 'busy' && result.kind !== 'error') {
			this.committed = true;
			this.pane.toast(this.format.text('previewRunning'));
			this.options.onDidCommit();
			this.dispose();
			return;
		}
		if (result !== 'busy' && result.reason === 'cancelled') {
			this.render();
			return;
		}
		if (result !== 'busy') {
			this.fail(result.reason);
			return;
		}
		this.render();
		this.feedback.set(this.format.text('busy'), 'error');
	}

	private setStage(stage: Stage): void {
		this.stage = stage;
		this.render();
	}

	private render(): void {
		this.stageStore.clear();
		const stage = this.stage;
		const $ = createElementFactory(this.content.ownerDocument);
		const text = (key: AdministrationText, values?: Record<string, string>) =>
			this.format.text(key, values);
		if (stage.kind === 'expired' || stage.kind === 'accessChanged') {
			this.dialog.setHeading(
				text(stage.kind === 'expired' ? 'previewExpiredTitle' : 'previewLostTitle'),
				text(stage.kind === 'expired' ? 'previewExpiredBody' : 'previewLostBody')
			);
			this.content.replaceChildren();
			renderDetails(this.content, [
				{ label: text('previewChange'), value: this.options.change },
				{ label: text('previewFilters'), value: this.options.filters },
				{
					label: text('previewChecked'),
					value: text('previewCheckedValue', {
						when: this.format.relativeStandalone(stage.checkedAt),
						count: this.format.count(this.options.matching)
					})
				}
			]);
			this.dialog.setFootnote(
				text(stage.kind === 'expired' ? 'previewExpiredNote' : 'previewLostNote')
			);
			this.setConfirm(text('previewCheckAgain'), 'action.retry', false);
			return;
		}
		this.dialog.setHeading(
			this.options.title,
			text('previewBody', {
				count: this.format.count(this.options.matching)
			})
		);
		if (stage.kind === 'checking') {
			this.content.replaceChildren(
				$('p.prctr-admin-filter-preview__checking', {
					textContent: text('previewCheckingBody', {
						count: this.format.count(this.options.matching)
					})
				})
			);
			this.dialog.setFootnote(undefined);
			this.setConfirm(text('previewChecking'), this.options.confirmIcon, true);
			return;
		}
		if (stage.kind === 'failed') {
			this.content.replaceChildren();
			this.feedback.set(this.format.failure(stage.reason), 'error');
			this.setConfirm(text('previewCheckAgain'), 'action.retry', false);
			return;
		}
		if (stage.kind !== 'ready') return;
		const summary = stage.preview.summary;
		const willChange = summary?.willChange ?? 0;
		const rows: HTMLElement[] = [
			this.resultRow(
				'change',
				text('previewWillChange', { count: this.format.count(willChange) }),
				text('previewWillChangeDetail')
			)
		];
		if ((summary?.noOp ?? 0) > 0)
			rows.push(
				this.resultRow(
					'skip',
					text('previewNoOp', { count: this.format.count(summary!.noOp) }),
					text('previewLeftAsIs'),
					{ group: 'no_op' }
				)
			);
		for (const reason of summary?.skipReasons ?? []) {
			const words = skipWords(reason.reason);
			rows.push(
				this.resultRow(
					'skip',
					reason.reason.endsWith('.self')
						? text('previewSkipSelf')
						: text(words.title, { count: this.format.count(reason.rows) }),
					text(words.detail),
					reason.reason.endsWith('.self')
						? undefined
						: { group: 'skipped', reason: reason.reason }
				)
			);
		}
		this.content.replaceChildren($('ul.prctr-admin-filter-preview__results', {}, ...rows));
		this.dialog.setFootnote(text('previewHolds'));
		this.setConfirm(
			this.options.confirmLabel(willChange),
			this.options.confirmIcon,
			willChange === 0
		);
	}

	private setConfirm(label: string, icon: ProctorIconId, disabled: boolean): void {
		this.confirm.setState({
			label,
			icon: proctorIconFactory(icon),
			disabled: disabled || this.working,
			busy: this.working
		});
	}

	private resultRow(
		kind: 'change' | 'skip',
		title: string,
		detail: string,
		who?: {
			readonly group: 'no_op' | 'skipped';
			readonly reason?: string;
		}
	): HTMLElement {
		const document = this.content.ownerDocument;
		const $ = createElementFactory(document);
		const icon = this.stageStore.add(
			createProctorIcon(document, {
				id: kind === 'change' ? 'status.success' : 'status.skipped',
				size: 18
			})
		);
		const names = $('ul.prctr-admin-filter-preview__who', { hidden: true });
		const row = $(
			'li.prctr-admin-filter-preview__row',
			{ data: { skipped: String(kind === 'skip') } },
			$(
				'span.prctr-admin-filter-preview__glyph',
				{ attrs: { 'aria-hidden': 'true' } },
				icon.element
			),
			$(
				'span.prctr-admin-filter-preview__text',
				{},
				$('span.prctr-admin-filter-preview__name', { textContent: title }),
				$('span.prctr-admin-filter-preview__detail', { textContent: detail }),
				names
			)
		);
		if (who !== undefined) {
			const show = this.stageStore.add(
				new ButtonControl(row, {
					variant: 'secondary',
					size: 'small',
					label: this.format.text('previewShowWho'),
					icon: proctorIconFactory('action.forward', 14)
				})
			);
			show.element.setAttribute('aria-expanded', 'false');
			this.stageStore.add(
				show.onDidRequest(() => void this.showWho(show.element, names, who))
			);
		}
		return row;
	}

	/** Lists the people of one group, the first page of them, in place. */
	private async showWho(
		button: HTMLElement,
		list: HTMLElement,
		who: { readonly group: 'no_op' | 'skipped'; readonly reason?: string }
	): Promise<void> {
		const open = !list.hidden;
		list.hidden = open;
		button.setAttribute('aria-expanded', String(!open));
		if (open || list.childElementCount > 0 || this.previewId === undefined) return;
		const rows = await readOnce(this.administration, {
			kind: 'academicPreviewRows',
			id: this.previewId,
			group: who.group,
			...(who.reason === undefined ? {} : { reason: who.reason }),
			limit: SHOW_WHO
		} as AdministrationIntentOf<'academicPreviewRows'>);
		if (this._store.isDisposed) return;
		const $ = createElementFactory(list.ownerDocument);
		if (rows.kind === 'failure') {
			list.replaceChildren($('li', { textContent: this.format.failure(rows.reason) }));
			return;
		}
		list.replaceChildren(
			...rows.value.items.map((row) => $('li', { textContent: row.displayName })),
			...(rows.value.cursor === undefined
				? []
				: [$('li', { textContent: this.format.text('previewMoreWho') })])
		);
	}

	private close(): void {
		if (this.working) return;
		this.dispose();
	}

	override dispose(): void {
		if (this._store.isDisposed) return;
		// A check nobody committed is withdrawn rather than left to expire.
		if (!this.committed && this.previewId !== undefined && this.stage.kind === 'ready')
			void this.administration.change({ kind: 'cancelAcademicPreview', id: this.previewId });
		super.dispose();
		this.pane.focusPage();
	}
}

/** The words for one reason a person is left out. */
function skipWords(reason: string): {
	readonly title: AdministrationText;
	readonly detail: AdministrationText;
} {
	switch (reason.slice(reason.lastIndexOf('.') + 1)) {
		case 'enrollment_conflict':
			return { title: 'previewSkipConflict', detail: 'previewLeftAsIs' };
		case 'student_affiliation_required':
			return { title: 'previewSkipNotStudents', detail: 'previewSkipNotStudentsDetail' };
		case 'system_administrator':
			return { title: 'previewSkipSystem', detail: 'previewSkipSystemDetail' };
		default:
			return { title: 'previewSkipAmbiguous', detail: 'previewSkipAmbiguousDetail' };
	}
}
