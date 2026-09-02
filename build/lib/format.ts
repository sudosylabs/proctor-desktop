import { check, format, getFileInfo, resolveConfig } from 'prettier';
import { repositoryPath } from './paths.ts';

export async function formatText(path: string, text: string): Promise<string | undefined> {
	const absolute = repositoryPath(path);
	const info = await getFileInfo(absolute, {
		ignorePath: repositoryPath('.prettierignore'),
		resolveConfig: false
	});
	if (info.ignored || info.inferredParser === null) return undefined;
	const config = await resolveConfig(absolute);
	if (!config) throw new Error('The repository Prettier configuration is missing.');
	const options = { ...config, filepath: absolute };
	return (await check(text, options)) ? text : await format(text, options);
}
