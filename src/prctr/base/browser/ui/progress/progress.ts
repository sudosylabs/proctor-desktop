import { Disposable } from '../../../common/lifecycle.js';
import './progress.css';

export type ProgressState = { readonly kind: 'hidden' } | { readonly kind: 'indeterminate'; readonly label: string } | { readonly kind: 'determinate'; readonly label: string; readonly value: number; readonly maximum: number };
export class ProgressControl extends Disposable {
  readonly element: HTMLDivElement; readonly #label: HTMLSpanElement; readonly #progress: HTMLProgressElement; #disposed = false;
  constructor(host: HTMLElement, state: ProgressState) {
    super(); const document = host.ownerDocument; this.element = document.createElement('div'); this.element.className = 'prctr-progress';
    this.#label = document.createElement('span'); this.#label.className = 'prctr-progress__label'; this.#progress = document.createElement('progress'); this.#progress.className = 'prctr-progress__bar';
    this.element.append(this.#label, this.#progress); host.append(this.element); this.setState(state);
  }
  setState(state: ProgressState): void {
    if (this.#disposed) throw new Error('ProgressControl is disposed');
    if (state.kind === 'determinate' && (!Number.isFinite(state.value) || !Number.isFinite(state.maximum) || state.maximum <= 0 || state.value < 0 || state.value > state.maximum)) throw new RangeError('Invalid determinate progress range');
    this.element.hidden = state.kind === 'hidden'; this.element.dataset.kind = state.kind;
    if (state.kind === 'hidden') { this.#label.textContent = ''; this.#progress.removeAttribute('value'); return; }
    this.#label.textContent = state.label; this.#progress.setAttribute('aria-label', state.label);
    if (state.kind === 'indeterminate') this.#progress.removeAttribute('value');
    else {
      this.#progress.max = state.maximum; this.#progress.value = state.value;
    }
  }
  override dispose(): void { if (this.#disposed) return; this.#disposed = true; super.dispose(); this.element.remove(); }
}
