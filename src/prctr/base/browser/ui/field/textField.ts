import { Emitter, type Event } from '../../../common/event.js';
import { Disposable } from '../../../common/lifecycle.js';
import { addDisposableListener } from '../../dom.js';
import './textField.css';

export interface TextFieldState { readonly value: string; readonly disabled?: boolean; readonly readOnly?: boolean; readonly unavailable?: boolean; readonly unavailableMessage?: string; readonly required?: boolean; readonly error?: string; }
export interface TextFieldOptions extends TextFieldState { readonly label: string; readonly description?: string; readonly inputMode?: HTMLInputElement['inputMode']; readonly autocomplete?: AutoFill; }

let fieldSequence = 0;
export class TextFieldControl extends Disposable {
  readonly element: HTMLDivElement; readonly input: HTMLInputElement;
  readonly #change = this._register(new Emitter<string>()); readonly onDidChange: Event<string> = this.#change.event;
  readonly #error: HTMLParagraphElement; readonly #unavailable: HTMLParagraphElement; #disposed = false;
  constructor(host: HTMLElement, options: TextFieldOptions) {
    super(); const document = host.ownerDocument; const id = `prctr-field-${++fieldSequence}`;
    this.element = document.createElement('div'); this.element.className = 'prctr-text-field';
    const label = document.createElement('label'); label.className = 'prctr-text-field__label'; label.htmlFor = id; label.textContent = options.label;
    this.input = document.createElement('input'); this.input.className = 'prctr-text-field__input'; this.input.id = id; this.input.type = 'text'; this.input.inputMode = options.inputMode ?? 'text'; this.input.autocomplete = options.autocomplete ?? 'off';
    const description = document.createElement('p'); description.className = 'prctr-text-field__description'; description.id = `${id}-description`; description.textContent = options.description ?? '';
    this.#error = document.createElement('p'); this.#error.className = 'prctr-text-field__error'; this.#error.id = `${id}-error`;
    this.#unavailable = document.createElement('p'); this.#unavailable.className = 'prctr-text-field__unavailable'; this.#unavailable.id = `${id}-unavailable`;
    this.element.append(label, this.input, description, this.#error, this.#unavailable); host.append(this.element);
    this._register(addDisposableListener(this.input, 'input', () => this.#change.fire(this.input.value)));
    this.setState(options);
  }
  setState(state: TextFieldState): void {
    if (this.#disposed) throw new Error('TextFieldControl is disposed');
    if (state.unavailable && !state.unavailableMessage) throw new Error('Unavailable TextField state requires a localized message');
    this.input.value = state.value; this.input.disabled = state.disabled === true || state.unavailable === true; this.input.readOnly = state.readOnly === true; this.input.required = state.required === true;
    this.input.setAttribute('aria-invalid', String(state.error !== undefined)); this.#error.textContent = state.error ?? ''; this.#error.hidden = state.error === undefined;
    this.#unavailable.textContent = state.unavailable ? state.unavailableMessage ?? '' : ''; this.#unavailable.hidden = !state.unavailable;
    const describedBy = [this.element.querySelector('.prctr-text-field__description')?.id, state.error === undefined ? undefined : this.#error.id, state.unavailable ? this.#unavailable.id : undefined].filter(Boolean).join(' ');
    this.input.setAttribute('aria-describedby', describedBy); this.element.dataset.state = state.unavailable ? 'unavailable' : state.disabled ? 'disabled' : state.readOnly ? 'readonly' : state.error ? 'invalid' : 'ready';
  }
  focus(): void { this.input.focus(); }
  override dispose(): void { if (this.#disposed) return; this.#disposed = true; super.dispose(); this.element.remove(); }
}
