/** Content-free fact emitted by Electron main after denying a print intent. */
export type CandidatePrintCommandOrigin =
  | 'candidate_window'
  | 'integrated_browser'
  | 'pdf_viewer'
  | 'keyboard_command';

export type CandidatePrintCommandDenied = {
  readonly sequence: number;
  readonly origin: CandidatePrintCommandOrigin;
};
