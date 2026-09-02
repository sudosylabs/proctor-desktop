type Hook = () => unknown;
type TestBody = () => unknown;
interface TestCase {
	readonly name: string;
	readonly body: TestBody;
	readonly before: readonly Hook[];
	readonly after: readonly Hook[];
}
interface SuiteNode {
	readonly name: string;
	readonly parent?: SuiteNode;
	readonly before: Hook[];
	readonly after: Hook[];
}
const root: SuiteNode = { name: '', before: [], after: [] };
let current = root;
const cases: TestCase[] = [];
export function suite(name: string, register: () => void): void {
	const parent = current;
	current = { name, parent, before: [], after: [] };
	try {
		register();
	} finally {
		current = parent;
	}
}
export function setup(hook: Hook): void {
	current.before.push(hook);
}
export function teardown(hook: Hook): void {
	current.after.push(hook);
}
export function test(name: string, body: TestBody): void {
	const chain: SuiteNode[] = [];
	for (let node: SuiteNode | undefined = current; node?.parent !== undefined; node = node.parent)
		chain.unshift(node);
	cases.push({
		name: `${chain.map((node) => node.name).join(' / ')} / ${name}`,
		body,
		before: chain.flatMap((node) => node.before),
		after: chain.flatMap((node) => node.after).reverse()
	});
}
export async function runRegisteredBrowserTests(): Promise<{
	readonly passed: number;
	readonly failures: readonly string[];
}> {
	const failures: string[] = [];
	let passed = 0;
	for (const entry of cases) {
		try {
			for (const hook of entry.before) await hook();
			await entry.body();
			passed++;
		} catch (error) {
			failures.push(
				`${entry.name}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
			);
		} finally {
			for (const hook of entry.after) {
				try {
					await hook();
				} catch (error) {
					failures.push(`${entry.name} teardown: ${String(error)}`);
				}
			}
		}
	}
	return Object.freeze({ passed, failures: Object.freeze(failures) });
}
