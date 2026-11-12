import assert from 'node:assert';
import { suite, test } from '../../../base/common/upstream/testAdapter.ts';
import { normalizeAdministrationLists } from '../../../../src/prctr/platform/settings/common/administrationLists.ts';
import { settingsRegistry } from '../../../../src/prctr/platform/settings/common/settingsRegistry.ts';

const id = 'ybndrfg8ejkmcpqxot1uwisza3';

suite('administration lists setting', () => {
	test('remembered page sizes and saved views keep only their known shapes', () => {
		const value = {
			pageSizes: { users: 25, audits: 50 },
			userViews: [
				{ name: ' New in CS ', filter: { academicUnitId: id, lastActive: 'recent' } },
				{ name: 'Disabled', filter: { status: 'disabled' } }
			]
		};
		assert.deepStrictEqual(normalizeAdministrationLists(value), {
			pageSizes: { users: 25, audits: 50 },
			userViews: [
				{ name: 'New in CS', filter: { academicUnitId: id, lastActive: 'recent' } },
				{ name: 'Disabled', filter: { status: 'disabled' } }
			]
		});
		assert.deepStrictEqual(normalizeAdministrationLists({}), {});
		for (const invalid of [
			{ pageSizes: { users: 30 } },
			{ pageSizes: { 'Users!': 10 } },
			{ extra: true },
			{ userViews: [{ name: '', filter: {} }] },
			{ userViews: [{ name: 'x', filter: { url: 'https://example.test' } }] },
			{ userViews: [{ name: 'x', filter: { roleIds: ['../roles'] } }] },
			{
				userViews: Array.from({ length: 9 }, (_, index) => ({
					name: `v${index}`,
					filter: {}
				}))
			},
			[],
			'users'
		])
			assert.strictEqual(
				normalizeAdministrationLists(invalid),
				undefined,
				JSON.stringify(invalid)
			);
	});

	test('the setting is declared for AuthenticatedWindow only and never reaches an exam', () => {
		const declaration = settingsRegistry.declaration('administration.lists');
		if (declaration === undefined) throw new Error('administration.lists is declared');
		assert.deepStrictEqual(declaration.windows, ['authenticated']);
		assert.strictEqual(declaration.candidate, 'nonCandidateOnly');
		assert.strictEqual(
			settingsRegistry.normalize('administration.lists', { pageSizes: { users: 11 } }),
			undefined
		);
	});
});
