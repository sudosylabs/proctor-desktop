/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	createLocalization,
	defineMessage,
	type LocalizationContext,
	type MessageDescriptor
} from '../../base/common/localization.js';
import { DisposableStore } from '../../base/common/lifecycle.js';
import {
	BROWSER_THEME_SERVICE,
	BrowserThemeService
} from '../../platform/theme/browser/themeService.js';
import type { WorkbenchComposition } from '../common/composition.js';
import {
	WORKBENCH_LIFECYCLE_SERVICE,
	WorkbenchContributionActivator,
	WorkbenchLifecycleService,
	type WorkbenchContribution
} from '../common/lifecycle.js';
import { prepareWorkbenchDocument } from './documentLayout.js';
import { createStartupSurface } from './startupSurface.js';
import { WorkbenchShell, type WorkbenchShellLabels } from './workbenchShell.js';

const messages = Object.freeze({
	titlebar: defineMessage({
		id: 'workbench.part.titlebar',
		defaultMessage: 'Window controls',
		description: 'Accessible name for the trusted titlebar.'
	}),
	banner: defineMessage({
		id: 'workbench.part.banner',
		defaultMessage: 'Important notices',
		description: 'Accessible name for the persistent notice region.'
	}),
	navigation: defineMessage({
		id: 'workbench.part.navigation',
		defaultMessage: 'Product navigation',
		description: 'Accessible name for product navigation.'
	}),
	sidebar: defineMessage({
		id: 'workbench.part.sidebar',
		defaultMessage: 'Current destination',
		description: 'Accessible name for contextual navigation.'
	}),
	content: defineMessage({
		id: 'workbench.part.content',
		defaultMessage: 'Main content',
		description: 'Accessible name for workbench content.'
	}),
	panel: defineMessage({
		id: 'workbench.part.panel',
		defaultMessage: 'Terminal panel',
		description: 'Accessible name for Candidate panel content.'
	}),
	status: defineMessage({
		id: 'workbench.part.status',
		defaultMessage: 'Connection and application status',
		description: 'Accessible name for workbench status.'
	}),
	resetLayout: defineMessage({
		id: 'workbench.layout.reset',
		defaultMessage: 'Reset layout',
		description: 'Button that restores composition default region sizes.'
	}),
	resizeSidebar: defineMessage({
		id: 'workbench.layout.resize.sidebar',
		defaultMessage: 'Resize sidebar',
		description: 'Accessible name for the sidebar separator.'
	}),
	resizePanel: defineMessage({
		id: 'workbench.layout.resize.panel',
		defaultMessage: 'Resize terminal panel',
		description: 'Accessible name for the Candidate panel separator.'
	}),
	loading: defineMessage({
		id: 'workbench.startup.loading',
		defaultMessage: 'Starting Proctor securely…',
		description:
			'Minimal status shown while the privileged window binding is being established.'
	}),
	recovery: defineMessage({
		id: 'workbench.startup.recovery',
		defaultMessage: 'Proctor could not start this window safely.',
		description: 'Minimal startup recovery message.'
	})
});
export const WORKBENCH_RESET_LAYOUT_MESSAGE = messages.resetLayout;

export interface WorkbenchBootstrapResult {
	readonly shell: WorkbenchShell;
	readonly lifecycle: WorkbenchLifecycleService;
	readonly disposables: DisposableStore;
}
export interface WorkbenchBootstrapContext {
	readonly document: Document;
	readonly composition: WorkbenchComposition;
	readonly shell: WorkbenchShell;
	readonly localization: LocalizationContext;
	readonly disposables: DisposableStore;
	setService(id: string, value: unknown): void;
	getService<T>(id: string): T;
	setWindowBinding(value: unknown): void;
	getWindowBinding(): unknown;
}
export interface WorkbenchContributionRegistration extends Omit<WorkbenchContribution, 'activate'> {
	readonly messages?: readonly MessageDescriptor[];
	prepareBeforeShell?(composition: WorkbenchComposition): void | Promise<void>;
	activate(context: WorkbenchBootstrapContext): void | Promise<void>;
}

export async function bootstrapWorkbench(
	document: Document,
	composition: WorkbenchComposition,
	registrations: readonly WorkbenchContributionRegistration[]
): Promise<WorkbenchBootstrapResult> {
	const disposables = new DisposableStore();
	const presentation = new DisposableStore();
	let themeService: BrowserThemeService | undefined;
	const ensureTheme = (): BrowserThemeService =>
		(themeService ??= presentation.add(
			new BrowserThemeService(
				document,
				'dark',
				{ density: 'default', motion: 'full', transparency: 'full' },
				{ followSystemColorScheme: true }
			)
		));
	try {
		prepareWorkbenchDocument(document);
		assertRegistrations(composition, registrations);
		const localization = createLocalization({
			requestedLocale: document.documentElement.lang || 'en',
			messages: [
				...Object.values(messages),
				...registrations.flatMap((registration) => registration.messages ?? [])
			],
			catalogs: []
		});
		document.documentElement.lang = localization.locale;
		document.documentElement.dir = localization.direction;
		themeService = ensureTheme();
		const desktop = registrations.find(
			(registration) => registration.id === 'prctr.workbench.desktop'
		);
		if (
			desktop?.prepareBeforeShell === undefined ||
			registrations.some(
				(registration) =>
					registration.id !== desktop.id && registration.prepareBeforeShell !== undefined
			)
		)
			throw new Error(
				'The privileged desktop binding must be the only pre-shell workbench preparation'
			);
		const loading = createStartupSurface(
			document,
			'workbenchLoading',
			localization.format(messages.loading)
		);
		loading.dataset.windowKind = composition.windowKind;
		document.body.replaceChildren(loading);
		await desktop.prepareBeforeShell(composition);
		loading.remove();
		const services = new Map<string, unknown>();
		services.set(BROWSER_THEME_SERVICE, themeService);
		const labels = Object.fromEntries(
			Object.entries(messages)
				.filter(([id]) => id !== 'loading' && id !== 'recovery')
				.map(([id, message]) => [id, localization.format(message)])
		) as unknown as WorkbenchShellLabels;
		const shell = disposables.add(new WorkbenchShell(document.body, composition, labels));
		const lifecycle = disposables.add(new WorkbenchLifecycleService());
		services.set(WORKBENCH_LIFECYCLE_SERVICE, lifecycle);
		let windowBinding: unknown;
		const context: WorkbenchBootstrapContext = Object.freeze({
			document,
			composition,
			shell,
			localization,
			disposables,
			setService: (id: string, value: unknown) => {
				if (services.has(id))
					throw new Error(`Workbench service ${id} was initialized more than once`);
				services.set(id, value);
			},
			getService: <T>(id: string): T => {
				if (!services.has(id)) throw new Error(`Workbench service ${id} is unavailable`);
				return services.get(id) as T;
			},
			setWindowBinding: (value: unknown) => {
				if (windowBinding !== undefined)
					throw new Error('Workbench window binding was initialized more than once');
				windowBinding = value;
			},
			getWindowBinding: () => windowBinding
		});
		const implementations: WorkbenchContribution[] = registrations.map((registration) => ({
			id: registration.id,
			phase: registration.phase,
			...(registration.dependencies === undefined
				? {}
				: { dependencies: registration.dependencies }),
			...(registration.blocksPhase === undefined
				? {}
				: { blocksPhase: registration.blocksPhase }),
			activate: () => registration.activate(context)
		}));
		const activator = new WorkbenchContributionActivator(
			implementations,
			new Set([
				'prctr.workbench.kernel',
				'prctr.workbench.desktop',
				'prctr.candidate.examSecurity'
			])
		);
		for (const phase of ['starting', 'ready', 'restored'] as const) {
			lifecycle.advance(phase);
			const results = await activator.activateThrough(phase);
			const failedBlocker = results.find(
				(result) =>
					result.state === 'failed' &&
					implementations.find((value) => value.id === result.id)?.blocksPhase
			);
			if (failedBlocker !== undefined) throw failedBlocker.error;
		}
		globalThis.setTimeout(() => {
			if (!disposables.isDisposed) {
				lifecycle.advance('eventually');
				void activator.activateThrough('eventually');
			}
		}, 0);
		disposables.add(presentation);
		return { shell, lifecycle, disposables };
	} catch (error) {
		disposables.dispose();
		ensureTheme();
		document.body.replaceChildren();
		const localization = createLocalization({
			requestedLocale: document.documentElement.lang || 'en',
			messages: Object.values(messages),
			catalogs: []
		});
		const recovery = createStartupSurface(
			document,
			'workbenchRecovery',
			localization.format(messages.recovery)
		);
		recovery.dataset.windowKind = composition.windowKind;
		document.body.append(recovery);
		throw error;
	}
}

function assertRegistrations(
	composition: WorkbenchComposition,
	registrations: readonly WorkbenchContributionRegistration[]
): void {
	if (registrations.length !== composition.contributions.length)
		throw new Error(
			`Composition ${composition.id} has ${composition.contributions.length} descriptors but ${registrations.length} executable registrations`
		);
	const byId = new Map(registrations.map((registration) => [registration.id, registration]));
	if (byId.size !== registrations.length)
		throw new Error(
			`Composition ${composition.id} contains duplicate executable registrations`
		);
	for (const descriptor of composition.contributions) {
		const registration = byId.get(descriptor.id);
		if (registration === undefined)
			throw new Error(
				`Composition ${composition.id} has no executable registration for ${descriptor.id}`
			);
		if (
			registration.phase !== descriptor.phase ||
			registration.blocksPhase !== descriptor.blocksPhase ||
			!sameIds(registration.dependencies, descriptor.dependencies)
		)
			throw new Error(
				`Executable registration ${descriptor.id} does not match its immutable composition descriptor`
			);
	}
}
function sameIds(
	left: readonly string[] | undefined,
	right: readonly string[] | undefined
): boolean {
	const a = left ?? [];
	const b = right ?? [];
	return a.length === b.length && a.every((value, index) => value === b[index]);
}
