/** Initialization carries packaged translations, never a URI to fetch. */
export interface JsonWorkerInitialization {
	readonly type: 'proctor-json-worker-initialize';
	readonly messages?: Readonly<Record<string, string>>;
}

export function readJsonWorkerInitialization(value: unknown): JsonWorkerInitialization {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('Invalid JSON worker initialization.');
	const input = value as Record<string, unknown>;
	if (
		input.type !== 'proctor-json-worker-initialize' ||
		Object.keys(input).some((key) => key !== 'type' && key !== 'messages')
	)
		throw new TypeError('Invalid JSON worker initialization.');
	if (input.messages === undefined) return { type: 'proctor-json-worker-initialize' };
	if (
		typeof input.messages !== 'object' ||
		input.messages === null ||
		Array.isArray(input.messages)
	)
		throw new TypeError('Invalid packaged JSON messages.');
	const messages: Record<string, string> = Object.create(null);
	let size = 0;
	const entries = Object.entries(input.messages);
	if (entries.length > 4096) throw new RangeError('Packaged JSON messages exceed their limit.');
	for (const [key, message] of entries) {
		if (typeof message !== 'string') throw new TypeError('Invalid packaged JSON message.');
		size += key.length + message.length;
		if (size > 512 * 1024) throw new RangeError('Packaged JSON messages exceed their limit.');
		messages[key] = message;
	}
	return { type: 'proctor-json-worker-initialize', messages: Object.freeze(messages) };
}
