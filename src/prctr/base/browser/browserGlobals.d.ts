interface TrustedHTML {
	readonly __trustedHTMLBrand: never;
}
interface TrustedScript {
	readonly __trustedScriptBrand: never;
}
interface TrustedScriptURL {
	readonly __trustedScriptURLBrand: never;
}
interface TrustedTypePolicyOptions {
	readonly createHTML?: (input: string, ...arguments_: readonly unknown[]) => string;
	readonly createScript?: (input: string, ...arguments_: readonly unknown[]) => string;
	readonly createScriptURL?: (input: string, ...arguments_: readonly unknown[]) => string;
}
interface TrustedTypePolicy {
	readonly name: string;
	createHTML(input: string, ...arguments_: readonly unknown[]): TrustedHTML;
	createScript(input: string, ...arguments_: readonly unknown[]): TrustedScript;
	createScriptURL(input: string, ...arguments_: readonly unknown[]): TrustedScriptURL;
}
interface HTMLElement {
	editContext?: unknown;
}
