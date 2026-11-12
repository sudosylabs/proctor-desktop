/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { serverRealtimeSchemas } from './serverRealtimeContract.generated.js';

const schemaBase = 'urn:proctor:realtime';

/**
 * Whether an event payload matches its schema in the packaged realtime contract; `null` means
 * the copy carries no data. Like a response, a payload tolerates additive fields, so a newer
 * server can add one without this build treating the event as unreadable.
 */
export function isValidServerEventPayload(schema: string | null, data: unknown): boolean {
	if (schema === null) return data === undefined || data === null;
	let validate = compiled.get(schema);
	if (!validate) {
		if (!Object.hasOwn(serverRealtimeSchemas, schema)) return false;
		validate = ajv().compile({ $ref: `${schemaBase}#/components/schemas/${schema}` });
		compiled.set(schema, validate);
	}
	return validate(data);
}

const compiled = new Map<string, ValidateFunction>();
let instance: Ajv2020 | undefined;
function ajv(): Ajv2020 {
	if (instance) return instance;
	instance = new Ajv2020({ strict: false, allErrors: false, validateFormats: true });
	addFormats.default(instance);
	instance.addSchema({
		$id: schemaBase,
		components: { schemas: openSchema(serverRealtimeSchemas) }
	});
	return instance;
}
function openSchema(schema: unknown): unknown {
	if (Array.isArray(schema)) return schema.map(openSchema);
	if (typeof schema !== 'object' || schema === null) return schema;
	return Object.fromEntries(
		Object.entries(schema)
			.filter(([key, value]) => !(key === 'additionalProperties' && value === false))
			.map(([key, value]) => [key, openSchema(value)])
	);
}
