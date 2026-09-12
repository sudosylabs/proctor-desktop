import { readFileSync } from 'node:fs';
import process from 'node:process';
import {
	MacOsNativeServiceVerifier,
	type MacOsNativeReleaseIdentity
} from './lib/macosNativeServiceVerification.ts';
import { MacOsNativePackageCommand } from './lib/nativePackageCommand.ts';

if (process.argv.length !== 4 || process.platform !== 'darwin')
	throw new Error(
		'Usage on macOS: npm run verify:native-service -- <signed-app> <release-identity.json>'
	);
const identity = JSON.parse(readFileSync(process.argv[3]!, 'utf8')) as MacOsNativeReleaseIdentity;
const proof = await new MacOsNativeServiceVerifier(new MacOsNativePackageCommand()).verify(
	process.argv[2]!,
	identity
);
process.stdout.write(JSON.stringify(proof, null, 2) + '\n');
if (proof.state !== 'passed') process.exitCode = 1;
