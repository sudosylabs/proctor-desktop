import { addDisposableListener } from '../../../../base/browser/dom.js';
import { Event } from '../../../../base/common/event.js';
import type { ExamActivityClient } from '../../../../platform/examActivity/common/examActivityProtocol.js';
import type { WorkbenchBootstrapContext } from '../../../browser/bootstrap.js';
import type { WorkbenchPaneHost } from '../../../browser/paneHost.js';
import type { WorkbenchItemResolverRegistry } from '../../../browser/workbenchPane.js';
import type { WorkbenchItem } from '../../../common/workbenchItem.js';
import { WORKBENCH_ITEM_RESOLVERS, WORKBENCH_PANE_HOST } from '../../../workbench.common.main.js';
import {
	AUTHENTICATED_NAVIGATION_SERVICE,
	type AuthenticatedNavigationService
} from '../../authenticated/browser/authenticatedNavigation.js';
import { ProductAccess } from './productAccess.js';
import { ExamActivityPane } from './examActivityPane.js';
import { examActivityMessages as m } from './examActivityMessages.js';

/** Statically admitted product pages; context only selects from this finite destination set. */
export function activateExamActivity(
	context: WorkbenchBootstrapContext,
	client: ExamActivityClient
): void {
	const access = context.disposables.add(new ProductAccess(client));
	const navigation = context.getService<AuthenticatedNavigationService>(
		AUTHENTICATED_NAVIGATION_SERVICE
	);
	const host = context.getService<WorkbenchPaneHost>(WORKBENCH_PANE_HOST);
	const registry = context.getService<WorkbenchItemResolverRegistry>(WORKBENCH_ITEM_RESOLVERS);
	const typeId = 'prctr.authenticated.exams';
	const items = new Map<string, WorkbenchItem>();
	for (const destination of ['activity', 'management', 'administration'] as const) {
		const title = context.localization.format(m[destination]);
		items.set(destination, {
			typeId,
			logicalIdentity: destination,
			presentation: { title, accessibleLabel: title },
			closable: false,
			restorable: false,
			onDidChangePresentation: Event.None,
			matches(other) {
				return other.typeId === typeId && other.logicalIdentity === destination;
			}
		});
	}
	context.disposables.add(
		registry.register({
			typeId,
			async resolve(item) {
				if (items.get(item.logicalIdentity) !== item)
					throw new Error('Unknown product page');
				return { item, dispose() {} };
			},
			createPane() {
				return new ExamActivityPane(context, access);
			}
		})
	);
	let disposed = false;
	let sequence = 0;
	const select = (destination: string, focus = false): void => {
		const serial = ++sequence,
			item = items.get(destination);
		if (!item) return; // The destination's owning contribution assigns the shared pane host.
		host.element.hidden = false;
		void host
			.assign(item)
			.then((assigned) => {
				if (assigned && !disposed && serial === sequence && focus) host.focus();
			})
			.catch(() => {
				if (!disposed && serial === sequence)
					navigation.setProductStatus?.(context.localization.format(m.unavailable), () =>
						select(destination, true)
					);
			});
	};
	context.disposables.add(navigation.onDidChange((destination) => select(destination, true)));
	context.disposables.add(
		access.onDidChange(() => {
			if (access.state?.kind === 'context') {
				const c = access.state.context;
				navigation.setProductAreas?.(c.areas);
				navigation.setProductStatus?.(
					c.noAffiliation
						? context.localization.format(m.noAffiliation)
						: c.noAccess
							? context.localization.format(m.noAccess)
							: '',
					c.noAffiliation || c.noAccess ? () => void access.refresh() : undefined
				);
			} else if (access.state?.kind === 'error') {
				if (access.state.reason === 'restricted' || access.state.reason === 'sessionEnded')
					navigation.setProductAreas?.([]);
				navigation.setProductStatus?.(
					context.localization.format(m[access.state.reason]),
					() => void access.refresh()
				);
			}
		})
	);
	const window = context.document.defaultView;
	if (window && !access.client.observe)
		context.disposables.add(
			addDisposableListener(window, 'focus', (event) => {
				if (event.target === window) void access.refresh();
			})
		);
	context.disposables.add({
		dispose() {
			disposed = true;
			sequence++;
		}
	});
	select(navigation.current);
	void access.refresh();
}
