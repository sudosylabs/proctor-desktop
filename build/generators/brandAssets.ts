import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Repository } from '../checks/types.ts';
import type { Generator } from './registry.ts';

interface RenderedImage {
	readonly width: number;
	readonly height: number;
	asPng(): Uint8Array;
	free(): void;
}

interface ResvgInstance {
	render(): RenderedImage;
	free(): void;
}

interface ResvgModule {
	readonly initWasm: (input: Uint8Array) => Promise<void>;
	readonly Resvg: new (
		svg: string,
		options: {
			readonly fitTo: { readonly mode: 'width'; readonly value: number };
			readonly font: { readonly loadSystemFonts: false };
			readonly shapeRendering: 2;
			readonly textRendering: 2;
			readonly imageRendering: 0;
		}
	) => ResvgInstance;
}

const { initWasm, Resvg } = createRequire(import.meta.url)('@resvg/resvg-wasm') as ResvgModule;

const AUTHORITY = 'resources/branding/manifest.json';
const GENERATED_MANIFEST = 'resources/branding/generated/manifest.json';
const APP_ICON_SIZES = Object.freeze([16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024]);
const WINDOWS_SIZES = Object.freeze([16, 20, 24, 32, 40, 48, 64, 256]);
const MACOS_CHUNKS = Object.freeze([
	['icp4', 16],
	['icp5', 32],
	['icp6', 64],
	['ic07', 128],
	['ic08', 256],
	['ic09', 512],
	['ic10', 1024]
] as const);
const REQUIRED_SOURCE_NAMES = Object.freeze([
	'appIcon',
	'mark',
	'markWhite',
	'lockupLight',
	'lockupDark',
	'lockupMonochrome'
] as const);

const APP_ICON_OUTPUTS = APP_ICON_SIZES.map(
	(size) => `resources/branding/generated/app-icon/proctor-app-icon-${size}.png`
);
const WINDOWS_ICON = 'resources/branding/platform/win32/proctor.ico';
const MACOS_ICON = 'resources/branding/platform/darwin/proctor.icns';
const LINUX_ICON = 'resources/branding/platform/linux/proctor.png';

interface BrandSource {
	readonly path: string;
	readonly canonicalPath: string;
	readonly sha256: string;
}

interface BrandManifest {
	readonly schemaVersion: number;
	readonly sources: Readonly<Record<string, BrandSource>>;
	readonly platforms: {
		readonly windows: { readonly format: string; readonly sizes: readonly number[] };
		readonly macos: { readonly format: string; readonly sizes: readonly number[] };
		readonly linux: { readonly format: string; readonly sizes: readonly number[] };
	};
}

let resvgInitialization: Promise<void> | undefined;

export const brandAssetsGenerator: Generator = {
	id: 'brand.assets',
	inputs: [
		AUTHORITY,
		'resources/branding/source/app-icon/proctor-app-icon.svg',
		'resources/branding/source/mark/proctor-mark.svg',
		'resources/branding/source/mark/proctor-mark-white.svg',
		'resources/branding/source/lockup/proctor-lockup.svg',
		'resources/branding/source/lockup/proctor-lockup-purple-white.svg',
		'resources/branding/source/lockup/proctor-lockup-white.svg'
	],
	committedOutputs: [
		...APP_ICON_OUTPUTS,
		WINDOWS_ICON,
		MACOS_ICON,
		LINUX_ICON,
		GENERATED_MANIFEST
	],
	buildOutputs: [],
	async generate(repository, outputRoot) {
		const manifest = readBrandManifest(repository);
		validateSources(repository, manifest);
		await initializeResvg();
		const appIcon = repository.read(manifest.sources.appIcon!.path);
		const rasters = new Map<number, Uint8Array>();
		for (const size of APP_ICON_SIZES) {
			const png = renderSquarePng(appIcon, size);
			rasters.set(size, png);
			writeOutput(outputRoot, appIconOutput(size), png);
		}
		const windowsIcon = encodeIco(
			WINDOWS_SIZES.map((size) => ({ size, png: requiredRaster(rasters, size) }))
		);
		const macosIcon = encodeIcns(
			MACOS_CHUNKS.map(([type, size]) => ({ type, png: requiredRaster(rasters, size) }))
		);
		const linuxIcon = requiredRaster(rasters, 512);
		writeOutput(outputRoot, WINDOWS_ICON, windowsIcon);
		writeOutput(outputRoot, MACOS_ICON, macosIcon);
		writeOutput(outputRoot, LINUX_ICON, linuxIcon);
		writeOutput(
			outputRoot,
			GENERATED_MANIFEST,
			`${JSON.stringify(
				{
					generatedBy: 'brand.assets',
					schemaVersion: 1,
					authority: AUTHORITY,
					outputs: [
						...APP_ICON_SIZES.map((size) =>
							describeOutput(appIconOutput(size), requiredRaster(rasters, size), {
								width: size,
								height: size
							})
						),
						describeOutput(WINDOWS_ICON, windowsIcon, {
							format: 'ico',
							sizes: WINDOWS_SIZES
						}),
						describeOutput(MACOS_ICON, macosIcon, {
							format: 'icns',
							sizes: MACOS_CHUNKS.map(([, size]) => size)
						}),
						describeOutput(LINUX_ICON, linuxIcon, {
							format: 'png',
							width: 512,
							height: 512
						})
					]
				},
				null,
				2
			)}\n`
		);
	}
};

function readBrandManifest(repository: Repository): BrandManifest {
	const value = JSON.parse(repository.read(AUTHORITY)) as BrandManifest;
	if (value.schemaVersion !== 1) throw new Error('Unsupported brand manifest schema version');
	const sourceNames = Object.keys(value.sources).sort();
	const requiredSourceNames = [...REQUIRED_SOURCE_NAMES].sort();
	if (
		sourceNames.length !== requiredSourceNames.length ||
		sourceNames.some((name, index) => name !== requiredSourceNames[index])
	)
		throw new Error('Brand manifest source set differs from the generator contract');
	if (
		value.platforms.windows.format !== 'ico' ||
		!sameNumbers(value.platforms.windows.sizes, WINDOWS_SIZES)
	)
		throw new Error('Brand manifest Windows icon contract differs from the generator');
	if (
		value.platforms.macos.format !== 'icns' ||
		!sameNumbers(
			value.platforms.macos.sizes,
			MACOS_CHUNKS.map(([, size]) => size)
		)
	)
		throw new Error('Brand manifest macOS icon contract differs from the generator');
	if (value.platforms.linux.format !== 'png' || !sameNumbers(value.platforms.linux.sizes, [512]))
		throw new Error('Brand manifest Linux icon contract differs from the generator');
	return value;
}

function validateSources(repository: Repository, manifest: BrandManifest): void {
	for (const [name, source] of Object.entries(manifest.sources)) {
		if (!brandAssetsGenerator.inputs.includes(source.path))
			throw new Error(`Brand source ${name} is not a registered generator input`);
		if (!source.canonicalPath.startsWith('assets/brand/'))
			throw new Error(`Brand source ${name} has an invalid canonical path`);
		const digest = sha256(repository.readBytes(source.path));
		if (digest !== source.sha256)
			throw new Error(`Brand source ${source.path} differs from its accepted digest`);
	}
}

async function initializeResvg(): Promise<void> {
	resvgInitialization ??= initWasm(
		readFileSync(fileURLToPath(import.meta.resolve('@resvg/resvg-wasm/index_bg.wasm')))
	);
	await resvgInitialization;
}

function renderSquarePng(svg: string, size: number): Uint8Array {
	const renderer = new Resvg(svg, {
		fitTo: { mode: 'width', value: size },
		font: { loadSystemFonts: false },
		shapeRendering: 2,
		textRendering: 2,
		imageRendering: 0
	});
	try {
		const rendered = renderer.render();
		try {
			if (rendered.width !== size || rendered.height !== size)
				throw new Error(
					`Rendered app icon is ${rendered.width}x${rendered.height}, expected ${size}x${size}`
				);
			return Uint8Array.from(rendered.asPng());
		} finally {
			rendered.free();
		}
	} finally {
		renderer.free();
	}
}

export function encodeIco(
	images: readonly { readonly size: number; readonly png: Uint8Array }[]
): Uint8Array {
	if (images.length === 0 || images.length > 255)
		throw new Error('ICO requires between 1 and 255 images');
	const headerLength = 6 + images.length * 16;
	const totalLength =
		headerLength + images.reduce((total, image) => total + image.png.byteLength, 0);
	const output = new Uint8Array(totalLength);
	const view = new DataView(output.buffer);
	view.setUint16(0, 0, true);
	view.setUint16(2, 1, true);
	view.setUint16(4, images.length, true);
	let offset = headerLength;
	for (let index = 0; index < images.length; index++) {
		const image = images[index]!;
		assertIconSize(image.size);
		assertPngDimensions(image.png, image.size, image.size);
		const entry = 6 + index * 16;
		output[entry] = image.size === 256 ? 0 : image.size;
		output[entry + 1] = image.size === 256 ? 0 : image.size;
		output[entry + 2] = 0;
		output[entry + 3] = 0;
		view.setUint16(entry + 4, 1, true);
		view.setUint16(entry + 6, 32, true);
		view.setUint32(entry + 8, image.png.byteLength, true);
		view.setUint32(entry + 12, offset, true);
		output.set(image.png, offset);
		offset += image.png.byteLength;
	}
	return output;
}

export function encodeIcns(
	images: readonly { readonly type: string; readonly png: Uint8Array }[]
): Uint8Array {
	if (images.length === 0) throw new Error('ICNS requires at least one image');
	const chunks = images.map(({ type, png }) => {
		if (!/^[\x20-\x7e]{4}$/.test(type)) throw new Error(`Invalid ICNS chunk type ${type}`);
		assertPng(png);
		const chunk = new Uint8Array(8 + png.byteLength);
		for (let index = 0; index < 4; index++) chunk[index] = type.charCodeAt(index);
		new DataView(chunk.buffer).setUint32(4, chunk.byteLength, false);
		chunk.set(png, 8);
		return chunk;
	});
	const totalLength = 8 + chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const output = new Uint8Array(totalLength);
	output.set(new TextEncoder().encode('icns'), 0);
	new DataView(output.buffer).setUint32(4, totalLength, false);
	let offset = 8;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

export function pngDimensions(png: Uint8Array): {
	readonly width: number;
	readonly height: number;
} {
	assertPng(png);
	if (png.byteLength < 24 || new TextDecoder().decode(png.subarray(12, 16)) !== 'IHDR')
		throw new Error('PNG has no leading IHDR chunk');
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	return Object.freeze({ width: view.getUint32(16, false), height: view.getUint32(20, false) });
}

function assertPng(png: Uint8Array): void {
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];
	if (png.byteLength < signature.length || signature.some((value, index) => png[index] !== value))
		throw new Error('Icon payload is not a PNG');
}

function assertPngDimensions(png: Uint8Array, width: number, height: number): void {
	const dimensions = pngDimensions(png);
	if (dimensions.width !== width || dimensions.height !== height)
		throw new Error(
			`PNG is ${dimensions.width}x${dimensions.height}, expected ${width}x${height}`
		);
}

function assertIconSize(size: number): void {
	if (!Number.isInteger(size) || size < 1 || size > 256)
		throw new Error(`ICO size ${size} is outside the supported range`);
}

function requiredRaster(rasters: ReadonlyMap<number, Uint8Array>, size: number): Uint8Array {
	const raster = rasters.get(size);
	if (raster === undefined) throw new Error(`Missing generated ${size}px app icon`);
	return raster;
}

function appIconOutput(size: number): string {
	return `resources/branding/generated/app-icon/proctor-app-icon-${size}.png`;
}

function writeOutput(outputRoot: string, path: string, content: string | Uint8Array): void {
	const destination = join(outputRoot, path);
	mkdirSync(dirname(destination), { recursive: true });
	writeFileSync(destination, content);
}

function describeOutput(
	path: string,
	bytes: Uint8Array,
	details: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
	return { path, sha256: sha256(bytes), bytes: bytes.byteLength, ...details };
}

function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function sameNumbers(actual: readonly number[], expected: readonly number[]): boolean {
	return (
		actual.length === expected.length &&
		actual.every((value, index) => value === expected[index])
	);
}
