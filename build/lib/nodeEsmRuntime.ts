/** Preserve CommonJS dependencies' Node built-ins inside a bundled ESM main process. */
export const nodeEsmRuntime = {
	banner: {
		js: "import { createRequire as prctrCreateRequire } from 'node:module'; const require = prctrCreateRequire(import.meta.url);"
	},
	define: { 'process.env.WS_NO_BUFFER_UTIL': '"1"', 'process.env.WS_NO_UTF_8_VALIDATE': '"1"' }
};
