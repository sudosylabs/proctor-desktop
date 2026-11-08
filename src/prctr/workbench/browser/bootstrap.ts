import {
	createLocalization,
	defineMessage,
	type MessageDescriptor
} from '../../base/common/localization.js';
import { DisposableStore, type IDisposable } from '../../base/common/lifecycle.js';
import type { SyncDescriptor0 } from '../../platform/instantiation/common/descriptors.js';
import type { IInstantiationService } from '../../platform/instantiation/common/instantiation.js';
import { InstantiationService } from '../../platform/instantiation/common/instantiationService.js';
import { ServiceCollection } from '../../platform/instantiation/common/serviceCollection.js';
import { INotificationService } from '../../platform/notification/common/notification.js';
import { PROCTOR_SCHEME_THEME_NAMES } from '../../platform/theme/common/bundledThemes.js';
import {
	BrowserThemeService,
	IBrowserThemeService
} from '../../platform/theme/browser/themeService.js';
import { ProductWindowChrome } from '../../platform/windows/browser/productWindowChrome.js';
import type { ProductWindowChromeClient } from '../../platform/windows/common/windowChrome.js';
import type { ProductWindowDescriptor } from '../../platform/windows/common/windowProtocol.js';
import type {
	WorkbenchComposition,
	WorkbenchContributionDescriptor
} from '../common/composition.js';
import {
	IWorkbenchLifecycleService,
	WorkbenchContributionActivator,
	WorkbenchLifecycleService,
	type WorkbenchContribution
} from '../common/lifecycle.js';
import {
	ILocalizationService,
	localizationService
} from '../services/localization/common/localization.js';
import { prepareWorkbenchDocument } from './documentLayout.js';
import { installWorkbenchNotifications } from './parts/notifications/notificationWindow.js';
import { createStartupSurface } from './startupSurface.js';
import {
	createWorkbenchKernelServices,
	WORKBENCH_RESET_LAYOUT_MESSAGE
} from './workbenchKernel.js';
import {
	IProductWindowChromeService,
	IWorkbenchShellService,
	IWorkbenchWindowService
} from './workbenchServices.js';
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
		defaultMessage: 'Panel',
		description: 'Accessible name for Candidate panel content.'
	}),
	status: defineMessage({
		id: 'workbench.part.status',
		defaultMessage: 'Connection and application status',
		description: 'Accessible name for workbench status.'
	}),
	resetLayout: WORKBENCH_RESET_LAYOUT_MESSAGE,
	resizeSidebar: defineMessage({
		id: 'workbench.layout.resize.sidebar',
		defaultMessage: 'Resize sidebar',
		description: 'Accessible name for the sidebar separator.'
	}),
	resizePanel: defineMessage({
		id: 'workbench.layout.resize.panel',
		defaultMessage: 'Resize panel',
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
/** One activated contribution. It owns what it creates and is disposed with the window. */
export interface IWorkbenchContribution extends IDisposable {
	/** Settles when asynchronous activation has finished; a rejection fails the contribution. */
	readonly whenActivated?: Promise<void>;
}

/**
 * A packaged contribution: its immutable composition descriptor, the text it shows, and
 * the class the window creates at its phase with the services its constructor declares.
 */
export interface WorkbenchContributionRegistration extends WorkbenchContributionDescriptor {
	readonly messages?: readonly MessageDescriptor[];
	/** Establishes the privileged window binding while only the loading surface is shown. */
	prepareBeforeShell?(composition: WorkbenchComposition): Promise<ProductWindowDescriptor>;
	/** The contribution's class; its constructor declares only services. */
	readonly descriptor: SyncDescriptor0<IWorkbenchContribution>;
}

/**
 * Adds a window composition root's services to the window's collection before any
 * contribution is created.
 */
export type WorkbenchServicesInitializer = (
	services: ServiceCollection,
	instantiationService: IInstantiationService,
	disposables: DisposableStore
) => void | Promise<void>;

export interface WorkbenchBootstrapOptions {
	/** The window's native chrome client, for windows that draw their own title bar. */
	readonly windowChrome?: ProductWindowChromeClient;
	readonly services?: readonly WorkbenchServicesInitializer[];
}

export interface WorkbenchBootstrapResult {
	readonly shell: WorkbenchShell;
	readonly lifecycle: WorkbenchLifecycleService;
	readonly instantiationService: IInstantiationService;
	readonly disposables: DisposableStore;
}

/** The contributions allowed to block the starting phase. */
const EARLY_BLOCKERS: ReadonlySet<string> = new Set([
	'prctr.workbench.kernel',
	'prctr.workbench.desktop',
	'prctr.candidate.examSecurity'
]);

export async function bootstrapWorkbench(
	document: Document,
	composition: WorkbenchComposition,
	registrations: readonly WorkbenchContributionRegistration[],
	options: WorkbenchBootstrapOptions = {}
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
				// AuthenticatedWindow follows the system with the Proctor palette until the user chooses a theme.
				composition.windowKind === 'authenticated'
					? { followSystemColorScheme: true, systemThemes: PROCTOR_SCHEME_THEME_NAMES }
					: { followSystemColorScheme: true }
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
		const binding = await prepareBinding(document, composition, registrations, localization);
		const labels = Object.fromEntries(
			Object.entries(messages)
				.filter(([id]) => id !== 'loading' && id !== 'recovery')
				.map(([id, message]) => [id, localization.format(message)])
		) as unknown as WorkbenchShellLabels;
		const shell = disposables.add(new WorkbenchShell(document.body, composition, labels));
		const lifecycle = disposables.add(new WorkbenchLifecycleService());
		const services = new ServiceCollection(
			[
				IWorkbenchWindowService,
				Object.freeze({ _serviceBrand: undefined, document, composition, binding })
			],
			[ILocalizationService, localizationService(localization)],
			[IBrowserThemeService, themeService],
			[IWorkbenchShellService, shell],
			[IWorkbenchLifecycleService, lifecycle]
		);
		const instantiationService = disposables.add(new InstantiationService(services, true));
		createWorkbenchKernelServices(services, instantiationService, disposables);
		const notifications = instantiationService.invokeFunction(
			installWorkbenchNotifications,
			binding,
			disposables
		);
		services.set(INotificationService, notifications.service);
		disposables.add(
			lifecycle.onDidAdvancePhase((phase) => {
				if (phase === 'restored') {
					notifications.start();
				}
			})
		);
		if (options.windowChrome !== undefined) {
			const chrome = await createWindowChrome(
				shell,
				options.windowChrome,
				themeService,
				disposables
			);
			services.set(IProductWindowChromeService, chrome);
		}
		for (const initialize of options.services ?? []) {
			await initialize(services, instantiationService, disposables);
		}
		await activateContributions(registrations, instantiationService, lifecycle, disposables);
		disposables.add(presentation);
		return { shell, lifecycle, instantiationService, disposables };
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

/**
 * Shows only the loading surface while the desktop contribution establishes the privileged
 * window binding; no other contribution may prepare before the shell exists.
 */
async function prepareBinding(
	document: Document,
	composition: WorkbenchComposition,
	registrations: readonly WorkbenchContributionRegistration[],
	localization: ReturnType<typeof createLocalization>
): Promise<ProductWindowDescriptor> {
	const desktop = registrations.find(
		(registration) => registration.id === 'prctr.workbench.desktop'
	);
	const others = registrations.filter(
		(registration) =>
			registration.id !== desktop?.id && registration.prepareBeforeShell !== undefined
	);
	if (desktop?.prepareBeforeShell === undefined || others.length > 0) {
		throw new Error(
			'The privileged desktop binding must be the only pre-shell workbench preparation'
		);
	}
	const loading = createStartupSurface(
		document,
		'workbenchLoading',
		localization.format(messages.loading)
	);
	loading.dataset.windowKind = composition.windowKind;
	document.body.replaceChildren(loading);
	const binding = await desktop.prepareBeforeShell(composition);
	loading.remove();
	return binding;
}

/** Creates the native chrome in the title bar; it dims while an overlay is shown. */
async function createWindowChrome(
	shell: WorkbenchShell,
	client: ProductWindowChromeClient,
	themeService: BrowserThemeService,
	disposables: DisposableStore
): Promise<IProductWindowChromeService> {
	const chrome = disposables.add(
		await ProductWindowChrome.create(shell.part('titlebar'), client, themeService)
	);
	disposables.add(
		shell.overlayHost.onDidChangeVisibility((visible) => {
			void chrome.setDimmed(visible).catch(() => undefined);
		})
	);
	await chrome.setDimmed(shell.overlayHost.visible);
	return Object.freeze({
		_serviceBrand: undefined,
		element: chrome.element,
		actions: chrome.actions,
		configuration: chrome.configuration
	});
}

/** Creates each contribution at its phase, in dependency order, through the window's services. */
async function activateContributions(
	registrations: readonly WorkbenchContributionRegistration[],
	instantiationService: IInstantiationService,
	lifecycle: WorkbenchLifecycleService,
	disposables: DisposableStore
): Promise<void> {
	const implementations: WorkbenchContribution[] = registrations.map((registration) => ({
		id: registration.id,
		phase: registration.phase,
		...(registration.dependencies === undefined
			? {}
			: { dependencies: registration.dependencies }),
		...(registration.blocksPhase === undefined
			? {}
			: { blocksPhase: registration.blocksPhase }),
		activate: async () => {
			const contribution = disposables.add(
				instantiationService.createInstance(registration.descriptor)
			);
			await contribution.whenActivated;
		}
	}));
	const activator = new WorkbenchContributionActivator(implementations, EARLY_BLOCKERS);
	for (const phase of ['starting', 'ready', 'restored'] as const) {
		lifecycle.advance(phase);
		const results = await activator.activateThrough(phase);
		const failedBlocker = results.find(
			(result) =>
				result.state === 'failed' &&
				implementations.find((value) => value.id === result.id)?.blocksPhase
		);
		if (failedBlocker !== undefined) {
			throw failedBlocker.error;
		}
	}
	globalThis.setTimeout(() => {
		if (!disposables.isDisposed) {
			lifecycle.advance('eventually');
			void activator.activateThrough('eventually');
		}
	}, 0);
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
