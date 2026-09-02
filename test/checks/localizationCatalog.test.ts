import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractLocalizationMessages } from '../../build/generators/localizationCatalog.ts';
import { VirtualRepository } from '../../build/checks/repository.ts';

void test('localization extraction is static, deterministic, and records named placeholders', () => {
	const repository = new VirtualRepository({
		'src/prctr/workbench/common/messages.ts': `
      import { defineMessage as message } from '../../../base/common/localization.js';
      export const beta = message({
        description: 'Second message.',
        defaultMessage: 'Hello {name}',
        id: 'test.catalog.beta'
      });
      export const alpha = message({
        id: 'test.catalog.alpha',
        defaultMessage: 'Count {count}',
        description: 'First message.'
      });
    `
	});
	assert.deepEqual(extractLocalizationMessages(repository), [
		{
			id: 'test.catalog.alpha',
			defaultMessage: 'Count {count}',
			description: 'First message.',
			placeholders: ['count'],
			sourcePath: 'src/prctr/workbench/common/messages.ts'
		},
		{
			id: 'test.catalog.beta',
			defaultMessage: 'Hello {name}',
			description: 'Second message.',
			placeholders: ['name'],
			sourcePath: 'src/prctr/workbench/common/messages.ts'
		}
	]);
});

void test('localization extraction rejects dynamic declarations and duplicate identifiers', () => {
	assert.throws(
		() =>
			extractLocalizationMessages(
				new VirtualRepository({
					'src/prctr/base/common/messages.ts': `
      import { defineMessage } from './localization.js';
      const id = 'test.catalog.dynamic';
      defineMessage({ id, defaultMessage: 'Message', description: 'Dynamic.' });
    `
				})
			),
		/id must be a static string/u
	);
	assert.throws(
		() =>
			extractLocalizationMessages(
				new VirtualRepository({
					'src/prctr/base/common/one.ts': `
      import { defineMessage } from './localization.js';
      defineMessage({ id: 'test.catalog.same', defaultMessage: 'One', description: 'One.' });
    `,
					'src/prctr/base/common/two.ts': `
      import { defineMessage } from './localization.js';
      defineMessage({ id: 'test.catalog.same', defaultMessage: 'Two', description: 'Two.' });
    `
				})
			),
		/Duplicate localization message test.catalog.same/u
	);
});
