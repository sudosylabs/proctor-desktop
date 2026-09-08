import { Emitter, type Event } from '../../../common/event.js';
import { Disposable } from '../../../common/lifecycle.js';
import { addDisposableListener } from '../../dom.js';
import './button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'default' | 'large';
export interface ButtonIcon { readonly element: HTMLElement; dispose(): void }
export interface ButtonState { readonly label: string; readonly accessibleLabel?: string; readonly disabled?: boolean; readonly busy?: boolean; readonly icon?: (document: Document) => ButtonIcon; }
export interface ButtonOptions extends ButtonState { readonly variant: ButtonVariant; readonly size?: ButtonSize; readonly type?: 'button' | 'submit'; }

export class ButtonControl extends Disposable {
  readonly element: HTMLButtonElement;
  readonly #intent = this._register(new Emitter<void>());
  readonly onDidRequest: Event<void> = this.#intent.event;
  #icon: ButtonIcon | undefined;
  #disposed = false;

  constructor(host: HTMLElement, options: ButtonOptions) {
    super();
    const document = host.ownerDocument; this.element = document.createElement('button');
    this.element.className = 'prctr-button'; this.element.type = options.type ?? 'button'; this.element.dataset.variant = options.variant;
    this.element.dataset.size = options.size ?? 'default';
    this._register(addDisposableListener(this.element, 'click', event => { if (this.element.disabled || this.element.dataset.busy === 'true') { event.preventDefault(); return; } this.#intent.fire(); }));
    host.append(this.element); this.setState(options);
  }

  setState(state: ButtonState): void {
    if (this.#disposed) throw new Error('ButtonControl is disposed');
    const document = this.element.ownerDocument;
    const nextIcon = state.icon?.(document);
    const content = document.createDocumentFragment();
    if (nextIcon !== undefined) content.append(nextIcon.element);
    const label = document.createElement('span'); label.className = 'prctr-button__label'; label.textContent = state.label; content.append(label);
    const busy = state.busy === true; this.element.disabled = state.disabled === true || busy;
    this.element.dataset.busy = String(busy); this.element.setAttribute('aria-busy', String(busy));
    if (state.accessibleLabel === undefined) this.element.removeAttribute('aria-label'); else this.element.setAttribute('aria-label', state.accessibleLabel);
    if (busy) { const progress = document.createElement('span'); progress.className = 'prctr-button__busy'; progress.setAttribute('aria-hidden', 'true'); content.append(progress); }
    this.#icon?.dispose(); this.#icon = nextIcon; this.element.replaceChildren(content);
  }

  focus(): void { this.element.focus(); }
  override dispose(): void { if (this.#disposed) return; this.#disposed = true; this.#icon?.dispose(); super.dispose(); this.element.remove(); }
}
