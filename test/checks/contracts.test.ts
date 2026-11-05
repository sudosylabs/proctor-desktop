import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Check, Diagnostic } from '../../build/checks/types.ts';
import { checks, checkMap } from '../../build/checks/registry.ts';
import { FileSystemRepository, VirtualRepository } from '../../build/checks/repository.ts';

type Mutation = (files: Record<string, string | Uint8Array | { symlink: string }>) => void;

const real = new FileSystemRepository(process.cwd());
function snapshot(mutation?: Mutation): VirtualRepository {
	const files: Record<string, string | Uint8Array | { symlink: string }> = {};
	for (const path of real.files()) {
		const link = real.readLink(path);
		files[path] = link === undefined ? real.readBytes(path) : { symlink: link };
	}
	mutation?.(files);
	return new VirtualRepository(files);
}

async function run(check: Check, repository: VirtualRepository): Promise<readonly Diagnostic[]> {
	return check.run({ repository, registeredCheckIds: new Set(checks.map((entry) => entry.id)) });
}

const displayTopologyManifest = 'native/crates/display-topology/Cargo.toml';
const captureSessionManifest = 'native/crates/capture-session-state/Cargo.toml';

function appendCargoDependency(
	files: Record<string, string | Uint8Array | { symlink: string }>,
	declaration: string
): void {
	const scoped = declaration.replace(
		/^\[dependencies\./,
		"[target.'cfg(proctor_checker_fixture)'.dependencies."
	);
	const prefix =
		scoped === declaration ? "[target.'cfg(proctor_checker_fixture)'.dependencies]\n" : '';
	files[displayTopologyManifest] =
		`${String(files[displayTopologyManifest])}\n${prefix}${scoped}\n`;
}

function prependCargoRoot(
	files: Record<string, string | Uint8Array | { symlink: string }>,
	declaration: string
): void {
	files[displayTopologyManifest] = `${declaration}\n${String(files[displayTopologyManifest])}`;
}

function replaceDisplayTopologyWithRootDeclaration(
	files: Record<string, string | Uint8Array | { symlink: string }>,
	declaration: string
): void {
	files[displayTopologyManifest] = `${declaration}

[target.'cfg(target_os = "windows")'.dependencies]
windows-sys = { version = "=0.61.2", features = ["Win32_Devices_Display", "Win32_Foundation", "Win32_Graphics_Gdi", "Win32_System_LibraryLoader", "Win32_UI_WindowsAndMessaging"] }
`;
}

const failures: Readonly<
	Record<string, { mutate: Mutation; expectedPath: string; expectedProblem: RegExp }>
> = {
	'tooling.graph': {
		mutate: (files) => {
			files['build/cycleOne.ts'] = "import './cycleTwo.ts';\n";
			files['build/cycleTwo.ts'] = "import './cycleOne.ts';\n";
		},
		expectedPath: 'build/cycleOne.ts',
		expectedProblem: /Tooling cycle/
	},
	'policy.schemas': {
		mutate: (files) => {
			files['build/policies/assurance.json'] = String(
				files['build/policies/assurance.json']
			).replace('"controls": [', '"controls": [], "unused": [');
		},
		expectedPath: 'build/policies/assurance.json',
		expectedProblem: /must NOT have additional properties|must NOT have fewer/
	},
	'assurance.coverage': {
		mutate: (files) => {
			files['docs/architecture/invariants.md'] = String(
				files['docs/architecture/invariants.md']
			).replace('`product.exam-workbench`', '`product.renamed`');
		},
		expectedPath: 'build/policies/assurance.json',
		expectedProblem: /unknown invariant product\.exam-workbench/
	},
	'dependencies.admission': {
		mutate: (files) => {
			const manifest = JSON.parse(String(files['package.json'])) as {
				devDependencies: Record<string, string>;
			};
			manifest.devDependencies['unreviewed-package'] = '1.0.0';
			files['package.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
		},
		expectedPath: 'package.json',
		expectedProblem: /unreviewed-package is not admitted/
	},
	'repository.documentation': {
		mutate: (files) => {
			files['docs/README.md'] = `${String(files['docs/README.md'])}\n[broken](missing.md)\n`;
		},
		expectedPath: 'docs/README.md',
		expectedProblem: /does not exist/
	},
	'repository.hygiene': {
		mutate: (files) => {
			files['native/Cargo.toml'] = `${String(files['native/Cargo.toml']).trimEnd()}  \n`;
		},
		expectedPath: 'native/Cargo.toml',
		expectedProblem: /trailing whitespace/
	},
	'ci.actions-pinned': {
		mutate: (files) => {
			files['.github/workflows/foundation.yml'] =
				'jobs:\n  check:\n    steps:\n      - uses: actions/checkout@v4\n';
		},
		expectedPath: '.github/workflows/foundation.yml',
		expectedProblem: /not pinned/
	},
	'generated.parity': {
		mutate: (files) => {
			files['notes.ts'] = `// ${'@generated'} by missing.owner\n`;
		},
		expectedPath: 'notes.ts',
		expectedProblem: /unregistered owner/
	},
	'upstream.provenance': {
		mutate: (files) => {
			files['src/prctr/base/common/example.ts'] =
				`// ${'@proctor-vscode-port'} orphan-cluster\n`;
		},
		expectedPath: 'src/prctr/base/common/example.ts',
		expectedProblem: /unowned cluster/
	},
	'source.graph': {
		mutate: (files) => {
			files['src/prctr/base/common/lower.ts'] = "import '../../platform/common/higher.js';\n";
			files['src/prctr/platform/common/higher.ts'] = 'export const higher = true;\n';
		},
		expectedPath: 'src/prctr/base/common/lower.ts',
		expectedProblem: /imports upward/
	},
	'source.compositions': {
		mutate: (files) => {
			const policy = JSON.parse(String(files['build/policies/compositions.json'])) as {
				compositions: unknown[];
			};
			policy.compositions = [];
			files['build/policies/compositions.json'] = `${JSON.stringify(policy, null, 2)}\n`;
		},
		expectedPath: 'build/policies/compositions.json',
		expectedProblem: /without declared compositions/
	},
	'source.css': {
		mutate: (files) => {
			files['src/prctr/base/browser/ui/control.ts'] = "import './control.css';\n";
			files['src/prctr/base/browser/ui/control.css'] =
				'@layer controls { #bad { color: red; } }\n';
		},
		expectedPath: 'src/prctr/base/browser/ui/control.css',
		expectedProblem: /uses an id/
	}
};

void test('every registered checker has a pass/fail virtual repository contract', async (t) => {
	const map = checkMap();
	assert.deepEqual(
		[...map.values()]
			.filter((check) => check.contractRequired)
			.map((check) => check.id)
			.sort(),
		Object.keys(failures).sort()
	);
	for (const check of map.values()) {
		await t.test(check.id, async () => {
			const passing = await run(check, snapshot());
			assert.deepEqual(passing, [], `baseline should pass ${check.id}`);
			const contract = failures[check.id];
			assert.ok(contract);
			const failing = await run(check, snapshot(contract.mutate));
			assert.ok(
				failing.some(
					(item) =>
						item.checkId === check.id &&
						item.path === contract.expectedPath &&
						contract.expectedProblem.test(item.problem)
				),
				JSON.stringify(failing, null, 2)
			);
		});
	}
});

void test('dependency admission rejects an unreviewed exact Cargo dependency', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	const repository = snapshot((files) => {
		appendCargoDependency(files, 'unreviewed-native = { version = "=1.2.3" }');
	});
	const diagnostics = await run(check, repository);
	assert.ok(
		diagnostics.some(
			(item) =>
				item.path === 'native/crates/display-topology/Cargo.toml' &&
				/unreviewed-native is not admitted/.test(item.problem)
		)
	);
});

void test('dependency admission covers every Cargo registry declaration form', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	for (const declaration of [
		'unreviewed-string = "=1.2.3"',
		'unreviewed-inline = { version = "=1.2.3", default-features = false }',
		'[dependencies.unreviewed-table]\nversion = "=1.2.3"'
	]) {
		const repository = snapshot((files) => {
			appendCargoDependency(files, declaration);
		});
		const diagnostics = await run(check, repository);
		assert.ok(
			diagnostics.some(
				(item) =>
					item.path === 'native/crates/display-topology/Cargo.toml' &&
					/unreviewed-(?:string|inline|table) is not admitted/.test(item.problem)
			),
			`${declaration}: ${JSON.stringify(diagnostics)}`
		);
	}
});

void test('dependency admission resolves Cargo package aliases and rejects skipped keys', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	for (const declaration of [
		'local-alias = { package = "unreviewed-renamed", version = "=1.2.3" }',
		'[dependencies.local-table-alias]\npackage = "unreviewed-table-renamed"\nversion = "=1.2.3"',
		'"unreviewed-quoted" = "=1.2.3"',
		'[dependencies."unreviewed-quoted-table"]\nversion = "=1.2.3"'
	]) {
		const repository = snapshot((files) => {
			appendCargoDependency(files, declaration);
		});
		const diagnostics = await run(check, repository);
		assert.ok(
			diagnostics.some(
				(item) =>
					item.path === 'native/crates/display-topology/Cargo.toml' &&
					/unreviewed-(?:renamed|table-renamed|quoted|quoted-table)|unsupported/.test(
						item.problem
					)
			),
			`${declaration}: ${JSON.stringify(diagnostics)}`
		);
	}
});

void test('dependency admission rejects non-exact Cargo versions', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	const repository = snapshot((files) => {
		appendCargoDependency(files, 'not-exact = "1.2.3"');
	});
	const diagnostics = await run(check, repository);
	assert.ok(
		diagnostics.some(
			(item) =>
				item.path === 'native/crates/display-topology/Cargo.toml' &&
				/not-exact is not pinned/.test(item.problem)
		)
	);
});

void test('dependency admission rejects alternate Cargo sources', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	for (const declaration of [
		'windows-sys = { version = "=0.61.2", git = "https://example.invalid/windows-rs" }',
		'windows-sys = { version = "=0.61.2", registry = "private" }',
		'[dependencies.windows-sys]\nversion = "=0.61.2"\ngit = "https://example.invalid/windows-rs"'
	]) {
		const repository = snapshot((files) => {
			appendCargoDependency(files, declaration);
		});
		const diagnostics = await run(check, repository);
		assert.ok(
			diagnostics.some(
				(item) =>
					item.path === 'native/crates/display-topology/Cargo.toml' &&
					/unsupported alternate Cargo source/.test(item.problem)
			),
			`${declaration}: ${JSON.stringify(diagnostics)}`
		);
	}
});

void test('dependency admission rejects quoted Cargo source and path properties', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	for (const declaration of [
		'windows-sys = { version = "=0.61.2", "git" = "https://example.invalid/windows-rs" }',
		'windows-sys = { version = "=0.61.2", "path" = "../../../../outside" }',
		'[dependencies.windows-sys]\nversion = "=0.61.2"\n"git" = "https://example.invalid/windows-rs"',
		'[dependencies.windows-sys]\nversion = "=0.61.2"\n"path" = "../../../../outside"'
	]) {
		const repository = snapshot((files) => {
			appendCargoDependency(files, declaration);
		});
		const diagnostics = await run(check, repository);
		assert.ok(
			diagnostics.some(
				(item) =>
					item.path === 'native/crates/display-topology/Cargo.toml' &&
					/unsupported alternate Cargo source|not a tracked member/.test(item.problem)
			),
			`${declaration}: ${JSON.stringify(diagnostics)}`
		);
	}
});

void test('dependency admission rejects dotted Cargo dependency declarations', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	for (const declaration of [
		'dependencies.unreviewed-dotted = "=1.2.3"',
		'target.\'cfg(proctor_checker_dotted)\'.dependencies.unreviewed-target-dotted = "=1.2.3"'
	]) {
		const repository = snapshot((files) => {
			replaceDisplayTopologyWithRootDeclaration(files, declaration);
		});
		const diagnostics = await run(check, repository);
		assert.ok(
			diagnostics.some(
				(item) =>
					item.path === 'native/crates/display-topology/Cargo.toml' &&
					/unreviewed-(?:dotted|target-dotted) is not admitted/.test(item.problem)
			),
			`${declaration}: ${JSON.stringify(diagnostics)}`
		);
	}
});

void test('dependency admission rejects dotted Cargo source overrides', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	for (const declaration of [
		'patch.crates-io.windows-sys = { git = "https://example.invalid/windows-rs" }',
		'replace."windows-sys:0.61.2" = { path = "../../../../outside" }'
	]) {
		const repository = snapshot((files) => {
			prependCargoRoot(files, declaration);
		});
		const diagnostics = await run(check, repository);
		assert.ok(
			diagnostics.some(
				(item) =>
					item.path === 'native/crates/display-topology/Cargo.toml' &&
					/Cargo override/.test(item.problem)
			),
			`${declaration}: ${JSON.stringify(diagnostics)}`
		);
	}
});

void test('dependency admission rejects quoted Cargo structural keys', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	for (const declaration of [
		'["dependencies".unreviewed-quoted-structure]\nversion = "=1.2.3"',
		'["patch".crates-io]\nwindows-sys = { git = "https://example.invalid/windows-rs" }',
		'"replace"."windows-sys:0.61.2" = { path = "../../../../outside" }'
	]) {
		const repository = snapshot((files) => {
			prependCargoRoot(files, declaration);
		});
		const diagnostics = await run(check, repository);
		assert.ok(
			diagnostics.some(
				(item) =>
					item.path === 'native/crates/display-topology/Cargo.toml' &&
					/is not admitted as a Cargo dependency|Cargo override/.test(item.problem)
			),
			`${declaration}: ${JSON.stringify(diagnostics)}`
		);
	}
	const assignmentDiagnostics = await run(
		check,
		snapshot((files) => {
			replaceDisplayTopologyWithRootDeclaration(
				files,
				'"dependencies".unreviewed-quoted-assignment = "=1.2.3"'
			);
		})
	);
	assert.ok(
		assignmentDiagnostics.some((item) =>
			/unreviewed-quoted-assignment is not admitted/.test(item.problem)
		),
		JSON.stringify(assignmentDiagnostics)
	);
});

void test('dependency admission rejects spaced Cargo structural dotted keys', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	for (const declaration of [
		'dependencies . unreviewed-spaced = "=1.2.3"',
		'[patch . crates-io]\nwindows-sys = { git = "https://example.invalid/windows-rs" }'
	]) {
		const repository = snapshot((files) => {
			if (declaration.startsWith('dependencies'))
				replaceDisplayTopologyWithRootDeclaration(files, declaration);
			else prependCargoRoot(files, declaration);
		});
		const diagnostics = await run(check, repository);
		assert.ok(
			diagnostics.some(
				(item) =>
					item.path === 'native/crates/display-topology/Cargo.toml' &&
					/is not admitted as a Cargo dependency|Cargo override/.test(item.problem)
			),
			`${declaration}: ${JSON.stringify(diagnostics)}`
		);
	}
});

void test('dependency admission rejects external Cargo paths and source overrides', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	for (const mutate of [
		(files: Record<string, string | Uint8Array | { symlink: string }>): void => {
			appendCargoDependency(files, 'outside = { path = "../../../../outside" }');
		},
		(files: Record<string, string | Uint8Array | { symlink: string }>): void => {
			const path = 'native/crates/display-topology/Cargo.toml';
			files[path] =
				`${String(files[path])}\n[patch.crates-io]\nwindows-sys = { path = "../patched" }\n`;
		},
		(files: Record<string, string | Uint8Array | { symlink: string }>): void => {
			files['native/.cargo/config.toml'] = '[registry]\ndefault = "private"\n';
		}
	]) {
		const diagnostics = await run(check, snapshot(mutate));
		assert.ok(
			diagnostics.some((item) =>
				/not a tracked member|Cargo override|Cargo configuration is not admitted/.test(
					item.problem
				)
			),
			JSON.stringify(diagnostics)
		);
	}
});

void test('dependency admission parses escaped and bracket-bearing TOML keys structurally', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	for (const declaration of [
		'["depend\\u0065ncies".unreviewed-escaped]\nversion = "=1.2.3"',
		'[dependencies."unreviewed]name"]\nversion = "=1.2.3"'
	]) {
		const diagnostics = await run(
			check,
			snapshot((files) => {
				appendCargoDependency(
					files,
					declaration.replace(/^\[dependencies\./, '[dependencies.')
				);
			})
		);
		assert.ok(
			diagnostics.some((item) =>
				/unreviewed-(?:escaped|]name) is not admitted|dependency key unreviewed]name is unsupported/.test(
					item.problem
				)
			),
			`${declaration}: ${JSON.stringify(diagnostics)}`
		);
	}
	const overrideDiagnostics = await run(
		check,
		snapshot((files) => {
			prependCargoRoot(
				files,
				'"p\\u0061tch".crates-io.windows-sys = { git = "https://example.invalid/windows-rs" }'
			);
		})
	);
	assert.ok(
		overrideDiagnostics.some((item) => /Cargo override/.test(item.problem)),
		JSON.stringify(overrideDiagnostics)
	);
});

void test('dependency admission compares normalized Cargo features, defaults, optionality, and target scopes', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	for (const mutation of [
		(manifest: string): string =>
			manifest.replace('"Win32_Graphics_Gdi"', '"Win32_System_Registry"'),
		(manifest: string): string =>
			manifest.replace('features = [', 'default-features = false, features = ['),
		(manifest: string): string =>
			manifest.replace('features = [', 'optional = true, features = ['),
		(manifest: string): string =>
			manifest.replace('[target.\'cfg(target_os = "windows")\'.dependencies]\n', '')
	]) {
		const diagnostics = await run(
			check,
			snapshot((files) => {
				files[displayTopologyManifest] = mutation(String(files[displayTopologyManifest]));
			})
		);
		assert.ok(
			diagnostics.some((item) => /exact per-manifest declaration tuples/.test(item.problem)),
			JSON.stringify(diagnostics)
		);
	}
});

void test('dependency admission normalizes insignificant Cargo target-selector whitespace', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	const diagnostics = await run(
		check,
		snapshot((files) => {
			files[displayTopologyManifest] = String(files[displayTopologyManifest]).replace(
				'cfg(target_os = "windows")',
				'cfg( target_os="windows" )'
			);
		})
	);
	assert.deepEqual(diagnostics, []);
});

void test('dependency admission distinguishes an unconditional declaration from a target named unconditional', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	const diagnostics = await run(
		check,
		snapshot((files) => {
			files[displayTopologyManifest] = String(files[displayTopologyManifest]).replace(
				'[target.\'cfg(target_os = "windows")\'.dependencies]',
				'[target.unconditional.dependencies]'
			);
		})
	);
	assert.ok(
		diagnostics.some((item) => /exact per-manifest declaration tuples/.test(item.problem)),
		JSON.stringify(diagnostics)
	);
});

void test('dependency admission rejects an additional unreviewed per-manifest declaration', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	const diagnostics = await run(
		check,
		snapshot((files) => {
			const path = 'native/crates/candidate-window-state/Cargo.toml';
			files[path] =
				`${String(files[path])}\n[target.'cfg(target_os = "macos")'.dependencies]\nwindows-sys = { version = "=0.61.2", features = ["Win32_Foundation"] }\n`;
		})
	);
	assert.ok(
		diagnostics.some((item) => /exact per-manifest declaration tuples/.test(item.problem)),
		JSON.stringify(diagnostics)
	);
});

void test('dependency admission keeps shared Cargo feature sets bound to their exact manifests', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	const diagnostics = await run(
		check,
		snapshot((files) => {
			const policyPath = 'build/policies/dependencies.json';
			const policy = JSON.parse(String(files[policyPath])) as {
				dependencies: Array<{
					ecosystem?: string;
					declarations?: Array<{ manifest: string; features: string[] }>;
				}>;
			};
			const cargo = policy.dependencies.find(
				(entry) =>
					entry.ecosystem === 'cargo' &&
					entry.declarations?.some(
						(declaration) => declaration.manifest === displayTopologyManifest
					)
			);
			assert.ok(cargo?.declarations);
			const capture = cargo.declarations.find(
				(entry) => entry.manifest === captureSessionManifest
			);
			const display = cargo.declarations.find(
				(entry) => entry.manifest === displayTopologyManifest
			);
			assert.ok(capture && display);
			[capture.features, display.features] = [display.features, capture.features];
			files[policyPath] = `${JSON.stringify(policy, null, 2)}\n`;
		})
	);
	assert.ok(
		diagnostics.some((item) => /exact per-manifest declaration tuples/.test(item.problem)),
		JSON.stringify(diagnostics)
	);
});

void test('dependency admission rejects workspace-inherited registry declarations until member tuples are modeled', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	const diagnostics = await run(
		check,
		snapshot((files) => {
			const manifest = String(files[displayTopologyManifest]);
			const declaration = manifest.match(/^windows-sys = .*$/mu)?.[0];
			assert.ok(declaration);
			files['native/Cargo.toml'] =
				`${String(files['native/Cargo.toml'])}\n[workspace.dependencies]\n${declaration}\n`;
			files[displayTopologyManifest] = manifest.replace(
				declaration,
				'windows-sys = { workspace = true }'
			);
		})
	);
	assert.ok(
		diagnostics.some(
			(item) =>
				item.path === displayTopologyManifest &&
				/workspace dependency inheritance, whose member scope and optionality are not admitted/.test(
					item.problem
				)
		),
		JSON.stringify(diagnostics)
	);
});

void test('dependency admission rejects package features that forward unadmitted Cargo features', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	for (const forwarded of [
		'windows-sys/Win32_System_Registry',
		'windows-sys?/Win32_System_Registry'
	]) {
		const diagnostics = await run(
			check,
			snapshot((files) => {
				files[displayTopologyManifest] =
					`${String(files[displayTopologyManifest])}\n[features]\nstealth = ["${forwarded}"]\n`;
			})
		);
		assert.ok(
			diagnostics.some(
				(item) =>
					item.path === displayTopologyManifest &&
					/forwards unadmitted dependency feature/.test(item.problem)
			),
			`${forwarded}: ${JSON.stringify(diagnostics)}`
		);
	}
});

void test('dependency admission rejects Cargo manifests outside the native workspace', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	const diagnostics = await run(
		check,
		snapshot((files) => {
			files['tools/unreviewed/Cargo.toml'] =
				'[package]\nname = "unreviewed"\nversion = "0.1.0"\n';
		})
	);
	assert.ok(
		diagnostics.some(
			(item) =>
				item.path === 'tools/unreviewed/Cargo.toml' &&
				/outside the declared native workspace/.test(item.problem)
		),
		JSON.stringify(diagnostics)
	);
});

void test('dependency admission rejects duplicate ecosystem package records', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	for (const ecosystem of ['npm', 'cargo'] as const) {
		const diagnostics = await run(
			check,
			snapshot((files) => {
				const path = 'build/policies/dependencies.json';
				const policy = JSON.parse(String(files[path])) as {
					dependencies: Array<Record<string, unknown>>;
				};
				const original = policy.dependencies.find((entry) =>
					ecosystem === 'npm'
						? entry.ecosystem === undefined
						: entry.ecosystem === ecosystem
				);
				assert.ok(original);
				policy.dependencies.push({
					...original,
					purpose: 'Conflicting duplicate review authority.'
				});
				files[path] = `${JSON.stringify(policy, null, 2)}\n`;
			})
		);
		const label = ecosystem === 'cargo' ? 'Cargo' : ecosystem;
		assert.ok(
			diagnostics.some((item) =>
				new RegExp(`duplicate ${label} admission`).test(item.problem)
			),
			`${ecosystem}: ${JSON.stringify(diagnostics)}`
		);
	}
});

void test('dependency admission requires pinned npm and Cargo vulnerability audits', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	const cargoDiagnostics = await run(
		check,
		snapshot((files) => {
			const path = '.github/workflows/foundation.yml';
			files[path] = String(files[path]).replace(
				'rustsec/audit-check@858dc40f52ca2b8570b7a997c1c4e35c6fc9a432',
				'rustsec/audit-check@v2'
			);
		})
	);
	assert.ok(
		cargoDiagnostics.some(
			(item) =>
				item.path === '.github/workflows/foundation.yml' &&
				/cargo-audit bootstrap is missing/.test(item.problem)
		),
		JSON.stringify(cargoDiagnostics)
	);
	const npmDiagnostics = await run(
		check,
		snapshot((files) => {
			const path = 'package.json';
			const manifest = JSON.parse(String(files[path])) as { scripts: Record<string, string> };
			manifest.scripts['audit:dependencies'] = 'npm audit --audit-level=critical';
			files[path] = `${JSON.stringify(manifest, null, 2)}\n`;
		})
	);
	assert.ok(
		npmDiagnostics.some(
			(item) =>
				item.path === 'package.json' && /npm vulnerability audit command/.test(item.problem)
		),
		JSON.stringify(npmDiagnostics)
	);
	const commentDecoyDiagnostics = await run(
		check,
		snapshot((files) => {
			const path = '.github/workflows/foundation.yml';
			files[path] = String(files[path]).replace(
				'uses: rustsec/audit-check@858dc40f52ca2b8570b7a997c1c4e35c6fc9a432',
				'# uses: rustsec/audit-check@858dc40f52ca2b8570b7a997c1c4e35c6fc9a432\n        uses: rustsec/audit-check@v2'
			);
		})
	);
	assert.ok(
		commentDecoyDiagnostics.some((item) =>
			/cargo-audit bootstrap is missing/.test(item.problem)
		),
		JSON.stringify(commentDecoyDiagnostics)
	);
	const privilegeDiagnostics = await run(
		check,
		snapshot((files) => {
			const path = '.github/workflows/foundation.yml';
			files[path] = String(files[path]).replace(
				'permissions:\n  contents: read',
				'permissions:\n  checks: write\n  contents: read'
			);
		})
	);
	assert.ok(
		privilegeDiagnostics.some((item) =>
			/foundation job has permissions beyond read-only/.test(item.problem)
		),
		JSON.stringify(privilegeDiagnostics)
	);
	const disabledFoundationDiagnostics = await run(
		check,
		snapshot((files) => {
			const path = '.github/workflows/foundation.yml';
			files[path] = String(files[path]).replace(
				'  foundation:\n    name:',
				'  foundation:\n    if: false\n    name:'
			);
		})
	);
	assert.ok(
		disabledFoundationDiagnostics.some((item) =>
			/npm vulnerability audit is not executed/.test(item.problem)
		),
		JSON.stringify(disabledFoundationDiagnostics)
	);
	const ignoredNpmAuditDiagnostics = await run(
		check,
		snapshot((files) => {
			const path = '.github/workflows/foundation.yml';
			files[path] = String(files[path]).replace(
				'      - name: Audit npm vulnerabilities\n        run: npm run audit:dependencies',
				'      - name: Audit npm vulnerabilities\n        continue-on-error: true\n        run: npm run audit:dependencies'
			);
		})
	);
	assert.ok(
		ignoredNpmAuditDiagnostics.some((item) =>
			/npm vulnerability audit is not executed/.test(item.problem)
		),
		JSON.stringify(ignoredNpmAuditDiagnostics)
	);
	const disabledCargoAuditDiagnostics = await run(
		check,
		snapshot((files) => {
			const path = '.github/workflows/foundation.yml';
			files[path] = String(files[path]).replace(
				'  dependency-audit:\n    name:',
				'  dependency-audit:\n    if: false\n    name:'
			);
		})
	);
	assert.ok(
		disabledCargoAuditDiagnostics.some((item) =>
			/cargo-audit bootstrap is missing/.test(item.problem)
		),
		JSON.stringify(disabledCargoAuditDiagnostics)
	);
	const ignoredCargoAuditDiagnostics = await run(
		check,
		snapshot((files) => {
			const path = '.github/workflows/foundation.yml';
			files[path] = String(files[path]).replace(
				'      - name: Audit locked Rust dependencies\n        uses:',
				'      - name: Audit locked Rust dependencies\n        continue-on-error: true\n        uses:'
			);
		})
	);
	assert.ok(
		ignoredCargoAuditDiagnostics.some((item) =>
			/cargo-audit bootstrap is missing/.test(item.problem)
		),
		JSON.stringify(ignoredCargoAuditDiagnostics)
	);
});

void test('dependency admission requires bootstrap tools before repository package checks', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	const baseline = await run(
		check,
		snapshot((files) => {
			const path = '.github/workflows/foundation.yml';
			files[path] = String(files[path])
				.replaceAll('package-manager-cache: false', 'cache: npm')
				.replace(
					'      - name: Install exact cargo-audit\n        run: cargo install cargo-audit --version 0.22.2 --locked\n',
					''
				);
		})
	);
	assert.ok(
		baseline.some((item) => /setup-node may invoke the wrong npm/.test(item.problem)),
		JSON.stringify(baseline)
	);
	assert.ok(
		baseline.some((item) => /exact cargo-audit bootstrap is missing/.test(item.problem)),
		JSON.stringify(baseline)
	);
});

void test('dependency admission keeps the typed native test command entrypoint', async () => {
	const check = checkMap().get('dependencies.admission');
	assert.ok(check);
	const diagnostics = await run(
		check,
		snapshot((files) => {
			const path = 'package.json';
			const manifest = JSON.parse(String(files[path])) as { scripts: Record<string, string> };
			manifest.scripts['test:native'] = 'cargo test --manifest-path native/Cargo.toml';
			files[path] = `${JSON.stringify(manifest, null, 2)}\n`;
		})
	);
	assert.ok(
		diagnostics.some((item) => /native test command bypasses/.test(item.problem)),
		JSON.stringify(diagnostics)
	);
});

void test('production dependency policy requires native and transitive risk ownership', async () => {
	const check = checkMap().get('policy.schemas');
	assert.ok(check);
	const repository = snapshot((files) => {
		const path = 'build/policies/dependencies.json';
		const policy = JSON.parse(String(files[path])) as {
			dependencies: Array<Record<string, unknown>>;
		};
		const production = policy.dependencies.find((entry) => entry.kind === 'production');
		assert.ok(production);
		delete production.transitiveRisk;
		files[path] = `${JSON.stringify(policy, null, 2)}\n`;
	});
	const diagnostics = await run(check, repository);
	assert.ok(
		diagnostics.some(
			(item) =>
				item.path === 'build/policies/dependencies.json' &&
				/transitiveRisk/.test(item.problem)
		)
	);
});

void test('upstream assets retain digest enforcement without requiring invalid JSON comments', async () => {
	const fixture = 'test/editor/node/themes/upstream/color-theme.json';
	const clean = await run(checkMap().get('upstream.provenance')!, snapshot());
	assert.deepStrictEqual(
		clean.filter((item) => item.path === fixture),
		[]
	);
	const changed = await run(
		checkMap().get('upstream.provenance')!,
		snapshot((files) => {
			files[fixture] = '{"colors":{"foreground":"#123456"}}';
		})
	);
	assert.ok(changed.some((item) => item.path === fixture && /digest differs/.test(item.problem)));
	const code = 'src/prctr/platform/theme/common/colorThemeData.ts';
	const missingMarker = await run(
		checkMap().get('upstream.provenance')!,
		snapshot((files) => {
			files[code] = String(files[code]).replace(
				/\/\/ @proctor-vscode-port complete-theme-model/,
				''
			);
		})
	);
	assert.ok(missingMarker.some((item) => item.path === code && /lacks/.test(item.problem)));
});

void test('packaged preview assets retain source marker enforcement outside the application namespace', async () => {
	const path = 'resources/resource-preview/markdown.css';
	const check = checkMap().get('upstream.provenance')!;
	const clean = await run(check, snapshot());
	assert.deepEqual(
		clean.filter((item) => item.path === path),
		[]
	);
	const changed = await run(
		check,
		snapshot((files) => {
			files[path] = String(files[path]).replace(
				/@proctor-vscode-port resource-preview/,
				'removed source marker'
			);
		})
	);
	assert.ok(changed.some((item) => item.path === path && /lacks/.test(item.problem)));
});
