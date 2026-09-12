import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { build } from 'esbuild';

/** Compile only packaged preview entrypoints; document content cannot add modules. */
export async function buildResourcePreviewAssets(outputPath: string): Promise<void> {
	const root = 'src/prctr/workbench/services/resourcePreview/browser';
	const bundle = async (path: string, define: Record<string, string> = {}): Promise<string> => {
		const result = await build({
			entryPoints: [path],
			bundle: true,
			write: false,
			format: 'iife',
			platform: 'browser',
			target: 'es2024',
			define,
			logLevel: 'silent'
		});
		return result.outputFiles[0]!.text;
	};
	const binaries: Record<string, string> = {};
	const notices: Record<string, string> = {
		'pdfjs/LICENSE': await readFile('node_modules/pdfjs-dist/LICENSE', 'utf8')
	};
	for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
		for (const name of (await readdir(`node_modules/pdfjs-dist/${directory}`)).sort()) {
			if (name.startsWith('LICENSE')) {
				notices[`pdfjs/${directory}/${name}`] = await readFile(
					`node_modules/pdfjs-dist/${directory}/${name}`,
					'utf8'
				);
			}
			if (/\.(?:bcmap|ttf|pfb|wasm)$/.test(name)) {
				binaries[`${directory}/${name}`] = (
					await readFile(`node_modules/pdfjs-dist/${directory}/${name}`)
				).toString('base64');
			}
		}
	}
	const asset = async (name: string): Promise<string> =>
		(await readFile(`resources/resource-preview/${name}`, 'utf8')).replaceAll(
			'--vscode-',
			'--prctr-theme-'
		);
	let imageStyle = await asset('imagePreview.css');
	for (const name of ['loading', 'loading-dark', 'loading-hc']) {
		const svg = await readFile(`resources/resource-preview/${name}.svg`);
		imageStyle = imageStyle.replaceAll(
			`url('./${name}.svg')`,
			`url("data:image/svg+xml;base64,${svg.toString('base64')}")`
		);
	}
	let pdfStyle = await readFile('node_modules/pdfjs-dist/web/pdf_viewer.css', 'utf8');
	for (const match of pdfStyle.matchAll(/url\(["']?(images\/[\w.-]+)["']?\)/g)) {
		const path = match[1]!;
		const content = await readFile(`node_modules/pdfjs-dist/web/${path}`);
		const mediaType = path.endsWith('.svg') ? 'image/svg+xml' : 'image/gif';
		pdfStyle = pdfStyle.replaceAll(
			match[0],
			`url("data:${mediaType};base64,${content.toString('base64')}")`
		);
	}
	const assets = {
		// Retain notices alongside embedded third-party font, CMap and decoder bytes.
		notices,
		bootstrap: await bundle(`${root}/previewBootstrap.ts`),
		imageScript: await bundle(`${root}/media/imagePreview.js`),
		imageMetadataWorker: await bundle(`${root}/imageMetadataWorker.ts`),
		imageStyle,
		markdownScript: await bundle(`${root}/markdownPreviewEntry.ts`),
		markdownStyle: `${await asset('markdown.css')}\n${await asset('highlight.css')}`,
		pdfScript: await bundle(`${root}/pdfPreviewEntry.ts`, {
			PROCTOR_PDF_WORKER_SOURCE: JSON.stringify(
				await bundle('node_modules/pdfjs-dist/build/pdf.worker.mjs')
			),
			PROCTOR_PDF_BINARY_ASSETS: JSON.stringify(binaries)
		}),
		pdfStyle: `${pdfStyle}\n.pdf-container{position:absolute;inset:0;overflow:auto}html,body{height:100%;margin:0}`
	};
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, JSON.stringify(assets));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	await buildResourcePreviewAssets(process.argv[2] ?? '.scratch/resource-preview/assets.json');
}
