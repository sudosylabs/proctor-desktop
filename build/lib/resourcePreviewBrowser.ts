import type { BuildOptions } from 'esbuild';

/** Dependency-only browser adaptation, matching VS Code's extension browser build. */
export const resourcePreviewBrowserOptions: Pick<BuildOptions, 'alias' | 'define' | 'mainFields'> =
	{
		// The pinned Markdown service expects vscode-uri's CommonJS default export.
		mainFields: ['browser', 'main', 'module'],
		alias: { path: 'path-browserify', 'node:path': 'path-browserify' },
		define: {
			'process.platform': JSON.stringify('web'),
			'process.env': JSON.stringify({}),
			'process.env.BROWSER_ENV': JSON.stringify('true')
		}
	};
