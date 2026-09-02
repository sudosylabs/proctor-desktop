let configuredResourceRoot: string | undefined;

export function configureResourceRoot(resourceRoot: string): void {
	if (resourceRoot.trim() === '') {
		throw new TypeError('Resource root must not be empty');
	}
	if (configuredResourceRoot !== undefined) {
		if (configuredResourceRoot === resourceRoot) return;
		throw new Error('Resource root is already configured');
	}
	configuredResourceRoot = resourceRoot;
}

export function getResourceRoot(): string | undefined {
	return configuredResourceRoot;
}
