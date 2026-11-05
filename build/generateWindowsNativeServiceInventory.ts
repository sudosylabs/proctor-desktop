import { writeFileSync } from 'node:fs';
import { WindowsNativeServiceInventoryBuilder } from './lib/windowsNativeServicePackage.ts';

const args = process.argv.slice(2);
if (args.length !== 4)
	throw new Error(
		'Usage: npm run inventory:native-service:windows -- <packaged-client-directory> <release-id> <relative-executable> <new-output.json>'
	);
const [directory, releaseId, executable, output] = args as [string, string, string, string];
const inventory = new WindowsNativeServiceInventoryBuilder().build(
	directory,
	releaseId,
	executable
);
writeFileSync(output, JSON.stringify(inventory, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
process.stdout.write(
	`Inventoried ${inventory.files.length} client files. Review and pass this build input as WINDOWS_SERVICE_PACKAGE before compiling the helper. This does not verify signatures or install the service.\n`
);
