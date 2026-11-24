# Contributing to Proctor Desktop

Proctor Desktop is the Electron workbench for programming examinations. It is
built in the style of the VS Code codebase, adapted to Proctor: plain
TypeScript and DOM, services declared with `createDecorator` and injected
through constructors, and one implementation of each shared piece.

## Start here

- [`AGENTS.md`](AGENTS.md) holds the rules every change follows and routes to
  the skill for each kind of work.
- [`docs/README.md`](docs/README.md) maps the product and architecture
  documents. Read the architecture document for the area you change first.
- [`docs/project/development.md`](docs/project/development.md) explains setup,
  the commands, and formatting.

## Before you open a pull request

- `npm run check` passes: types, lint, formatting, repository controls,
  licences and the Node suites. Run the browser and Electron suites too when
  your change touches them (`node scripts/test.ts browser`,
  `npm run test:electron`).
- New code reuses the shared toolkit and reads server data through
  `IServerDataService`. When a shared piece lacks what you need, extend it
  instead of copying it.
- Logs and telemetry follow
  [`docs/architecture/observability.md`](docs/architecture/observability.md):
  no personal data, no `console`.
- Every source file keeps its licence header, and VS Code-derived files keep
  their upstream notice and port marker.
- Test data uses invented people and the `.example` domain, never real names
  or addresses.
- Commits follow the repository's conventional style (`feat`, `fix`, `docs`,
  `chore`; `!` for a breaking change) and each explains why.
