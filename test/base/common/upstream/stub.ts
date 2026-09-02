type AnyFunction = (...arguments_: readonly unknown[]) => unknown;

export interface StubFunction {
	(...arguments_: readonly unknown[]): unknown;
	readonly args: readonly (readonly unknown[])[];
	restore(): void;
}

export function stub(): StubFunction;
export function stub<T extends object, K extends keyof T>(target: T, property: K): StubFunction;
export function stub<T extends object, K extends keyof T>(target?: T, property?: K): StubFunction {
	const calls: (readonly unknown[])[] = [];
	const original = target === undefined || property === undefined ? undefined : target[property];
	const replacement = ((...arguments_: readonly unknown[]) => {
		calls.push(arguments_);
	}) as StubFunction;
	Object.defineProperties(replacement, {
		args: { get: () => calls },
		restore: {
			value: () => {
				if (target !== undefined && property !== undefined)
					target[property] = original as T[K];
			}
		}
	});
	if (target !== undefined && property !== undefined) target[property] = replacement as T[K];
	return replacement;
}

export type { AnyFunction };
