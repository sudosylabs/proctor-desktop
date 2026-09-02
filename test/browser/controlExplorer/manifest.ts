import { controlsFixture } from './sharedControlsFixture.ts';

export interface ControlFixtureResult {
	readonly states: number;
	readonly disposable: { dispose(): void };
	verify(): number | Promise<number>;
}
export interface ControlFixture {
	readonly id: string;
	readonly title: string;
	mount(host: HTMLElement): ControlFixtureResult;
}

/** Development-only literal manifest. Production compositions cannot reach this test root. */
export const controlExplorerFixtures: readonly ControlFixture[] = Object.freeze([
	Object.freeze({ id: 'shared-controls', title: 'Shared controls', mount: controlsFixture })
]);
