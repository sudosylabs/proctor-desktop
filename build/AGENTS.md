# Build and repository controls

Dependencies, compilation, generated artifacts, packaging, CI, and releases are
owned by
[`develop-toolchain`](../.agents/skills/develop-toolchain/SKILL.md). Policy
schemas, generators, and enforcement exceptions are described in
[`repository-enforcement`](../docs/architecture/repository-enforcement.md).

- Repository controls live in `build/checks/` and run with
  `node build/checks/main.ts`; select one with `--check <id>`. Their data lives in
  `build/policies/` and is validated by `build/policies/schemas/`.
- Generated files come from `build/generators/`; refresh them with
  `npm run generate` and commit the output with the change that caused it.
- Custom lint rules live in `build/lint/rules.ts` and are wired in
  `eslint.config.mjs`. A new rule ships with valid and invalid cases in
  `test/checks/developerTooling.test.ts`.
- Use Node from `.nvmrc`; `npm run doctor` reports what the machine has.
- A tooling change that alters what the staged-file hook reads must be staged with
  its working copy; see `scripts/staged.ts`.
