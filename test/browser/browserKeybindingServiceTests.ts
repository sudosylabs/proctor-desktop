import { Emitter } from '../../src/prctr/base/common/event.ts';
import { DisposableStore } from '../../src/prctr/base/common/lifecycle.ts';
import { KeyCode, KeyMod } from '../../src/prctr/base/common/keyCodes.ts';
import { isMacintosh } from '../../src/prctr/base/common/platform.ts';
import type {
	ICommandEvent,
	ICommandService
} from '../../src/prctr/platform/commands/common/commands.ts';
import { ContextKeyService } from '../../src/prctr/platform/contextkey/browser/contextKeyService.ts';
import {
	KeybindingWeight,
	KeybindingsRegistry
} from '../../src/prctr/platform/keybinding/common/keybindingsRegistry.ts';
import { BrowserKeybindingService } from '../../src/prctr/workbench/services/keybinding/browser/browserKeybindingService.ts';

export async function runBrowserKeybindingServiceTests(document: Document): Promise<void> {
	const disposables = new DisposableStore();
	const willExecute = disposables.add(new Emitter<ICommandEvent>());
	const didExecute = disposables.add(new Emitter<ICommandEvent>());
	const contextKeys = disposables.add(new ContextKeyService());
	let service: BrowserKeybindingService;
	let executions = 0;
	let currentHold: Promise<void> | undefined;
	const executionCount = (): number => executions;
	const commands: ICommandService = {
		_serviceBrand: undefined,
		onWillExecuteCommand: willExecute.event,
		onDidExecuteCommand: didExecute.event,
		executeCommand: async (commandId) => {
			executions++;
			currentHold = service.enableKeybindingHoldMode(commandId);
		}
	};
	service = disposables.add(
		new BrowserKeybindingService(document, contextKeys, commands, {
			status: () => ({ close() {} }),
			warn: (error) => {
				throw error;
			}
		})
	);
	if (service.enableKeybindingHoldMode('prctr.test.hold') !== undefined)
		throw new Error('Keybinding hold mode started outside matching command dispatch');
	disposables.add(
		KeybindingsRegistry.registerKeybindingRule({
			id: 'prctr.test.hold',
			weight: KeybindingWeight.WorkbenchContrib,
			primary: KeyMod.CtrlCmd | KeyCode.KeyH
		})
	);
	const keyEvent = (type: 'keydown' | 'keyup'): KeyboardEvent => {
		const event = new KeyboardEvent(type, {
			key: 'h',
			code: 'KeyH',
			ctrlKey: !isMacintosh,
			metaKey: isMacintosh,
			bubbles: true,
			cancelable: true
		});
		Object.defineProperty(event, 'keyCode', { configurable: true, value: 72 });
		return event;
	};
	document.body.dispatchEvent(keyEvent('keydown'));
	const keyupHold = currentHold;
	if (executionCount() !== 1 || keyupHold === undefined)
		throw new Error('Matching keybinding command did not enter hold mode');
	document.body.dispatchEvent(keyEvent('keydown'));
	if (executionCount() !== 1) throw new Error('Hold mode dispatched a repeated keydown');
	document.body.dispatchEvent(keyEvent('keyup'));
	await keyupHold;
	document.body.dispatchEvent(keyEvent('keydown'));
	const blurHold = currentHold;
	if (executionCount() !== 2 || blurHold === undefined)
		throw new Error('Keyup did not release hold mode');
	document.defaultView?.dispatchEvent(new Event('blur'));
	await blurHold;
	document.body.dispatchEvent(keyEvent('keydown'));
	const disposalHold = currentHold;
	if (executionCount() !== 3 || disposalHold === undefined)
		throw new Error('Focus loss did not release hold mode');
	disposables.dispose();
	await disposalHold;
}
