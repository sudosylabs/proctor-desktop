import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const [source, revision] = process.argv.slice(2);
if (!source || process.argv.length > 4)
	throw new Error(
		'Usage: npm run api:sync -- <server/openapi.json, with asyncapi.json beside it> [server-revision]'
	);
const text = readFileSync(resolve(source), 'utf8');
const schema = JSON.parse(text) as { openapi?: string; paths?: Record<string, unknown> };
if (schema.openapi !== '3.1.0' || !schema.paths)
	throw new Error('Expected the Proctor OpenAPI 3.1 contract');
// The realtime contract is built beside the HTTP one, so both come from one server revision.
const realtime = readFileSync(join(dirname(resolve(source)), 'asyncapi.json'), 'utf8');
if ((JSON.parse(realtime) as { asyncapi?: string }).asyncapi !== '3.0.0')
	throw new Error('Expected the Proctor AsyncAPI 3.0 contract beside the OpenAPI contract');
writeFileSync('resources/server-api/openapi.json', text);
writeFileSync('resources/server-api/asyncapi.json', realtime);
writeFileSync(
	'resources/server-api/source.json',
	JSON.stringify(
		{
			schemaVersion: 1,
			project: 'Proctor Server',
			revision: revision ?? null,
			sha256: createHash('sha256').update(text).digest('hex'),
			asyncapiSha256: createHash('sha256').update(realtime).digest('hex')
		},
		null,
		2
	) + '\n'
);
execFileSync(process.execPath, ['build/generators/main.ts', '--write'], { stdio: 'inherit' });
