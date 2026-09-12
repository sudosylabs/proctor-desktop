import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { OpenAPI3 } from 'openapi-typescript';
import { refineSecurityPolicyTypes } from '../../build/generators/serverApi.ts';

void test('security tuple type refinement preserves the raw contract and includes every family constraint', () => {
	const source = readFileSync('resources/server-api/openapi.json', 'utf8');
	const document = JSON.parse(source) as OpenAPI3;
	const before = JSON.stringify(document);
	const refined = refineSecurityPolicyTypes(document);
	assert.equal(JSON.stringify(document), before);
	const schemas = refined.components?.schemas;
	assert.ok(schemas);
	const policy = schemas.EffectiveExamSecurityPolicy;
	assert.ok(policy && 'properties' in policy);
	const capabilities = policy.properties?.capabilities;
	assert.ok(
		capabilities && 'prefixItems' in capabilities && Array.isArray(capabilities.prefixItems)
	);
	assert.equal(capabilities.prefixItems.length, 10);
	for (const family of capabilities.prefixItems) {
		assert.ok(family && typeof family === 'object' && 'properties' in family);
		assert.ok(Object.keys(family.properties ?? {}).length > 1);
	}
});
