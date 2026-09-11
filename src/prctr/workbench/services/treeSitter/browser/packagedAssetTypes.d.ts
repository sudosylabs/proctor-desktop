declare module '*.wasm' {
	const bytes: Uint8Array;
	export default bytes;
}
declare module '*.scm' {
	const query: string;
	export default query;
}
