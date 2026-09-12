import { createHash } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { Check, Diagnostic } from './types.ts';
import { diagnostic } from './types.ts';

type PortItem = {
	readonly disposition: string;
	readonly localPath?: string;
	readonly localSha256?: string;
	readonly licenseRefs: readonly string[];
};
type PortManifest = {
	readonly clusterId: string;
	readonly admission: {
		readonly callers: readonly string[];
		readonly interface: string;
		readonly decision: string;
	};
	readonly items: readonly (PortItem & { readonly localInterface?: string })[];
	readonly licenses: readonly { readonly id: string }[];
	readonly divergences: readonly {
		readonly localPaths: readonly string[];
		readonly verificationRefs: readonly string[];
	}[];
	readonly verification: readonly { readonly id: string; readonly path: string }[];
};

export const provenanceCheck: Check = {
	id: 'upstream.provenance',
	category: 'upstream',
	contractRequired: true,
	run: ({ repository }) => {
		const checkId = 'upstream.provenance';
		const diagnostics: Diagnostic[] = [];
		const schemaPath = 'docs/upstream/vscode-ports/schema.json';
		const manifests = repository
			.files()
			.filter(
				(path) =>
					path.startsWith('docs/upstream/vscode-ports/') &&
					path.endsWith('.json') &&
					path !== schemaPath
			);
		let validate;
		try {
			validate = new Ajv2020({ allErrors: true, strict: false }).compile(
				JSON.parse(repository.read(schemaPath)) as object
			);
		} catch (error) {
			return [
				diagnostic(
					checkId,
					schemaPath,
					String(error),
					'Fix the canonical provenance schema.'
				)
			];
		}
		const localOwners = new Map<string, string>();
		const clusters = new Set<string>();
		const marked = new Map<string, string>();
		for (const path of repository
			.files()
			.filter(
				(candidate) =>
					(candidate.startsWith('src/prctr/') ||
						candidate.startsWith('resources/') ||
						/^test\/.+\/upstream\//.test(candidate)) &&
					/\.(?:ts|js|css)$/.test(candidate)
			)) {
			const matches = [
				...repository
					.read(path)
					.matchAll(/@proctor-vscode-port\s+([a-z0-9]+(?:-[a-z0-9]+)*)/g)
			];
			if (matches.length > 1)
				diagnostics.push(
					diagnostic(
						checkId,
						path,
						'File has multiple VS Code port markers.',
						'Keep exactly one canonical cluster marker.'
					)
				);
			if (matches[0]?.[1] !== undefined) marked.set(path, matches[0][1]);
		}
		for (const path of manifests) {
			let manifest: PortManifest;
			try {
				manifest = JSON.parse(repository.read(path)) as PortManifest;
			} catch (error) {
				diagnostics.push(
					diagnostic(checkId, path, String(error), 'Fix the port manifest JSON.')
				);
				continue;
			}
			if (!validate(manifest))
				for (const error of validate.errors ?? [])
					diagnostics.push(
						diagnostic(
							checkId,
							path,
							`${error.instancePath || '/'} ${error.message ?? 'is invalid'}`,
							'Conform the manifest to schema.json.'
						)
					);
			if (clusters.has(manifest.clusterId))
				diagnostics.push(
					diagnostic(
						checkId,
						path,
						`Cluster id ${manifest.clusterId} is duplicated.`,
						'Keep one manifest per admitted cluster.'
					)
				);
			clusters.add(manifest.clusterId);
			const licenseIds = new Set(manifest.licenses.map((license) => license.id));
			const verificationIds = new Set(manifest.verification.map((entry) => entry.id));
			for (const evidencePath of [
				...manifest.admission.callers,
				manifest.admission.interface,
				manifest.admission.decision,
				...manifest.verification.map((entry) => entry.path)
			])
				if (!repository.exists(evidencePath))
					diagnostics.push(
						diagnostic(
							checkId,
							evidencePath,
							`Manifest ${manifest.clusterId} references missing local evidence.`,
							'Restore the evidence or update the reviewed manifest.'
						)
					);
			for (const item of manifest.items) {
				for (const reference of item.licenseRefs)
					if (!licenseIds.has(reference))
						diagnostics.push(
							diagnostic(
								checkId,
								path,
								`Item references unknown license ${reference}.`,
								'Declare the license or correct the reference.'
							)
						);
				if (
					!['copied', 'adapted'].includes(item.disposition) ||
					item.localPath === undefined
				)
					continue;
				const owner = localOwners.get(item.localPath);
				if (owner !== undefined)
					diagnostics.push(
						diagnostic(
							checkId,
							item.localPath,
							`Transferred file is owned by both ${owner} and ${manifest.clusterId}.`,
							'Keep exactly one provenance owner.'
						)
					);
				localOwners.set(item.localPath, manifest.clusterId);
				if (!repository.exists(item.localPath))
					diagnostics.push(
						diagnostic(
							checkId,
							item.localPath,
							'Transferred local file does not exist.',
							'Restore the admitted file or update its reviewed disposition.'
						)
					);
				else {
					const actual = createHash('sha256')
						.update(repository.readBytes(item.localPath))
						.digest('hex');
					if (actual !== item.localSha256)
						diagnostics.push(
							diagnostic(
								checkId,
								item.localPath,
								'Local digest differs from the manifest.',
								'Review the change and update provenance only if the adaptation remains admitted.'
							)
						);
					if (
						/\.(?:ts|js|css)$/.test(item.localPath) &&
						marked.get(item.localPath) !== manifest.clusterId
					)
						diagnostics.push(
							diagnostic(
								checkId,
								item.localPath,
								`Transferred file lacks @proctor-vscode-port ${manifest.clusterId}.`,
								'Add the marker after the applicable license header.'
							)
						);
				}
			}
			for (const item of manifest.items)
				if (item.localInterface !== undefined && !repository.exists(item.localInterface))
					diagnostics.push(
						diagnostic(
							checkId,
							item.localInterface,
							`Manifest ${manifest.clusterId} references missing local interface.`,
							'Restore the interface or update the reviewed disposition.'
						)
					);
			for (const divergence of manifest.divergences) {
				for (const localPath of divergence.localPaths)
					if (!repository.exists(localPath))
						diagnostics.push(
							diagnostic(
								checkId,
								localPath,
								`Manifest ${manifest.clusterId} divergence references missing local source.`,
								'Restore the source or update the divergence.'
							)
						);
				for (const reference of divergence.verificationRefs)
					if (!verificationIds.has(reference))
						diagnostics.push(
							diagnostic(
								checkId,
								path,
								`Divergence references unknown verification ${reference}.`,
								'Declare the verification or correct the reference.'
							)
						);
			}
		}
		for (const [path, cluster] of marked)
			if (localOwners.get(path) !== cluster)
				diagnostics.push(
					diagnostic(
						checkId,
						path,
						`Marker names unowned cluster ${cluster}.`,
						'Add the canonical manifest item or remove the orphan marker.'
					)
				);
		return diagnostics;
	}
};
