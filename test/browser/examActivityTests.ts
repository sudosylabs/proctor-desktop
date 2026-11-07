import { mountExamActivityFixture, sampleExams } from './examActivityFixture.js';
import type {
	ExamActivityIntent,
	ExamActivityResponse,
	ProductArea
} from '../../src/prctr/platform/examActivity/common/examActivityProtocol.js';

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}
async function eventually(predicate: () => boolean): Promise<void> {
	const deadline = performance.now() + 4000;
	while (!predicate()) {
		if (performance.now() > deadline) throw new Error('Exam activity UI did not settle');
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
export async function exerciseExamActivity(document: Document): Promise<void> {
	let areas: readonly ProductArea[] = [
		'account',
		'settings',
		'student_activity',
		'exam_management',
		'administration'
	];
	let fail = false;
	let delayed: ((response: ExamActivityResponse) => void) | undefined;
	const requests: ExamActivityIntent[] = [];
	const result = await mountExamActivityFixture(document, {
		async request(intent) {
			requests.push(intent);
			if (intent.kind === 'context')
				return {
					kind: 'context',
					context: {
						areas,
						scopes: [{ kind: 'institution', name: 'Northbridge University' }],
						moreScopes: false,
						noAccess: areas.length === 2,
						noAffiliation: false
					}
				};
			if (intent.kind === 'result')
				return {
					kind: 'result',
					attemptId: intent.attemptId,
					releasedAt: '2026-09-09T10:00:00Z',
					remarks:
						'**Released remarks**\n\n<script>window.leaked = true</script>\n\n![remote](https://example.test/private.png)'
				};
			if (fail)
				return new Promise((resolve) => {
					delayed = resolve;
				});
			return {
				kind: 'activity',
				serverTime: '2026-09-21T08:10:00Z',
				items: intent.cursor ? [sampleExams[2]!] : sampleExams.slice(0, 2),
				...(intent.cursor ? {} : { nextCursor: 'page2' })
			};
		}
	});
	const root = result.shell.element;
	const rows = () => [...root.querySelectorAll<HTMLButtonElement>('.prctr-exam-activity__row')];
	const detailsOpen = () =>
		root.querySelector<HTMLElement>('.prctr-exam-activity__details')?.hidden === false;
	const sidebarDocked = () => root.dataset.sidebarPresentation === 'docked';
	const button = (label: string) =>
		[...root.querySelectorAll<HTMLButtonElement>('button')].find(
			(button) => button.querySelector('.prctr-button__label')?.textContent === label
		)!;
	try {
		await eventually(() => rows().length === 2);
		check(
			root.querySelectorAll('.prctr-area-rail__area:not([hidden])').length === 3,
			'Mixed access must show three product areas'
		);
		check(!detailsOpen(), 'Details start closed');
		rows()[0]!.click();
		check(detailsOpen(), 'Selection opens the page detail panel');
		const frame = document.defaultView!.frameElement as HTMLIFrameElement;
		frame.style.width = '640px';
		await eventually(() => !sidebarDocked());
		check(
			result.shell.part('content').getBoundingClientRect().width >= 300,
			'Open details must not squeeze the main page at narrow width'
		);
		frame.style.width = '1100px';
		await eventually(() => sidebarDocked());

		check(button('Enter exam')?.disabled, 'Incomplete admission must remain disabled');
		check(
			root.textContent?.includes('Taking exams is not available'),
			'Admission limitation needs visible explanation'
		);
		result.navigation.selectActivityView?.('results_available');
		check(
			rows().length === 0 && root.textContent?.includes('No matching exams loaded yet'),
			'Partial results cannot imply there are no results'
		);
		check(!!button('Load more'), 'An empty filtered page retains pagination');
		result.navigation.selectActivityView?.('overview');
		button('Load more').click();
		await eventually(() => rows().length === 3);
		check(
			requests.some((r) => r.kind === 'activity' && r.cursor === 'page2'),
			'Pagination must use opaque cursor'
		);
		result.navigation.selectActivityView?.('upcoming');
		check(
			rows().length === 1 && rows()[0]!.textContent?.includes('Database systems'),
			'Upcoming filters the loaded collection'
		);
		check(
			root
				.querySelector('.prctr-area-sidebar__entry[data-entry="upcoming"]')
				?.getAttribute('aria-current') === 'page',
			'Sidebar selection follows the active category'
		);
		check(!detailsOpen(), 'Changing category closes the previous inspector');
		result.navigation.selectActivityView?.('submitted');
		check(
			rows().length === 0 && root.textContent?.includes('No exams in this section'),
			'Empty category has an explicit state'
		);
		result.navigation.selectActivityView?.('results_available');
		check(rows().length === 1, 'Results category includes the later loaded page');
		rows()[0]!.click();
		const close = root.querySelector<HTMLButtonElement>('[aria-label="Close exam details"]')!;
		close.click();
		check(
			!detailsOpen() && document.activeElement === rows()[0],
			'Inspector closes and restores focus'
		);
		rows()[0]!.click();
		button('View result').click();
		await eventually(() => !!root.querySelector('.prctr-exam-activity__result strong'));
		check(
			!root.querySelector(
				'.prctr-exam-activity__result img, .prctr-exam-activity__result script'
			),
			'Remarks cannot inject scripts or fetch remote images'
		);
		result.navigation.selectActivityView?.('overview');
		result.navigation.select('account');
		await eventually(() => !!root.querySelector('.prctr-account__header'));
		check(!detailsOpen(), 'Account navigation clears exam details');
		result.navigation.select('management');
		await eventually(() => !!root.textContent?.includes('Your management access'));
		check(
			root.textContent?.includes('not available in Proctor Desktop yet'),
			'Management must not pretend to exist'
		);
		result.navigation.select('activity');
		await eventually(() => rows().length === 2);
		fail = true;
		document.defaultView?.dispatchEvent(new Event('focus'));
		await eventually(() => !!delayed);
		check(rows().length === 0, 'Refresh removes stale actionable rows');
		result.navigation.select('account');
		delayed!({ kind: 'activity', serverTime: '2026-09-21T08:10:00Z', items: sampleExams });
		await eventually(() => !!root.querySelector('.prctr-account__header'));
		check(rows().length === 0, 'Late activity response cannot revive previous page');
		fail = false;
		result.navigation.select('activity');
		await eventually(() => rows().length === 2);
		fail = true;
		document.defaultView?.dispatchEvent(new Event('focus'));
		const priorDelayed = delayed;
		await eventually(() => delayed !== priorDelayed);
		delayed!({ kind: 'error', reason: 'restricted' });
		await eventually(() => !!root.textContent?.includes('You no longer have access'));
		result.navigation.selectActivityView?.('upcoming');
		check(
			root.textContent?.includes('You no longer have access'),
			'Changing category preserves the endpoint denial'
		);
		result.navigation.selectActivityView?.('overview');
		const priorReads = requests.length;
		await new Promise((resolve) => setTimeout(resolve, 30));
		check(
			requests.length === priorReads && rows().length === 0,
			'Endpoint denial must not start a context/refetch loop'
		);
		areas = ['account', 'settings'];
		document.defaultView!.dispatchEvent(new FocusEvent('focus'));
		await eventually(
			() => root.querySelectorAll('.prctr-area-rail__area:not([hidden])').length === 0
		);
		check(
			root.textContent?.includes('No exam or management access'),
			'No access must have a distinct explanation'
		);
	} finally {
		result.disposables.dispose();
	}
}

async function exerciseObservedExamActivity(document: Document): Promise<void> {
	const context: ExamActivityResponse = {
		kind: 'context',
		context: {
			areas: ['account', 'settings', 'student_activity'],
			scopes: [],
			moreScopes: false,
			noAccess: false,
			noAffiliation: false
		}
	};
	const listeners = new Map<string, (response: ExamActivityResponse) => void>();
	let first: ExamActivityResponse = {
		kind: 'activity',
		serverTime: '2026-09-21T08:10:00Z',
		items: sampleExams.slice(0, 2),
		nextCursor: 'page2'
	};
	const result = await mountExamActivityFixture(document, {
		async request(intent) {
			return intent.kind === 'context' ? context : first;
		},
		observe(intent, listener) {
			const key = intent.kind === 'activity' ? (intent.cursor ?? '') : intent.kind;
			listeners.set(key, listener);
			queueMicrotask(() => {
				if (listeners.get(key) !== listener) return;
				listener(
					intent.kind === 'context'
						? context
						: key === 'page2'
							? {
									kind: 'activity',
									serverTime: '2026-09-21T08:10:00Z',
									items: [sampleExams[2]!]
								}
							: first
				);
			});
			return {
				dispose: () => {
					if (listeners.get(key) === listener) listeners.delete(key);
				}
			};
		}
	});
	const root = result.shell.element;
	const rows = () => root.querySelectorAll('.prctr-exam-activity__row');
	try {
		await eventually(() => rows().length === 2);
		check(
			![...root.querySelectorAll('button')].some(
				(button) => !button.hidden && button.textContent === 'Refresh'
			),
			'Live pages do not require a Refresh action'
		);
		const more = [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
			button.textContent?.includes('Load more')
		)!;
		more.click();
		await eventually(() => rows().length === 3);
		first = { kind: 'activity', serverTime: '2026-09-21T08:11:00Z', items: [sampleExams[0]!] };
		listeners.get('')!(first);
		await eventually(() => rows().length === 1);
		check(!listeners.has('page2'), 'Changed pagination boundaries dispose stale later pages');
		result.navigation.select('account');
		await eventually(() => !!root.querySelector('.prctr-account__header'));
		check(!listeners.has(''), 'Hidden pages release their data observation');
		result.navigation.select('activity');
		await eventually(() => rows().length === 1);
		check(listeners.has(''), 'Returning to a page restores its observation');
	} finally {
		result.disposables.dispose();
	}
	check(listeners.size === 0, 'Workbench teardown releases every observation');
}

export async function runExamActivityTests(): Promise<void> {
	const frame = document.createElement('iframe');
	frame.style.width = '1100px';
	frame.style.height = '800px';
	document.body.append(frame);
	const child = frame.contentDocument!;
	for (const style of document.head.querySelectorAll('link[rel="stylesheet"], style'))
		child.head.append(style.cloneNode(true));
	try {
		await exerciseExamActivity(child);
		await exerciseObservedExamActivity(child);
	} finally {
		frame.remove();
	}
}
