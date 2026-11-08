/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	LocalizationContext,
	LocalizationValue,
	MessageDescriptor
} from '../../../../base/common/localization.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const ILocalizationService = createDecorator<ILocalizationService>('localizationService');

/** The window's resolved locale, direction and message formatting. */
export interface ILocalizationService extends LocalizationContext {
	readonly _serviceBrand: undefined;
}

/** Presents a resolved localization as the window's service. */
export function localizationService(localization: LocalizationContext): ILocalizationService {
	return Object.freeze({
		_serviceBrand: undefined,
		locale: localization.locale,
		direction: localization.direction,
		format: (
			descriptor: MessageDescriptor,
			values?: Readonly<Record<string, LocalizationValue>>
		) => localization.format(descriptor, values)
	});
}
