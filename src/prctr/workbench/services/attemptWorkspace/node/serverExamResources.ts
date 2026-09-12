import type { ServerApiClient } from '../../../../platform/serverApi/node/serverApiClient.js';
import { ServerApiError } from '../../../../platform/serverApi/common/serverApi.js';
import type { components } from '../../../../platform/serverApi/common/serverApi.generated.js';
import type { ExamResourceEntry } from '../common/attemptWorkspace.js';
import type { ExamResourcePort } from '../common/internalPorts.js';
import { digest, headers, type WorkspaceServerBinding } from './serverWorkspaceAuthority.js';

type Presentation = components['schemas']['CandidateExamPresentationResponse'];
/** Immutable revision catalog. A correction replaces this object and disposes the old catalog. */
export class ServerExamResources implements ExamResourcePort {
	readonly #entries: readonly ExamResourceEntry[];
	readonly #lifetime = new AbortController();
	constructor(
		private readonly api: Pick<ServerApiClient, 'request'>,
		private readonly current: () => WorkspaceServerBinding,
		private readonly presentation: Presentation,
		private readonly revisionIsCurrent: () => boolean
	) {
		if (current().attemptId !== presentation.attempt_id)
			throw new ServerApiError('invalidResponse');
		this.#entries = Object.freeze(
			presentation.resources.map((resource) =>
				Object.freeze({
					reference: resource.id,
					path: resource.id,
					version: resource.sha256,
					mediaType: resource.media_type,
					byteSize: resource.size,
					title: resource.display_name,
					order: resource.position
				})
			)
		);
	}
	async list(): Promise<readonly ExamResourceEntry[]> {
		this.#scope();
		return this.#entries;
	}
	async read(reference: string): Promise<ExamResourceEntry & { readonly content: Uint8Array }> {
		const scope = this.#scope();
		const entry = this.#entries.find((value) => value.reference === reference);
		if (!entry) throw new ServerApiError('invalidRequest');
		const response = await this.api.request(
			'getCandidateExamResourceContent',
			{
				path: { exam_attempt_id: scope.attemptId, exam_resource_id: reference },
				header: headers(scope)
			},
			{
				signal: this.#lifetime.signal,
				maxResponseBytes: Math.max(1, Math.min(100 * 1024 * 1024, entry.byteSize))
			}
		);
		const current = this.#scope();
		if (
			current.epoch !== scope.epoch ||
			current.connectionId !== scope.connectionId ||
			current.generation !== scope.generation ||
			current.participationId !== scope.participationId
		)
			throw new ServerApiError('sessionEnded');
		if (
			response.status !== 200 ||
			!(response.value instanceof Uint8Array) ||
			response.value.byteLength !== entry.byteSize ||
			response.headers.etag !== `"${entry.version}"` ||
			digest(response.value) !== entry.version
		)
			throw new ServerApiError('invalidResponse');
		return { ...entry, content: response.value };
	}
	dispose(): void {
		this.#lifetime.abort();
	}
	#scope(): WorkspaceServerBinding {
		const scope = this.current();
		if (
			this.#lifetime.signal.aborted ||
			!scope.access.read ||
			scope.attemptId !== this.presentation.attempt_id ||
			!this.revisionIsCurrent()
		)
			throw new ServerApiError('sessionEnded');
		return { ...scope, access: { ...scope.access } };
	}
}
