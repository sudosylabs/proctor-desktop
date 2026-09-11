/** Packaged language-result budgets. They do not alter or truncate the working document. */
export const JSON_RESPONSE_LIMITS = Object.freeze({ items: 2048, nodes: 65536, bytes: 1024 * 1024, depth: 128 });

/** Check before recursive provider conversion or publishing editor decorations. */
export function isJsonResponseWithinLimits(method: string, result: unknown): boolean {
	const pending: { value: unknown; depth: number }[] = [{ value: result, depth: 0 }];
	let nodes = 0;
	let bytes = 0;
	let symbols = 0;
	const encoder = new TextEncoder();
	while (pending.length) {
		const { value, depth } = pending.pop()!;
		if (++nodes > JSON_RESPONSE_LIMITS.nodes || depth > JSON_RESPONSE_LIMITS.depth) return false;
		if (typeof value === 'string') {
			if (value.length > JSON_RESPONSE_LIMITS.bytes - bytes) return false;
			bytes += encoder.encode(value).byteLength;
		} else if (Array.isArray(value)) {
			if (value.length > JSON_RESPONSE_LIMITS.items) return false;
			for (const item of value) pending.push({ value: item, depth: depth + 1 });
		} else if (value !== null && typeof value === 'object') {
			if (method === 'textDocument/documentSymbol' && 'name' in value && 'kind' in value && ++symbols > JSON_RESPONSE_LIMITS.items) return false;
			for (const [key, item] of Object.entries(value)) {
				bytes += key.length;
				pending.push({ value: item, depth: depth + 1 });
			}
		} else {
			bytes += 8;
		}
		if (bytes > JSON_RESPONSE_LIMITS.bytes || pending.length + nodes > JSON_RESPONSE_LIMITS.nodes) return false;
	}
	return true;
}
