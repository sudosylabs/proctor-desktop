import { fileURLToPath } from 'node:url';
import type { MessageEvent, ParentPort } from 'electron';
import { electronSecurityUtilityPort } from '../../platform/native/electron-utility/electronSecurityUtilityPort.js';
import { loadNativeBaselineDriver } from '../../platform/native/electron-utility/nativeBaselineDriver.js';
import { SecurityUtilityHost } from '../../platform/native/electron-utility/securityUtilityHost.js';

declare const __PRCTR_SECURITY_UTILITY_BUILD_IDENTITY__: string;

const PORT_TRANSFER_TIMEOUT_MS = 5_000;
const nativeModulePath = fileURLToPath(new URL('./prctr_native_node_bridge.node', import.meta.url));
const parentPort: ParentPort = process.parentPort;
const transferTimer = setTimeout(
	() => terminateWithDiagnostic('port-transfer-timeout'),
	PORT_TRANSFER_TIMEOUT_MS
);

parentPort.once('message', (event: MessageEvent) => {
	clearTimeout(transferTimer);
	if (!isPortTransfer(event.data) || event.ports.length !== 1) {
		terminateWithDiagnostic('invalid-port-transfer');
		return;
	}
	const transferredPort = event.ports[0];
	if (transferredPort === undefined) {
		terminateWithDiagnostic('missing-transferred-port');
		return;
	}
	let driver;
	try {
		driver = loadNativeBaselineDriver(nativeModulePath);
	} catch {
		terminateWithDiagnostic('native-binding-load-failed');
		return;
	}
	const host = new SecurityUtilityHost({
		port: electronSecurityUtilityPort(transferredPort),
		driver,
		buildIdentity: __PRCTR_SECURITY_UTILITY_BUILD_IDENTITY__,
		diagnostic: (code) => process.stderr.write(`prctr-security-utility:${code}\n`),
		terminate: (exitCode) => process.exit(exitCode)
	});
	host.start();
});

function isPortTransfer(value: unknown): boolean {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		Object.keys(value).length === 2 &&
		Reflect.get(value, 'kind') === 'security-utility-port' &&
		Reflect.get(value, 'protocol_version') === 1
	);
}

function terminateWithDiagnostic(code: string): void {
	process.stderr.write(`prctr-security-utility:${code}\n`);
	process.exit(70);
}
