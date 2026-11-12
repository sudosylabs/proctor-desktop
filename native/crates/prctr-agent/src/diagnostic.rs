//! The closed set of diagnostic codes the agent writes to stderr. No facts, names or paths can
//! reach a log, because only these codes exist.

use std::io::Write as _;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Diagnostic {
    HandshakeTimeout,
    HandshakeMismatch,
    ProtocolError,
    MainClosed,
    SourceStartFailed,
    Panicked,
}

impl Diagnostic {
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::HandshakeTimeout => "handshake_timeout",
            Self::HandshakeMismatch => "handshake_mismatch",
            Self::ProtocolError => "protocol_error",
            Self::MainClosed => "main_closed",
            Self::SourceStartFailed => "source_start_failed",
            Self::Panicked => "panicked",
        }
    }
}

pub fn emit(diagnostic: Diagnostic) {
    let _ = writeln!(std::io::stderr(), "prctr-agent:{}", diagnostic.code());
}
