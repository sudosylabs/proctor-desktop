/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import type {
	ClassifiedEvent,
	IGDPRProperty,
	OmitMetadata,
	StrictPropertyCheck
} from '../common/gdprTypings.js';

export const IProctorTelemetryService =
	createDecorator<IProctorTelemetryService>('proctorTelemetryService');

/**
 * Proctor's product events. An event exists only as a classified declaration: its owner, its
 * purpose (`comment`) and the classification of every field, as in VS Code's `publicLog2`; a
 * field without a classification does not compile. No destination is chosen yet, so events go
 * only to the log at Trace level and nothing leaves the device.
 */
export interface IProctorTelemetryService {
	readonly _serviceBrand: undefined;
	publicLog2<E extends ClassifiedEvent<OmitMetadata<T>> = never, T extends IGDPRProperty = never>(
		eventName: string,
		data?: StrictPropertyCheck<T, E>
	): void;
}

export class LogOnlyTelemetryService implements IProctorTelemetryService {
	declare readonly _serviceBrand: undefined;

	constructor(@ILogService private readonly log: ILogService) {}

	publicLog2<E extends ClassifiedEvent<OmitMetadata<T>> = never, T extends IGDPRProperty = never>(
		eventName: string,
		data?: StrictPropertyCheck<T, E>
	): void {
		// Field values are classified but not yet cleared to leave: the log keeps names and kinds.
		const fields =
			data === undefined || typeof data !== 'object'
				? ''
				: Object.entries(data as Record<string, unknown>)
						.map(([key, value]) =>
							typeof value === 'number' || typeof value === 'boolean'
								? `${key}=${String(value)}`
								: key
						)
						.join(' ');
		this.log.trace(`telemetry ${eventName} ${fields}`.trim());
	}
}
