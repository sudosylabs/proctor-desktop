import { RawContextKey } from '../../platform/contextkey/common/contextkey.js';

export type WorkbenchWindowKind = 'launch' | 'authenticated' | 'candidate';
export type WorkbenchLifecyclePhase = 'starting' | 'ready' | 'restored' | 'eventually';
export type WorkbenchPartId =
	'titlebar' | 'banner' | 'navigation' | 'sidebar' | 'content' | 'panel' | 'status' | 'overlay';

/**
 * Context keys are presentation and routing inputs only. They never establish
 * authentication, authorization, Attempt state, or Secure Exam Posture.
 */
export const WorkbenchWindowKindContext = new RawContextKey<WorkbenchWindowKind>(
	'prctr.workbench.windowKind',
	'launch'
);

export const WorkbenchLifecyclePhaseContext = new RawContextKey<WorkbenchLifecyclePhase>(
	'prctr.workbench.lifecyclePhase',
	'starting'
);

export const WorkbenchFocusedPartContext = new RawContextKey<WorkbenchPartId | ''>(
	'prctr.workbench.focusedPart',
	''
);

export const WorkbenchModalContext = new RawContextKey<boolean>('prctr.workbench.modal', false);

export const CandidateInteractionAllowedContext = new RawContextKey<boolean>(
	'prctr.candidate.interactionAllowed',
	false
);

export const WorkbenchHighContrastContext = new RawContextKey<boolean>(
	'prctr.accessibility.highContrast',
	false
);

export const WorkbenchReducedMotionContext = new RawContextKey<boolean>(
	'prctr.accessibility.reducedMotion',
	false
);

export const WorkbenchDirectionContext = new RawContextKey<'ltr' | 'rtl'>(
	'prctr.localization.direction',
	'ltr'
);
