import { Emitter, type Event } from '../../../common/event.js';
import { Disposable } from '../../../common/lifecycle.js';
import { addDisposableListener } from '../../dom.js';
import './toggleControl.css';

export interface ToggleState { readonly checked: boolean; readonly disabled?: boolean; readonly readOnly?: boolean; readonly readOnlyMessage?: string; }
export interface ToggleOptions extends ToggleState { readonly label: string; readonly description?: string; }
let toggleSequence = 0;

export class ToggleControl extends Disposable {
  readonly element: HTMLDivElement; readonly input: HTMLInputElement;
  readonly #intent = this._register(new Emitter<boolean>()); readonly onDidRequestChange: Event<boolean> = this.#intent.event;
  readonly #status: HTMLSpanElement; #readOnly = false; #disposed = false;
  constructor(host: HTMLElement, options: ToggleOptions) {
    super(); const document = host.ownerDocument; const id = `prctr-toggle-${++toggleSequence}`;
    this.element = document.createElement('div'); this.element.className = 'prctr-toggle';
    this.input = document.createElement('input'); this.input.className = 'prctr-toggle__input'; this.input.id = id; this.input.type = 'checkbox';
    const content = document.createElement('div'); content.className = 'prctr-toggle__content';
    const label = document.createElement('label'); label.className = 'prctr-toggle__label'; label.htmlFor = id; label.textContent = options.label;
    const description = document.createElement('p'); description.className = 'prctr-toggle__description'; description.id = `${id}-description`; description.textContent = options.description ?? '';
    this.#status = document.createElement('span'); this.#status.className = 'prctr-toggle__status'; this.#status.id = `${id}-status`;
    this.input.setAttribute('aria-describedby', `${description.id} ${this.#status.id}`); content.append(label, description, this.#status); this.element.append(this.input, content); host.append(this.element);
    this._register(addDisposableListener(this.input, 'click', event => {
      const requested = this.input.checked;
      event.preventDefault();
      if (this.#readOnly) return;
      this.#intent.fire(requested);
    }));
    this.setState(options);
  }
  setState(state: ToggleState): void {
    if (this.#disposed) throw new Error('ToggleControl is disposed');
    if (state.readOnly && !state.readOnlyMessage) throw new Error('Read-only Toggle state requires a localized message');
    this.#readOnly = state.readOnly === true; this.input.checked = state.checked; this.input.disabled = state.disabled === true;
    this.#status.textContent = state.readOnly ? state.readOnlyMessage ?? '' : ''; this.#status.hidden = !state.readOnly;
    this.input.setAttribute('aria-readonly', String(this.#readOnly)); this.element.dataset.state = state.disabled ? 'disabled' : this.#readOnly ? 'readonly' : 'ready';
  }
  focus(): void { this.input.focus(); }
  override dispose(): void { if (this.#disposed) return; this.#disposed = true; super.dispose(); this.element.remove(); }
}
