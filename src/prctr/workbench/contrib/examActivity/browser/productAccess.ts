import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import {
	validateExamActivityResponse,
	type ExamActivityClient,
	type ExamActivityResponse
} from '../../../../platform/examActivity/common/examActivityProtocol.js';

/** Bounded context projection subscribed to the privileged API cache. Never grants access. */
export class ProductAccess extends Disposable {
	private readonly changes = this._register(new Emitter<void>());
	readonly onDidChange = this.changes.event;
	state: ExamActivityResponse | undefined;
	private pending: Promise<void> | undefined;
	private ended = false;
	constructor(readonly client: ExamActivityClient) {
		super();
		if (client.observe)
			this._register(client.observe({ kind: 'context' }, (result) => this.accept(result)));
	}
	refresh(): Promise<void> {
		if (this.ended) return Promise.resolve();
		if (this.pending) return this.pending;
		if (!this.client.observe) {
			this.state = undefined;
			this.changes.fire();
		}
		this.pending = this.read().finally(() => {
			this.pending = undefined;
		});
		return this.pending;
	}
	private async read(): Promise<void> {
		let result: ExamActivityResponse;
		try {
			result = validateExamActivityResponse(await this.client.request({ kind: 'context' }));
		} catch {
			result = { kind: 'error', reason: 'unavailable' };
		}
		this.accept(result);
	}
	private accept(result: ExamActivityResponse): void {
		if (this.ended) return;
		const state: ExamActivityResponse =
			result.kind === 'context' || result.kind === 'error'
				? result
				: { kind: 'error', reason: 'unavailable' };
		if (JSON.stringify(state) === JSON.stringify(this.state)) return;
		this.state = state;
		this.changes.fire();
	}

	override dispose(): void {
		this.ended = true;
		this.state = undefined;
		super.dispose();
	}
}
