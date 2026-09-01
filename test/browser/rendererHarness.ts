import {
  createLocalization,
  defineMessage
} from '../../src/prctr/base/common/localization.js';
import { Emitter } from '../../src/prctr/base/common/event.js';
import { DisposableStore } from '../../src/prctr/base/common/lifecycle.js';

const parameters = new URL(globalThis.location.href).searchParams;
const disposables = new DisposableStore();
const activationEmitter = disposables.add(new Emitter<number>());
const locale = parameters.get('locale') ?? 'en';
const headingMessage = defineMessage({
	id: 'test.browser.harness.heading',
  defaultMessage: '{product} browser harness',
  description: 'Heading for the real Chromium browser test harness.'
});
const localization = createLocalization({
  requestedLocale: locale,
  messages: [headingMessage],
  catalogs: [{
    locale: 'ar',
    direction: 'rtl',
		messages: { 'test.browser.harness.heading': 'بيئة اختبار {product}' }
  }]
});

document.documentElement.lang = localization.locale;
document.documentElement.dir = localization.direction;

const main = document.createElement('main');
main.dataset.fixture = 'browser-harness';

const heading = document.createElement('h1');
heading.textContent = localization.format(headingMessage, { product: 'Proctor' });

const button = document.createElement('button');
button.type = 'button';
button.textContent = 'Exercise browser event';
button.dataset.activations = '0';
disposables.add(activationEmitter.event(activations => {
  button.dataset.activations = String(activations);
}));
button.addEventListener('click', () => {
  const activations = Number(button.dataset.activations ?? '0');
  activationEmitter.fire(activations + 1);
});
globalThis.addEventListener('pagehide', () => disposables.dispose(), { once: true });

main.append(heading, button);
document.body.append(main);
document.body.dataset.ready = 'true';
