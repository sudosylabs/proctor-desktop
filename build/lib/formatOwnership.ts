import type { Repository } from '../checks/types.ts';

export function transferredFiles(repository: Repository): Set<string> {
	const paths = new Set<string>();
	for (const path of repository
		.files()
		.filter(
			(path) =>
				/^docs\/upstream\/vscode-ports\/[^/]+\.json$/.test(path) &&
				!path.endsWith('/schema.json')
		)) {
		const manifest = JSON.parse(repository.read(path)) as { items: { localPath?: string }[] };
		for (const item of manifest.items) if (item.localPath) paths.add(item.localPath);
	}
	return paths;
}

export function formattingIgnore(
	repository: Repository,
	generatedPaths: readonly string[]
): string {
	// Exact source ownership, not a blanket src/ or test/ exemption.
	const paths = [...new Set([...transferredFiles(repository), ...generatedPaths])].sort();
	return [
		`# ${'@generated'} by tooling.format-ownership; run npm run generate`,
		'node_modules/',
		'.build/',
		'out/',
		'native/target/',
		'coverage/',
		'artifacts/',
		'.generated-check/',
		'.scratch/',
		'.agents/',
		'.github/skills/',
		'.claude/skills/',
		'.github/copilot-instructions.md',
		'package-lock.json',
		'native/Cargo.lock',
		// Preserve the imported contract byte-for-byte against its source digest.
		'resources/server-api/openapi.json',
		'resources/server-api/asyncapi.json',
		// Written byte-for-byte by prctr-xtask; the protocol digest hashes these bytes.
		'/native/crates/prctr-protocol/schema/',
		'/native/crates/prctr-core/conformance/',
		'/native/crates/prctr-capabilities/registry/',
		...paths.map((path) => `/${path}`),
		''
	].join('\n');
}
