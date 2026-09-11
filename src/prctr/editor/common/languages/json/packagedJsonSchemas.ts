/** Exact packaged resources. Schema references cannot acquire network/file authority. */
export class PackagedJsonSchemas {
	private readonly contents = new Map<string, string>();

	constructor(resources: ReadonlyMap<string, string>) {
		let size = 0;
		for (const [uri, source] of resources) {
			if (!uri.startsWith('prctr-schema://') || uri.length > 4096)
				throw new TypeError('Invalid packaged schema identifier.');
			size += source.length;
			if (size > 4 * 1024 * 1024)
				throw new RangeError('Packaged schemas exceed their limit.');
			this.contents.set(uri, source);
		}
	}

	read(uri: unknown): string {
		if (typeof uri !== 'string' || !this.contents.has(uri))
			throw new Error('Schema is not packaged.');
		return this.contents.get(uri)!;
	}
}
