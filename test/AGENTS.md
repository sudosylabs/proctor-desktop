# Tests

Check selection and completion evidence follow the root
[`AGENTS.md`](../AGENTS.md); platform evidence follows
[`cross-platform-validation`](../.agents/skills/cross-platform-validation/SKILL.md).
Suites and their build prerequisites are defined in `build/lib/testSuites.ts` and
run with `node scripts/test.ts <suite>`.

- Test through the module's public interface and assert observable behavior,
  failure, and recovery. Name each test for the behavior it proves.
- A test file that imports `base/common/lifecycle` calls
  `ensureNoDisposablesAreLeakedInTestSuite()` from
  `test/base/common/upstream/upstreamTestUtils.ts`, and adds what it creates to
  the returned store. `proctor/require-leak-checked-tests` enforces this for the
  Node-runner suites.
- Suites use `suite`, `test`, `setup`, and `teardown` from
  `test/base/common/upstream/testAdapter.ts`, or `node:test` directly.
- Do not commit focused tests (`only`); `proctor/no-focused-tests` rejects them.
- Chromium-harness and real-Electron tests (`test/browser`, `test/electron`) need
  Electron provisioned with `npm run setup`. Report when they did not run.
- Keep test profiles, temporary files, and credentials isolated from a developer's
  installed application.
