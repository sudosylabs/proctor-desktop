import { validateWindowDescriptor, type AuthenticatedWindowDescriptor, type CandidateWindowDescriptor, type ProductWindowDescriptor, type ProductWindowIntent } from './windowProtocol.js';

export interface ManagedProductWindow {
  readonly descriptor: ProductWindowDescriptor;
  readonly destroyed: boolean;
  show(): void;
  destroy(): void;
  setCloseVeto(veto: boolean): void;
}

export interface ProductWindowFactory {
  create(descriptor: ProductWindowDescriptor, onIntent: (intent: ProductWindowIntent) => void, onTerminated: (reason: ProductWindowTerminationReason) => void): ManagedProductWindow;
}

export type ProductWindowTerminationReason = 'closed' | 'loadFailed';
export interface ProductWindowTermination { readonly descriptor: ProductWindowDescriptor; readonly reason: ProductWindowTerminationReason }

export interface TrustedWindowIntentSink {
  accept(descriptor: ProductWindowDescriptor, intent: ProductWindowIntent): void;
}

export class ProductWindowCoordinator {
  readonly #factory: ProductWindowFactory;
  readonly #intentSink: TrustedWindowIntentSink;
  readonly #terminationListeners = new Set<(termination: ProductWindowTermination) => void>();
  #current: ManagedProductWindow | undefined;
  #termination: ProductWindowTermination | undefined;
  #candidateDepartureAllowed = false;

  constructor(factory: ProductWindowFactory, intentSink: TrustedWindowIntentSink) { this.#factory = factory; this.#intentSink = intentSink; }

  get current(): ProductWindowDescriptor | undefined { return this.#current?.descriptor; }
  get termination(): ProductWindowTermination | undefined { return this.#termination; }
  onDidTerminate(listener: (termination: ProductWindowTermination) => void): { dispose(): void } { this.#terminationListeners.add(listener); return Object.freeze({ dispose: () => this.#terminationListeners.delete(listener) }); }

  openInitial(descriptorValue: unknown): void {
    if (this.#current !== undefined) throw new Error('An initial product window is already open');
    const descriptor = validateWindowDescriptor(descriptorValue);
    if (descriptor.kind === 'candidate') throw new Error('CandidateWindow is never a relaunch entrypoint');
    this.#replace(descriptor);
  }

  completeSignIn(descriptorValue: unknown): void {
    this.#requireCurrent('launch');
    const descriptor=validateWindowDescriptor(descriptorValue);
    if (descriptor.kind!=='authenticated' || !descriptor.identity) throw new Error('Sign-in requires a verified authenticated identity');
    this.#replace(descriptor);
  }

  returnToLaunch(windowId: string): void {
    this.#requireCurrent('authenticated');
    this.#replace({kind:'launch',windowId});
  }

  enterCandidate(descriptorValue: unknown): void {
    const descriptor = validateWindowDescriptor(descriptorValue);
    const current = this.#requireCurrent('authenticated');
    if (descriptor.kind !== 'candidate' || !sameBinding(current, descriptor)) throw new Error('Candidate transition does not preserve the trusted Principal, Session, and Institution binding');
    this.#candidateDepartureAllowed = false;
    this.#replace(descriptor);
    this.#current!.setCloseVeto(true);
  }

  allowCandidateDeparture(): void { this.#requireCurrent('candidate'); this.#candidateDepartureAllowed = true; this.#current!.setCloseVeto(false); }

  leaveCandidate(descriptorValue: unknown): void {
    const descriptor = validateWindowDescriptor(descriptorValue);
    const current = this.#requireCurrent('candidate');
    if (!this.#candidateDepartureAllowed) throw new Error('Candidate departure has not been authorized');
    if (descriptor.kind !== 'authenticated' || !sameBinding(current, descriptor)) throw new Error('Authenticated return does not preserve the trusted binding');
    this.#replace(descriptor);
    this.#candidateDepartureAllowed = false;
  }

  shutdown(): void { const current = this.#current; this.#current = undefined; current?.destroy(); }

  #replace(descriptor: ProductWindowDescriptor): void {
    const previous = this.#current;
    this.#current = undefined;
    previous?.destroy();
    let created: ManagedProductWindow | undefined; let pendingTermination: ProductWindowTerminationReason | undefined;
    created = this.#factory.create(descriptor, intent => { if (created === undefined) throw new Error('Product window intent arrived before creation completed'); this.#acceptIntent(created, intent); }, reason => { if (created === undefined) pendingTermination = reason; else this.#acceptTermination(created, reason); });
    if (pendingTermination !== undefined) { created.destroy(); this.#publishTermination(descriptor, pendingTermination); throw new Error(`Product window terminated during creation: ${pendingTermination}`); }
    this.#termination = undefined;
    this.#current = created;
    created.show();
  }

  #acceptIntent(sender: ManagedProductWindow, intent: ProductWindowIntent): void {
    if (sender !== this.#current || sender.destroyed) throw new Error('Intent sender is not the active product window');
    this.#intentSink.accept(sender.descriptor, intent);
  }

  #acceptTermination(sender: ManagedProductWindow, reason: ProductWindowTerminationReason): void { if (sender !== this.#current) return; this.#current = undefined; this.#candidateDepartureAllowed = false; this.#publishTermination(sender.descriptor, reason); }
  #publishTermination(descriptor: ProductWindowDescriptor, reason: ProductWindowTerminationReason): void { const termination = Object.freeze({ descriptor, reason }); this.#termination = termination; for (const listener of [...this.#terminationListeners]) listener(termination); }

  #requireCurrent<K extends ProductWindowDescriptor['kind']>(kind: K): Extract<ProductWindowDescriptor, { kind: K }> {
    const descriptor = this.#current?.descriptor;
    if (descriptor?.kind !== kind) throw new Error(`Expected active ${kind} window`);
    return descriptor as Extract<ProductWindowDescriptor, { kind: K }>;
  }
}

function sameBinding(left: AuthenticatedWindowDescriptor | CandidateWindowDescriptor, right: AuthenticatedWindowDescriptor | CandidateWindowDescriptor): boolean {
  return left.institutionOrigin === right.institutionOrigin && left.principalId === right.principalId && left.sessionId === right.sessionId;
}
