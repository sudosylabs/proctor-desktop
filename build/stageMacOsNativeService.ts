import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import {
	nativeServiceBuildEnvironment,
	nativeServiceEntitlements,
	nativeServicePackage,
	planMacOsNativeServicePackage,
	stageMacOsNativeServicePackage,
	type NativeServiceReleaseIdentity
} from './lib/macosNativeServicePackage.ts';

const args = process.argv.slice(2);
if (args.length !== 4) {
	throw new Error(
		'Usage: npm run stage:native-service -- <identity.json> <universal-helper> <embedded.provisionprofile> <new-output-directory>'
	);
}
const [identityPath, executablePath, profilePath, output] = args as [
	string,
	string,
	string,
	string
];
const identity = JSON.parse(readFileSync(identityPath, 'utf8')) as NativeServiceReleaseIdentity;
const environment = nativeServiceBuildEnvironment(identity);
const files = planMacOsNativeServicePackage(
	identity,
	readFileSync(executablePath),
	readFileSync(profilePath)
);
const inventory = stageMacOsNativeServicePackage(output, files);
writeFileSync(resolve(output, 'native-service.entitlements.plist'), nativeServiceEntitlements, {
	flag: 'wx'
});
writeFileSync(
	resolve(output, 'native-service-inventory.json'),
	JSON.stringify(
		{
			format: 1,
			state: 'unsigned-staging',
			identity,
			requiredBuildEnvironment: environment,
			files: inventory,
			signingOrder: [nativeServicePackage.bundlePath, 'containing-application'],
			requiredReleaseEvidence: [
				'Compiled helper and Node bridge match requiredBuildEnvironment',
				'Embedded profile authorizes the service identity and Endpoint Security entitlement',
				'Exact utility role authorization resists alternate Electron process invocation',
				'Hardened signing, notarization and containing application fuse verification',
				'SMAppService registration, consent, Full Disk Access and observed worker shutdown on each supported target'
			]
		},
		null,
		2
	) + '\n',
	{ flag: 'wx' }
);
process.stdout.write(
	`Staged ${inventory.length} unsigned native service files in ${resolve(output)}\n`
);
